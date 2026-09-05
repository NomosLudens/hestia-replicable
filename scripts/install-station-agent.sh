#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-safety.sh
source "$SCRIPT_DIR/install-safety.sh"
hestia_configure_install_paths station
hestia_assert_runtime_target

SERVICE_NAME="hestia-station-agent"
if [ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ]; then
  SOURCE_DIR="${HESTIA_SOURCE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  SOURCE_DIR="$(hestia_validate_test_path "source dir" "$SOURCE_DIR")"
else
  [[ ! -v HESTIA_SOURCE_DIR ]] || hestia_safety_fail "HESTIA_SOURCE_DIR é permitido somente em teste."
  SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

log() { echo "[station-install] $*"; }
fail() { echo "[station-install] ERRO: $*" >&2; exit 1; }
valid_station_port() {
  local value="$1" normalized
  [[ "$value" =~ ^[0-9]+$ ]] || return 1
  normalized="$value"
  while [[ ${#normalized} -gt 1 && "$normalized" == 0* ]]; do normalized="${normalized#0}"; done
  [ ${#normalized} -le 5 ] && [ "$normalized" -ge 1 ] && [ "$normalized" -le 65535 ]
}

[ "$(id -u)" -eq 0 ] || fail "execute como root (por exemplo, sudo npm run station:install)."
command -v node >/dev/null 2>&1 || fail "node não encontrado."
command -v npm >/dev/null 2>&1 || fail "npm não encontrado."
command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 || fail "systemctl não encontrado."
node "$SOURCE_DIR/scripts/require-node.mjs" || fail "versão do Node incompatível."
NODE_BIN="$(command -v node)"

PORT_EXPLICIT=0
if [[ -v HESTIA_STATION_PORT ]]; then PORT_EXPLICIT=1; STATION_PORT="$HESTIA_STATION_PORT"; else STATION_PORT=4518; fi
valid_station_port "$STATION_PORT" || fail "HESTIA_STATION_PORT deve ser um inteiro entre 1 e 65535."

SERVICE_USER="${HESTIA_STATION_SERVICE_USER:-${SUDO_USER:-}}"
[ -n "$SERVICE_USER" ] || fail "defina HESTIA_STATION_SERVICE_USER; o serviço nunca roda como root."
id "$SERVICE_USER" >/dev/null 2>&1 || fail "usuário $SERVICE_USER não existe."
[ "$(id -u "$SERVICE_USER")" -ne 0 ] || fail "o usuário do serviço não pode ser root."
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  hestia_assert_regular_config_file "$ENV_FILE"
fi

STAGING=""
NEW_RUNTIME="$RUNTIME_DIR.new.$$"
PREVIOUS_RUNTIME="$RUNTIME_DIR.previous.$$"
NEW_UNIT="$UNIT_FILE.new.$$"
PREVIOUS_UNIT="$UNIT_FILE.previous.$$"
PREVIOUS_RUNTIME_MOVED=0
RUNTIME_ACTIVATED=0
PREVIOUS_UNIT_MOVED=0
UNIT_ACTIVATED=0
INSTALL_OK=0

cleanup_install() {
  local status=$?
  trap - EXIT
  if [ "$INSTALL_OK" -ne 1 ]; then
    if [ "$RUNTIME_ACTIVATED" -eq 1 ]; then hestia_safe_remove_runtime_path "$RUNTIME_DIR" || true; fi
    if [ "$PREVIOUS_RUNTIME_MOVED" -eq 1 ] && [ -e "$PREVIOUS_RUNTIME" ]; then
      mv -- "$PREVIOUS_RUNTIME" "$RUNTIME_DIR" || true
    fi
    if [ "$UNIT_ACTIVATED" -eq 1 ]; then rm -f -- "$UNIT_FILE"; fi
    if [ "$PREVIOUS_UNIT_MOVED" -eq 1 ] && [ -e "$PREVIOUS_UNIT" ]; then
      mv -- "$PREVIOUS_UNIT" "$UNIT_FILE" || true
    fi
    "$SYSTEMCTL_BIN" daemon-reload >/dev/null 2>&1 || true
    if [ "$PREVIOUS_RUNTIME_MOVED" -eq 1 ]; then
      "$SYSTEMCTL_BIN" restart "$SERVICE_NAME.service" >/dev/null 2>&1 || true
    else
      "$SYSTEMCTL_BIN" disable --now "$SERVICE_NAME.service" >/dev/null 2>&1 || true
    fi
  fi
  hestia_safe_remove_runtime_path "$NEW_RUNTIME" || true
  hestia_safe_remove_runtime_path "$PREVIOUS_RUNTIME" || true
  rm -f -- "$NEW_UNIT" "$PREVIOUS_UNIT"
  if [ -n "$STAGING" ] && [ -d "$STAGING" ]; then rm -rf -- "$STAGING"; fi
  exit "$status"
}
trap cleanup_install EXIT

STAGING="$(mktemp -d)"
cp "$SOURCE_DIR/packaging/station-runtime/package.json" "$STAGING/package.json"
cp "$SOURCE_DIR/packaging/station-runtime/package-lock.json" "$STAGING/package-lock.json"
cp "$SOURCE_DIR/station.js" "$STAGING/station.js"
mkdir -p "$STAGING/chama" "$STAGING/scripts"
for file in codice.js codiceAuth.js codiceReadOnlyRoutes.js config.js dataDir.js events.js legacyStorageConfig.js retention.js security.js services.js serviceReport.js softwareInventory.js stationAgent.js stationClient.js stationDoctor.js systemStatus.js storage.js storageModel.js storageScanner.js storageSources.js tunnels.js updates.js; do
  cp "$SOURCE_DIR/chama/$file" "$STAGING/chama/$file"
done
cp "$SOURCE_DIR/scripts/station-doctor.mjs" "$SOURCE_DIR/scripts/require-node.mjs" "$STAGING/scripts/"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$STAGING"
log "instalando dependências mínimas reproduzivelmente"
runuser -u "$SERVICE_USER" -- env -u npm_config_cache -u NPM_CONFIG_CACHE HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)" npm --prefix "$STAGING" ci --omit=dev --ignore-scripts --no-audit --no-fund

install -d -m 0755 -o root -g root "$(dirname -- "$ENV_FILE")" "$(dirname -- "$UNIT_FILE")" "$(dirname -- "$RUNTIME_DIR")"
if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  hestia_assert_regular_config_file "$ENV_FILE"
fi
if [ ! -e "$ENV_FILE" ]; then
  TOKEN="$($NODE_BIN -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  # Mode 0640 owned by root:kaos-status so the systemd daemon (running as
  # kaos-status) can read the token. systemd's EnvironmentFile directive
  # silently ignores files it cannot read.
  install -m 0640 -o root -g "$SERVICE_GROUP" /dev/null "$ENV_FILE"
  {
    echo "HESTIA_STATION_HOST=127.0.0.1"
    echo "HESTIA_STATION_PORT=$STATION_PORT"
    echo "HESTIA_STATION_TOKEN=$TOKEN"
    echo "HESTIA_STATION_ORGANIZER_ENABLED=0"
    echo "HESTIA_STATION_CODICE_ENABLED=0"
    # Observer/read-only mode: HESTIA_STATION_READ_ONLY=1 omits POST /api/station/{apps/:appId/update,suspend}
    # and rejects any non-GET/HEAD method with 404. Default off preserves existing Station behaviour.
    if [[ -v HESTIA_STATION_READ_ONLY ]]; then
      if [[ "${HESTIA_STATION_READ_ONLY}" != "0" && "${HESTIA_STATION_READ_ONLY}" != "1" ]]; then
        fail "HESTIA_STATION_READ_ONLY deve ser 0 ou 1."
      fi
      echo "HESTIA_STATION_READ_ONLY=${HESTIA_STATION_READ_ONLY}"
    else
      echo "HESTIA_STATION_READ_ONLY=0"
    fi
    if [[ -v HESTIA_STATION_ALLOWED_HOSTS ]]; then
      echo "HESTIA_STATION_ALLOWED_HOSTS=${HESTIA_STATION_ALLOWED_HOSTS}"
    fi
    echo "# HESTIA_CODICE_CORS_ORIGIN=https://<ORIGEM_WEB_DO_CODICE>"
    echo "# Autenticação do aplicativo Kódice. Obrigatória apenas quando"
    echo "# HESTIA_STATION_CODICE_ENABLED=1."
    echo "#"
    echo "# HESTIA_CODICE_SUPABASE_URL=https://<PROJETO>.supabase.co"
    echo "# HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<CHAVE>"
    echo "# HESTIA_CODICE_ALLOWED_USER_IDS=<UUID_SUPABASE>"
    echo "# HESTIA_STATION_ALLOWED_HOSTS=<HOST_PRIVADO>"
  } > "$ENV_FILE"
  log "configuração criada em $ENV_FILE"
else
  if [ "$PORT_EXPLICIT" -eq 1 ]; then
    CURRENT_PORT="$(awk -F= '$1 == "HESTIA_STATION_PORT" { count += 1; value = substr($0, index($0, "=") + 1) } END { if (count == 1) print value; else exit 1 }' "$ENV_FILE")" || fail "não foi possível ler HESTIA_STATION_PORT da configuração existente."
    valid_station_port "$CURRENT_PORT" || fail "HESTIA_STATION_PORT da configuração existente é inválida."
    [ "$((10#$CURRENT_PORT))" -eq "$((10#$STATION_PORT))" ] || fail "Configuração existente usa a porta $CURRENT_PORT. Edite $ENV_FILE explicitamente para mudar para $STATION_PORT."
  fi
  log "configuração existente preservada em $ENV_FILE"
fi
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"

hestia_safe_remove_runtime_path "$NEW_RUNTIME"
hestia_safe_remove_runtime_path "$PREVIOUS_RUNTIME"
install -d -m 0755 -o root -g root "$NEW_RUNTIME"
cp -a "$STAGING/." "$NEW_RUNTIME/"
chmod 0755 "$NEW_RUNTIME"
chown -R root:root "$NEW_RUNTIME"
[ -f "$NEW_RUNTIME/station.js" ] && [ -f "$NEW_RUNTIME/scripts/station-doctor.mjs" ] && [ -d "$NEW_RUNTIME/node_modules/fastify" ] || fail "novo runtime mínimo da Station incompleto."
node --check "$NEW_RUNTIME/station.js" >/dev/null || fail "novo runtime da Station inválido."

escape() { printf '%s' "$1" | sed 's/[\&#]/\\&/g'; }
sed -e "s#__NODE_BIN__#$(escape "$NODE_BIN")#g" \
  -e "s#__RUNTIME_DIR__#$(escape "$RUNTIME_DIR")#g" \
  -e "s#__SERVICE_USER__#$(escape "$SERVICE_USER")#g" \
  -e "s#__SERVICE_GROUP__#$(escape "$SERVICE_GROUP")#g" \
  "$SOURCE_DIR/packaging/$SERVICE_NAME.service.in" > "$NEW_UNIT"
chmod 0644 "$NEW_UNIT"

if [ -e "$RUNTIME_DIR" ]; then
  hestia_assert_runtime_target
  mv -- "$RUNTIME_DIR" "$PREVIOUS_RUNTIME"
  PREVIOUS_RUNTIME_MOVED=1
fi
mv -- "$NEW_RUNTIME" "$RUNTIME_DIR"
RUNTIME_ACTIVATED=1
if [ -e "$UNIT_FILE" ]; then
  [ ! -L "$UNIT_FILE" ] || fail "unit file não pode ser symlink."
  mv -- "$UNIT_FILE" "$PREVIOUS_UNIT"
  PREVIOUS_UNIT_MOVED=1
fi
mv -- "$NEW_UNIT" "$UNIT_FILE"
UNIT_ACTIVATED=1

"$SYSTEMCTL_BIN" daemon-reload
"$SYSTEMCTL_BIN" enable --now "$SERVICE_NAME.service"
"$SYSTEMCTL_BIN" restart "$SERVICE_NAME.service"
ACTIVE=0
ATTEMPTS=10
[ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ] && ATTEMPTS=1
for ((_attempt = 1; _attempt <= ATTEMPTS; _attempt += 1)); do
  "$SYSTEMCTL_BIN" is-active --quiet "$SERVICE_NAME.service" && { ACTIVE=1; break; }
  [ "$_attempt" -eq "$ATTEMPTS" ] || sleep 1
done
[ "$ACTIVE" -eq 1 ] || fail "serviço não ficou ativo em até 10 segundos."

DOCTOR_OK=0
DOCTOR_OUTPUT=""
ATTEMPTS=5
[ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ] && ATTEMPTS=1
for ((_attempt = 1; _attempt <= ATTEMPTS; _attempt += 1)); do
  if DOCTOR_OUTPUT="$("$NODE_BIN" "$RUNTIME_DIR/scripts/station-doctor.mjs" --env-file "$ENV_FILE" --require-systemd --timeout-ms 10000 2>&1)"; then DOCTOR_OK=1; break; fi
  [ "$_attempt" -eq "$ATTEMPTS" ] || sleep 1
done
printf '%s\n' "$DOCTOR_OUTPUT"
[ "$DOCTOR_OK" -eq 1 ] || fail "serviço ficou ativo, mas o Station Doctor não passou após 5 tentativas."

INSTALL_OK=1
hestia_safe_remove_runtime_path "$PREVIOUS_RUNTIME"
rm -f -- "$PREVIOUS_UNIT"
log "runtime instalado em $RUNTIME_DIR e verificado"
