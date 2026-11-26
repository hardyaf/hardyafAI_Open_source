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
"${node_root}/npm" ci --omit=dev --ignore-scripts
"${node_root}/npm" run check:startup

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
      printf 'BIND_ADDRESS=%s\n' "${BIND_ADDRESS:-127.0.0.1}"
      printf '%s\n' 'PORT=4317'
      printf 'HARDY_HOME_DATABASE=%s\n' "${HARDY_HOME_DATABASE:-${data_root}/household-control.sqlite}"
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

if ! grep -q '^HARDY_HOME_DOMAINS_CONFIG=' "${config_root}/control.env"; then
  echo 'Version 0.4 requires protected domain configuration. Prepare it with deploy/hardybot/prepare-domains.py and set HARDY_HOME_DOMAINS_CONFIG in control.env before starting.'
  exit 2
fi

systemctl --user daemon-reload
systemctl --user enable household-control.service
systemctl --user restart household-control.service
systemctl --user --no-pager status household-control.service
readiness_url="$("${node_root}/node" --input-type=module - "${config_root}/control.env" <<'NODE'
import { readProtectedEnvironment } from "./src/domain-runtime/configuration.ts";
const environment = await readProtectedEnvironment(process.argv[2]);
const port = Number(environment.PORT ?? "4317");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid_readiness_port");
const bind = environment.BIND_ADDRESS ?? "127.0.0.1";
const host = bind === "0.0.0.0" || bind === "::" ? "127.0.0.1" : bind;
const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
process.stdout.write(new URL(`http://${authority}:${port}/ready`).href);
NODE
)"
curl --retry 10 --retry-connrefused --retry-delay 1 --fail --silent --show-error "${readiness_url}"
echo
