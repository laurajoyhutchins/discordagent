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
CONFIG_ROOT="${CONFIG_ROOT:-/etc/discordagent}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)}"

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${DATA_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -m 0755 "${APP_ROOT}"
install -d -m 0700 -o "${APP_USER}" -g "${APP_GROUP}" \
  "${DATA_ROOT}" "${DATA_ROOT}/repos" "${DATA_ROOT}/worktrees"
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
ln -sfn "${release_dir}" "${APP_ROOT}/current"
chown -R root:root "${release_dir}"

install -m 0644 "${SOURCE_DIR}/deploy/systemd/discordagent.service" \
  /etc/systemd/system/discordagent.service
systemctl daemon-reload
systemctl enable discordagent.service

echo "Installed release at ${release_dir}."
echo "Next: configure ${CONFIG_ROOT}/discordagent.env, authenticate Codex as ${APP_USER}, then run npm run smoke:host before starting the service."
