#!/usr/bin/env bash
set -euo pipefail

repo_root="${HOME}/hardyafAI_Open_source"
service_root="${repo_root}/services/household-control"
config_root="${HOME}/.config/hardy-home"
data_root="${HOME}/.local/share/hardy-home"
unit_root="${HOME}/.config/systemd/user"
node_root="${HOME}/.openclaw/tools/node/bin"
export PATH="${node_root}:${PATH}"

test -f "${service_root}/package-lock.json"
mkdir -p "${config_root}" "${data_root}" "${unit_root}"
chmod 700 "${config_root}" "${data_root}"

cd "${service_root}"
"${node_root}/npm" ci --omit=dev
"${node_root}/npm" test

install -m 0644 "${repo_root}/deploy/hardybot/household-control.service" "${unit_root}/household-control.service"

if [[ ! -f "${config_root}/control.env" ]] || grep -q 'replace-with-the-existing-gateway-token' "${config_root}/control.env"; then
  gateway_unit="${HOME}/.config/systemd/user/openclaw-gateway.service"
  gateway_env="${HOME}/.openclaw/.env"
  token_line="$(grep '^OPENCLAW_GATEWAY_TOKEN=' "${gateway_env}" | tail -n 1 || true)"
  token_value="${token_line}"
  if [[ -z "${token_value}" ]]; then
    token_line="$(grep '^Environment=.*OPENCLAW_GATEWAY_TOKEN=' "${gateway_unit}" | tail -n 1 || true)"
    token_value="${token_line#Environment=}"
  fi
  token_value="${token_value#\"}"
  token_value="${token_value%\"}"
  token_value="${token_value#OPENCLAW_GATEWAY_TOKEN=}"
  if [[ -n "${token_value}" && "${token_value}" != "${token_line}" ]] || [[ "${token_line}" == OPENCLAW_GATEWAY_TOKEN=* ]]; then
    {
      printf '%s\n' 'NODE_ENV=production'
      printf '%s\n' 'BIND_ADDRESS=192.168.1.127'
      printf '%s\n' 'PORT=4317'
      printf '%s\n' 'HARDY_HOME_DATABASE=/home/codex/.local/share/hardy-home/household-control.sqlite'
      printf '%s\n' 'OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789'
      printf 'OPENCLAW_GATEWAY_TOKEN=%s\n' "${token_value}"
    } > "${config_root}/control.env"
    chmod 600 "${config_root}/control.env"
  else
    install -m 0600 "${repo_root}/deploy/hardybot/control.env.example" "${config_root}/control.env"
    echo "Created ${config_root}/control.env. Replace its Gateway token before starting the service."
    exit 2
  fi
fi

if grep -q 'replace-with-the-existing-gateway-token' "${config_root}/control.env"; then
  echo "Refusing to start with the placeholder Gateway token in ${config_root}/control.env."
  exit 2
fi

systemctl --user daemon-reload
systemctl --user enable --now household-control.service
systemctl --user --no-pager status household-control.service
curl --retry 10 --retry-connrefused --retry-delay 1 --fail --silent --show-error http://192.168.1.127:4317/health
echo
