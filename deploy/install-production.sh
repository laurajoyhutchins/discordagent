#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

APP_USER="${APP_USER:-discordagent}"
APP_GROUP="${APP_GROUP:-discordagent}"
APP_ROOT="${APP_ROOT:-/opt/discordagent}"
DATA_ROOT="${DATA_ROOT:-/var/lib/discordagent}"
BACKUP_ROOT="${BACKUP_ROOT:-${DATA_ROOT}/backups}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/discordagent}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)}"

for command in node npm systemctl flock readlink mv ln runuser; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command}" >&2
    exit 1
  fi
done

if [[ ! -f "${SOURCE_DIR}/package-lock.json" ]]; then
  echo "SOURCE_DIR must contain package-lock.json: ${SOURCE_DIR}" >&2
  exit 1
fi

if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${APP_GROUP}"
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --create-home --home-dir "${DATA_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -m 0755 "${APP_ROOT}"
install -d -m 0700 -o "${APP_USER}" -g "${APP_GROUP}" \
  "${DATA_ROOT}" "${DATA_ROOT}/repos" "${DATA_ROOT}/worktrees" "${BACKUP_ROOT}"
install -d -m 0750 -o root -g "${APP_GROUP}" "${CONFIG_ROOT}"

if [[ ! -f "${CONFIG_ROOT}/discordagent.env" ]]; then
  install -m 0640 -o root -g "${APP_GROUP}" \
    "${SOURCE_DIR}/deploy/discordagent.env.example" \
    "${CONFIG_ROOT}/discordagent.env"
  echo "Created ${CONFIG_ROOT}/discordagent.env. Replace every placeholder before starting the service."
fi

release_dir="${APP_ROOT}/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0755 "${APP_ROOT}/releases" "${release_dir}"
cp -a "${SOURCE_DIR}/." "${release_dir}/"

(
  cd "${release_dir}"
  npm ci
  npm run build
  npm prune --omit=dev
)

required_entrypoints=(
  "dist/index.js"
  "dist/commands/databaseMaintenance.js"
  "dist/commands/register.js"
  "dist/discord/capabilities/calculator.js"
  "dist/smoke/agentRoundTrip.js"
  "dist/smoke/discordConnectivity.js"
  "dist/smoke/hostPreflight.js"
  "dist/smoke/resourceAdmission.js"
)
for entrypoint in "${required_entrypoints[@]}"; do
  if [[ ! -f "${release_dir}/${entrypoint}" ]]; then
    echo "Production build did not emit required entrypoint: ${entrypoint}" >&2
    rm -rf "${release_dir}"
    exit 1
  fi
done

chown -R root:root "${release_dir}"

current_release="$(readlink -f "${APP_ROOT}/current" 2>/dev/null || true)"
current_next="${APP_ROOT}/.current.install.$$"
previous_next="${APP_ROOT}/.previous.install.$$"
cleanup() {
  rm -f "${current_next}" "${previous_next}"
}
trap cleanup EXIT

ln -s "${release_dir}" "${current_next}"
if [[ -n "${current_release}" && -d "${current_release}" && "${current_release}" != "${release_dir}" ]]; then
  ln -s "${current_release}" "${previous_next}"
  mv -Tf "${previous_next}" "${APP_ROOT}/previous"
fi
mv -Tf "${current_next}" "${APP_ROOT}/current"

install -m 0644 "${SOURCE_DIR}/deploy/systemd/discordagent.service" \
  /etc/systemd/system/discordagent.service
install -m 0755 "${SOURCE_DIR}/deploy/rollback-production.sh" \
  /usr/local/sbin/discordagent-rollback
systemctl daemon-reload
systemctl enable discordagent.service

echo "Installed and built release at ${release_dir}."
if [[ -n "${current_release}" && -d "${current_release}" ]]; then
  echo "Previous release retained at ${current_release}; run discordagent-rollback as root to restore it."
fi
echo "Backup artifacts will be written under ${BACKUP_ROOT} by default."
echo "Next: configure ${CONFIG_ROOT}/discordagent.env, authenticate Codex as ${APP_USER}, then run:"
echo "  runuser -u ${APP_USER} -- /usr/bin/node --env-file=${CONFIG_ROOT}/discordagent.env ${APP_ROOT}/current/dist/smoke/hostPreflight.js"
