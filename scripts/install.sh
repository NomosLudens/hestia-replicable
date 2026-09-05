#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-safety.sh
source "$SCRIPT_DIR/install-safety.sh"
hestia_configure_install_paths console
hestia_assert_runtime_target

SERVICE_NAME="hestia-console"
if [ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ]; then
  SOURCE_DIR="${HESTIA_SOURCE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  SOURCE_DIR="$(hestia_validate_test_path "source dir" "$SOURCE_DIR")"
else
  [[ ! -v HESTIA_SOURCE_DIR ]] || hestia_safety_fail "HESTIA_SOURCE_DIR é permitido somente em teste."
  SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
SERVICE_USER="${HESTIA_SERVICE_USER:-hestia-console}"
SERVICE_GROUP="${HESTIA_SERVICE_GROUP:-$SERVICE_USER}"

log() { echo "[install] $*"; }
fail() { echo "[install] ERRO: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "execute com sudo para instalar a Console."
command -v node >/dev/null 2>&1 || fail "node não encontrado."
command -v npm >/dev/null 2>&1 || fail "npm não encontrado."
command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 || fail "systemctl não encontrado."
node "$SOURCE_DIR/scripts/require-node.mjs" || fail "versão do Node incompatível."

BUILD_USER="${SUDO_USER:-}"
[ -n "$BUILD_USER" ] && [ "$(id -u "$BUILD_USER")" -ne 0 ] || fail "execute via sudo a partir de um usuário não-root."
BUILD_HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)"
run_as_builder() { runuser -u "$BUILD_USER" -- env -u npm_config_cache -u NPM_CONFIG_CACHE HOME="$BUILD_HOME" "$@" < /dev/null; }

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

log "instalando dependências reproduzivelmente e validando build"
if [ -d "$SOURCE_DIR/dist/client" ] && [ -d "$SOURCE_DIR/dist/server" ]; then
  log "reaproveitando build SSR pré-compilado em dist/"
else
  run_as_builder npm --prefix "$SOURCE_DIR" ci --ignore-scripts --no-audit --no-fund
  run_as_builder npm --prefix "$SOURCE_DIR" run build
fi
[ -d "$SOURCE_DIR/dist/client" ] && [ -d "$SOURCE_DIR/dist/server" ] || fail "build SSR ausente."

STAGING="$(mktemp -d)"
cp "$SOURCE_DIR/hestia.js" "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$STAGING/"
cp -a "$SOURCE_DIR/chama" "$STAGING/chama"
find "$STAGING/chama" -name '*.test.js' -delete
cp -a "$SOURCE_DIR/dist" "$STAGING/dist"
mkdir -p "$STAGING/scripts"
cp "$SOURCE_DIR/scripts/console-doctor.mjs" "$SOURCE_DIR/scripts/require-node.mjs" "$STAGING/scripts/"
chown -R "$BUILD_USER:$(id -gn "$BUILD_USER")" "$STAGING"
run_as_builder npm --prefix "$STAGING" ci --omit=dev --ignore-scripts --no-audit --no-fund

if ! getent group "$SERVICE_GROUP" >/dev/null; then addgroup --system "$SERVICE_GROUP"; fi
if ! getent passwd "$SERVICE_USER" >/dev/null; then
  adduser --system --ingroup "$SERVICE_GROUP" --no-create-home --home "$RUNTIME_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -m 0755 -o root -g root "$(dirname -- "$ENV_FILE")" "$(dirname -- "$UNIT_FILE")" "$(dirname -- "$RUNTIME_DIR")"
if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  hestia_assert_regular_config_file "$ENV_FILE"
fi
if [ ! -e "$ENV_FILE" ]; then
  install -m 0600 -o root -g root /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
HESTIA_HOST=127.0.0.1
HESTIA_PORT=4517
HESTIA_ALLOW_LAN=0

# HESTIA_DESKTOP_BASE_URL=https://<DESKTOP_PRIVADO>
# HESTIA_DESKTOP_TOKEN=<TOKEN_DESKTOP>

HESTIA_TVBOX_BASE_URL=http://127.0.0.1:4519
HESTIA_TVBOX_TOKEN=
HESTIA_STATION_ALLOW_HTTP_LOOPBACK=1

# HESTIA_MINI_BASE_URL=https://<HOST_PRIVADO_DA_MINI>
# HESTIA_MINI_TOKEN=<TOKEN_DA_STATION>

# Configuração de Wake-on-LAN para o servidor (desktop)
# HESTIA_WAKE_SERVER_MAC=AA:BB:CC:DD:EE:FF
# HESTIA_WAKE_BROADCAST_IP=255.255.255.255

HESTIA_STATION_TIMEOUT_MS=5000
HESTIA_ORGANIZER_TIMEOUT_MS=120000
EOF
  log "configuração criada em $ENV_FILE"
else
  log "configuração existente preservada em $ENV_FILE"
fi

if grep -Eq '^# HESTIA_TVBOX_BASE_URL=' "$ENV_FILE" || grep -Eq '^# HESTIA_TVBOX_TOKEN=' "$ENV_FILE"; then
  sed -i 's/^# HESTIA_TVBOX_BASE_URL=.*/HESTIA_TVBOX_BASE_URL=http:\/\/127.0.0.1:4519/' "$ENV_FILE"
  sed -i 's/^# HESTIA_TVBOX_TOKEN=.*/HESTIA_TVBOX_TOKEN=/' "$ENV_FILE"
  if ! grep -q "HESTIA_STATION_ALLOW_HTTP_LOOPBACK=" "$ENV_FILE"; then
    echo "HESTIA_STATION_ALLOW_HTTP_LOOPBACK=1" >> "$ENV_FILE"
  fi
fi

chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
if grep -Eq '^HESTIA_STATION_(BASE_URL|TOKEN)=' "$ENV_FILE"; then
  fail "Configuração legada detectada. Substitua HESTIA_STATION_BASE_URL/TOKEN pelas variáveis de desktop e TV Box."
fi

hestia_safe_remove_runtime_path "$NEW_RUNTIME"
hestia_safe_remove_runtime_path "$PREVIOUS_RUNTIME"
install -d -m 0755 -o root -g root "$NEW_RUNTIME"
cp -a "$STAGING/." "$NEW_RUNTIME/"
chmod 0755 "$NEW_RUNTIME"
chown -R root:root "$NEW_RUNTIME"
[ -f "$NEW_RUNTIME/hestia.js" ] && [ -f "$NEW_RUNTIME/scripts/console-doctor.mjs" ] && [ -d "$NEW_RUNTIME/dist/server" ] || fail "novo runtime da Console incompleto."
node --check "$NEW_RUNTIME/hestia.js" >/dev/null || fail "novo runtime da Console inválido."

escape() { printf '%s' "$1" | sed 's/[\&#]/\\&/g'; }
sed -e "s#__RUNTIME_DIR__#$(escape "$RUNTIME_DIR")#g" \
  -e "s#__SERVICE_USER__#$(escape "$SERVICE_USER")#g" \
  -e "s#__SERVICE_GROUP__#$(escape "$SERVICE_GROUP")#g" \
  "$SOURCE_DIR/packaging/hestia-console.service.in" > "$NEW_UNIT"
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

DOCTOR_OUTPUT=""
DOCTOR_OK=0
ATTEMPTS=5
[ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ] && ATTEMPTS=1
for ((_attempt = 1; _attempt <= ATTEMPTS; _attempt += 1)); do
  if DOCTOR_OUTPUT="$(HESTIA_INSTALL_ROOT="$RUNTIME_DIR" HESTIA_ENV_FILE="$ENV_FILE" node "$RUNTIME_DIR/scripts/console-doctor.mjs" --require-systemd 2>&1)"; then DOCTOR_OK=1; break; fi
  [ "$_attempt" -eq "$ATTEMPTS" ] || sleep 1
done
printf '%s\n' "$DOCTOR_OUTPUT"
[ "$DOCTOR_OK" -eq 1 ] || fail "serviço não passou no Console Doctor."

INSTALL_OK=1
hestia_safe_remove_runtime_path "$PREVIOUS_RUNTIME"
rm -f -- "$PREVIOUS_UNIT"
log "runtime instalado em $RUNTIME_DIR e verificado"
