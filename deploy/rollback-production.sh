#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this rollback command as root." >&2
  exit 1
fi

APP_ROOT="${APP_ROOT:-/opt/discordagent}"
SERVICE_NAME="${SERVICE_NAME:-discordagent.service}"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_LINK="${APP_ROOT}/previous"

for command in readlink systemctl mv ln; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command}" >&2
    exit 1
  fi
done

current_release="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
previous_release="$(readlink -f "${PREVIOUS_LINK}" 2>/dev/null || true)"

if [[ -z "${current_release}" || ! -d "${current_release}" ]]; then
  echo "Current release link is missing or invalid: ${CURRENT_LINK}" >&2
  exit 1
fi

if [[ -z "${previous_release}" || ! -d "${previous_release}" ]]; then
  echo "Previous release link is missing or invalid: ${PREVIOUS_LINK}" >&2
  exit 1
fi

if [[ "${current_release}" == "${previous_release}" ]]; then
  echo "Current and previous releases resolve to the same directory." >&2
  exit 1
fi

for entrypoint in dist/index.js dist/smoke/hostPreflight.js; do
  if [[ ! -f "${previous_release}/${entrypoint}" ]]; then
    echo "Previous release is incomplete: ${previous_release}/${entrypoint}" >&2
    exit 1
  fi
done

current_next="${APP_ROOT}/.current.rollback.$$"
previous_next="${APP_ROOT}/.previous.rollback.$$"
cleanup() {
  rm -f "${current_next}" "${previous_next}"
}
trap cleanup EXIT

ln -s "${previous_release}" "${current_next}"
ln -s "${current_release}" "${previous_next}"

systemctl stop "${SERVICE_NAME}"
mv -Tf "${current_next}" "${CURRENT_LINK}"
mv -Tf "${previous_next}" "${PREVIOUS_LINK}"

if ! systemctl start "${SERVICE_NAME}"; then
  echo "Rollback target failed to start; restoring ${current_release}." >&2
  ln -s "${current_release}" "${current_next}"
  ln -s "${previous_release}" "${previous_next}"
  mv -Tf "${current_next}" "${CURRENT_LINK}"
  mv -Tf "${previous_next}" "${PREVIOUS_LINK}"
  systemctl start "${SERVICE_NAME}"
  exit 1
fi

systemctl --no-pager --full status "${SERVICE_NAME}"
echo "Rolled back from ${current_release} to ${previous_release}."