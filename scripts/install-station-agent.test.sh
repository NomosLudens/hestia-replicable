#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_NODE="$(command -v node)"
TEST_ROOT="$(mktemp -d /tmp/hestia-install-test-station-XXXXXX)"
SOURCE="$TEST_ROOT/source"
BIN="$TEST_ROOT/bin"
TOKEN="installer-test-secret-token"
mkdir -p "$SOURCE/chama" "$SOURCE/scripts" "$SOURCE/packaging/station-runtime" "$BIN"
trap 'rm -rf "$TEST_ROOT" "${OUTSIDE:-}"' EXIT
cp "$ROOT_DIR/station.js" "$SOURCE/"
cp "$ROOT_DIR/packaging/station-runtime/package.json" "$ROOT_DIR/packaging/station-runtime/package-lock.json" "$SOURCE/packaging/station-runtime/"
cp "$ROOT_DIR/packaging/hestia-station-agent.service.in" "$SOURCE/packaging/"
cp "$ROOT_DIR/scripts/station-doctor.mjs" "$ROOT_DIR/scripts/require-node.mjs" "$SOURCE/scripts/"
for file in codice.js codiceAuth.js codiceReadOnlyRoutes.js config.js dataDir.js events.js legacyStorageConfig.js retention.js security.js services.js serviceReport.js softwareInventory.js stationAgent.js stationClient.js stationDoctor.js systemStatus.js storage.js storageModel.js storageScanner.js storageSources.js tunnels.js updates.js; do cp "$ROOT_DIR/chama/$file" "$SOURCE/chama/$file"; done
fail() { echo "[station-install-test] ERRO: $*" >&2; exit 1; }

cat > "$BIN/id" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in -u) [ "$#" -eq 1 ] && echo 0 || echo 1000;; -gn) echo station-test;; *) exit 0;; esac
EOF
cat > "$BIN/node" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  --check|*require-node.mjs) exit 0;;
  -e) printf '%s' '$TOKEN'; exit 0;;
  *station-doctor.mjs) [ "\${HESTIA_FAKE_DOCTOR_FAIL:-0}" = 1 ] && exit 1; echo 'Station Doctor: OK'; exit 0;;
esac
exit 0
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
[ "${HESTIA_FAKE_NPM_FAIL:-0}" = 1 ] && exit 20
if [[ -v npm_config_cache || -v NPM_CONFIG_CACHE ]]; then exit 22; fi
prefix=""
while [ "$#" -gt 0 ]; do [ "$1" = "--prefix" ] && { prefix="$2"; shift 2; continue; }; shift; done
[ -n "$prefix" ] && mkdir -p "$prefix/node_modules/fastify"
EOF
cat > "$BIN/runuser" <<'EOF'
#!/usr/bin/env bash
shift 2; [ "${1:-}" = "--" ] && shift; exec "$@"
EOF
cat > "$BIN/getent" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = "passwd" ] && echo "station-test:x:1000:1000::/tmp:/bin/false"
EOF
cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
[ "${HESTIA_FAKE_SYSTEMCTL_FAIL:-}" = "${1:-}" ] && exit 21
[ "${1:-}" = "is-active" ] && [ "${HESTIA_FAKE_SYSTEMCTL_INACTIVE:-0}" = 1 ] && exit 1
exit 0
EOF
cat > "$BIN/install" <<'EOF'
#!/usr/bin/env bash
args=()
while [ "$#" -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done
exec /usr/bin/install "${args[@]}"
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/chown"
chmod +x "$BIN"/*

run_install() {
  local name="$1"; shift
  env -u HESTIA_STATION_PORT -u HESTIA_STATION_INSTALL_ROOT -u HESTIA_STATION_ENV_FILE -u HESTIA_STATION_UNIT_FILE -u HESTIA_SYSTEMCTL_BIN \
    PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_SOURCE_DIR="$SOURCE" \
    HESTIA_STATION_SERVICE_USER=station-test HESTIA_STATION_ENV_FILE="$TEST_ROOT/$name/station.env" \
    HESTIA_STATION_UNIT_FILE="$TEST_ROOT/$name/station.service" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/$name/runtime" \
    HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" "$@" bash "$ROOT_DIR/scripts/install-station-agent.sh"
}

output="$(run_install desktop env npm_config_cache=/root/.npm NPM_CONFIG_CACHE=/root/.npm 2>&1)"
grep -Fqx 'HESTIA_STATION_PORT=4518' "$TEST_ROOT/desktop/station.env" || fail "porta padrão incorreta"
grep -Fqx 'HESTIA_STATION_ORGANIZER_ENABLED=0' "$TEST_ROOT/desktop/station.env" || fail "Organizer não foi desativado"
grep -Fqx 'HESTIA_STATION_CODICE_ENABLED=0' "$TEST_ROOT/desktop/station.env" || fail "Códice não foi desativado"
grep -Fqx '# HESTIA_CODICE_CORS_ORIGIN=https://<ORIGEM_WEB_DO_CODICE>' "$TEST_ROOT/desktop/station.env" || fail "placeholder CORS incorreto"
grep -Fq "WorkingDirectory=$TEST_ROOT/desktop/runtime" "$TEST_ROOT/desktop/station.service" || fail "unit depende do checkout"
[ -f "$TEST_ROOT/desktop/runtime/station.js" ] && [ -d "$TEST_ROOT/desktop/runtime/node_modules/fastify" ] || fail "runtime mínimo não instalado"
[ -f "$TEST_ROOT/desktop/runtime/chama/codiceAuth.js" ] || fail "helper de autenticação não instalado"
[ "$(stat -c '%a' "$TEST_ROOT/desktop/runtime")" = 755 ] || fail "runtime final não possui modo 755"
[ ! -e "$TEST_ROOT/desktop/runtime/src" ] && [ ! -e "$TEST_ROOT/desktop/runtime/dist" ] || fail "frontend foi copiado"
[[ "$output" != *"$TOKEN"* ]] || fail "token vazou"
[[ "$output" != *"sb_publishable_"* ]] || fail "configuração sensível apareceu no log"
"$REAL_NODE" --input-type=module -e "await import('file://$TEST_ROOT/desktop/runtime/chama/codiceAuth.js')" || fail "runtime não importou codiceAuth.js"
rm -rf "$TEST_ROOT/desktop/runtime/node_modules"
ln -s "$ROOT_DIR/node_modules" "$TEST_ROOT/desktop/runtime/node_modules"
RUNTIME_PORT="$("$REAL_NODE" -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
env NODE_ENV=test HESTIA_STATION_HOST=127.0.0.1 HESTIA_STATION_PORT="$RUNTIME_PORT" HESTIA_STATION_TOKEN="$TOKEN" \
  "$REAL_NODE" "$TEST_ROOT/desktop/runtime/station.js" > "$TEST_ROOT/runtime-import.log" 2>&1 &
RUNTIME_PID=$!
RUNTIME_READY=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$RUNTIME_PORT/api/station/health" >/dev/null 2>&1; then RUNTIME_READY=1; break; fi
  sleep 0.1
done
kill -TERM "$RUNTIME_PID" 2>/dev/null || true
wait "$RUNTIME_PID" 2>/dev/null || true
[ "$RUNTIME_READY" -eq 1 ] || { sed "s/$TOKEN/[REDACTED]/g" "$TEST_ROOT/runtime-import.log" >&2; fail "runtime instalado não importou station.js"; }

run_install tvbox env HESTIA_STATION_PORT=4519 >/dev/null
grep -Fqx 'HESTIA_STATION_PORT=4519' "$TEST_ROOT/tvbox/station.env" || fail "porta TV Box incorreta"
for invalid in 0 -1 1.5 texto 65536 " 4519" "4519 "; do if run_install invalid env HESTIA_STATION_PORT="$invalid" >/dev/null 2>&1; then fail "porta inválida aceita: $invalid"; fi; done

printf 'runtime-antigo\n' > "$TEST_ROOT/desktop/runtime/rollback-marker"
env_hash="$(sha256sum "$TEST_ROOT/desktop/station.env")"
if run_install desktop env HESTIA_FAKE_NPM_FAIL=1 >/dev/null 2>&1; then fail "falha antes do swap foi aceita"; fi
[ -f "$TEST_ROOT/desktop/runtime/rollback-marker" ] || fail "falha antes do swap alterou runtime"
if run_install desktop env HESTIA_FAKE_SYSTEMCTL_FAIL=restart >/dev/null 2>&1; then fail "falha de restart foi aceita"; fi
[ -f "$TEST_ROOT/desktop/runtime/rollback-marker" ] || fail "rollback de restart falhou"
if run_install desktop env HESTIA_FAKE_DOCTOR_FAIL=1 >/dev/null 2>&1; then fail "falha do Doctor foi aceita"; fi
[ -f "$TEST_ROOT/desktop/runtime/rollback-marker" ] || fail "rollback de Doctor falhou"
[ "$(sha256sum "$TEST_ROOT/desktop/station.env")" = "$env_hash" ] || fail "env/token foi alterado"
[ -z "$(find "$TEST_ROOT/desktop" -maxdepth 1 \( -name '*.new.*' -o -name '*.previous.*' \) -print -quit)" ] || fail "temporários sobraram"

run_install desktop env >/dev/null
[ ! -e "$TEST_ROOT/desktop/runtime/rollback-marker" ] || fail "atualização bem-sucedida não ativou runtime novo"
mv "$SOURCE" "$TEST_ROOT/source.removed"
[ -f "$TEST_ROOT/desktop/runtime/station.js" ] && grep -Fq "WorkingDirectory=$TEST_ROOT/desktop/runtime" "$TEST_ROOT/desktop/station.service" || fail "runtime depende do checkout"
SOURCE="$TEST_ROOT/source.removed"

OUTSIDE="$TEST_ROOT-outside"; mkdir -p "$OUTSIDE"; printf 'intacto\n' > "$OUTSIDE/sentinel"
printf 'external-station-env\n' > "$OUTSIDE/env"; chmod 0640 "$OUTSIDE/env"
external_hash="$(sha256sum "$OUTSIDE/env")"; external_mode="$(stat -c '%a' "$OUTSIDE/env")"
reject_existing_env() {
  local kind="$1" output
  rm -rf "$TEST_ROOT/desktop/station.env"
  case "$kind" in
    outside) ln -s "$OUTSIDE/env" "$TEST_ROOT/desktop/station.env" ;;
    inside) printf 'inside-target\n' > "$TEST_ROOT/inside-station-env"; ln -s "$TEST_ROOT/inside-station-env" "$TEST_ROOT/desktop/station.env" ;;
    broken) ln -s "$OUTSIDE/missing" "$TEST_ROOT/desktop/station.env" ;;
    directory) mkdir "$TEST_ROOT/desktop/station.env" ;;
    fifo) mkfifo "$TEST_ROOT/desktop/station.env" ;;
  esac
  printf 'runtime-antigo\n' > "$TEST_ROOT/desktop/runtime/env-safety-marker"
  if output="$(run_install desktop env 2>&1)"; then fail "env inseguro aceito pelo instalador: $kind"; fi
  [ -f "$TEST_ROOT/desktop/runtime/env-safety-marker" ] || fail "runtime alterado por env inseguro: $kind"
  [[ "$output" != *external-station-env* ]] || fail "conteúdo de env apareceu na saída: $kind"
  rm -rf "$TEST_ROOT/desktop/station.env"
}
for env_kind in outside inside broken directory fifo; do reject_existing_env "$env_kind"; done
[ "$(sha256sum "$OUTSIDE/env")" = "$external_hash" ] || fail "destino externo do env foi alterado"
[ "$(stat -c '%a' "$OUTSIDE/env")" = "$external_mode" ] || fail "modo do destino externo foi alterado"
reject_install() {
  if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_SOURCE_DIR="$SOURCE" \
    HESTIA_STATION_SERVICE_USER=station-test HESTIA_STATION_INSTALL_ROOT="$1" HESTIA_STATION_ENV_FILE="$TEST_ROOT/reject-install/env" \
    HESTIA_STATION_UNIT_FILE="$TEST_ROOT/reject-install/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" \
    bash "$ROOT_DIR/scripts/install-station-agent.sh" >/dev/null 2>&1; then fail "runtime inseguro aceito pelo instalador: $1"; fi
}
for unsafe in / /etc /usr /home /KALINE /opt /tmp /opt/../etc relative "$OUTSIDE/runtime"; do reject_install "$unsafe"; done
ln -s "$OUTSIDE" "$TEST_ROOT/install-escape"; reject_install "$TEST_ROOT/install-escape/runtime"
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_SOURCE_DIR="$SOURCE" \
  HESTIA_STATION_SERVICE_USER=station-test HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" HESTIA_STATION_ENV_FILE="$OUTSIDE/env" \
  HESTIA_STATION_UNIT_FILE="$TEST_ROOT/reject-install/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/install-station-agent.sh" >/dev/null 2>&1; then fail "env fora da raiz aceito pelo instalador"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_SOURCE_DIR="$SOURCE" \
  HESTIA_STATION_SERVICE_USER=station-test HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" HESTIA_STATION_ENV_FILE="$TEST_ROOT/reject-install/env" \
  HESTIA_STATION_UNIT_FILE="$OUTSIDE/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/install-station-agent.sh" >/dev/null 2>&1; then fail "unit fora da raiz aceita pelo instalador"; fi
for bad_systemctl in "$OUTSIDE/systemctl" "$BIN/systemctl --quiet"; do
  if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_SOURCE_DIR="$SOURCE" \
    HESTIA_STATION_SERVICE_USER=station-test HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" HESTIA_STATION_ENV_FILE="$TEST_ROOT/reject-install/env" \
    HESTIA_STATION_UNIT_FILE="$TEST_ROOT/reject-install/unit" HESTIA_SYSTEMCTL_BIN="$bad_systemctl" bash "$ROOT_DIR/scripts/install-station-agent.sh" >/dev/null 2>&1; then fail "systemctl inseguro aceito pelo instalador"; fi
done
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 bash "$ROOT_DIR/scripts/install-station-agent.sh" >/dev/null 2>&1; then fail "instalador aceitou modo de teste sem raiz"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" bash "$ROOT_DIR/scripts/install-station-agent.sh" >/dev/null 2>&1; then fail "override operacional aceito pelo instalador"; fi
reject_uninstall() {
  if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
    HESTIA_STATION_INSTALL_ROOT="$1" HESTIA_STATION_ENV_FILE="$TEST_ROOT/reject/env" \
    HESTIA_STATION_UNIT_FILE="$TEST_ROOT/reject/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" \
    bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null 2>&1; then fail "runtime inseguro aceito: $1"; fi
}
for unsafe in / /etc /usr /home /KALINE /opt /tmp /opt/../etc relative "$OUTSIDE/runtime"; do reject_uninstall "$unsafe"; done
ln -s "$OUTSIDE" "$TEST_ROOT/escape"; reject_uninstall "$TEST_ROOT/escape/runtime"
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject/runtime" HESTIA_STATION_ENV_FILE="$OUTSIDE/env" HESTIA_STATION_UNIT_FILE="$TEST_ROOT/reject/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null 2>&1; then fail "env fora da raiz aceito"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject/runtime" HESTIA_STATION_ENV_FILE="$TEST_ROOT/reject/env" HESTIA_STATION_UNIT_FILE="$OUTSIDE/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null 2>&1; then fail "unit fora da raiz aceita"; fi
for bad_systemctl in "$OUTSIDE/systemctl" "$BIN/systemctl --quiet"; do if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject/runtime" HESTIA_STATION_ENV_FILE="$TEST_ROOT/reject/env" HESTIA_STATION_UNIT_FILE="$TEST_ROOT/reject/unit" HESTIA_SYSTEMCTL_BIN="$bad_systemctl" bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null 2>&1; then fail "systemctl inseguro aceito"; fi; done
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null 2>&1; then fail "test mode sem raiz aceito"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/reject/runtime" bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null 2>&1; then fail "override operacional aceito"; fi
[ "$(cat "$OUTSIDE/sentinel")" = intacto ] || fail "arquivo externo foi alterado"

mkdir -p "$TEST_ROOT/uninstall/runtime"; printf 'secret\n' > "$TEST_ROOT/uninstall/env"; printf 'unit\n' > "$TEST_ROOT/uninstall/unit"
common=(PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_STATION_INSTALL_ROOT="$TEST_ROOT/uninstall/runtime" HESTIA_STATION_ENV_FILE="$TEST_ROOT/uninstall/env" HESTIA_STATION_UNIT_FILE="$TEST_ROOT/uninstall/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" HESTIA_FAKE_SYSTEMCTL_INACTIVE=1)
env "${common[@]}" bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" >/dev/null
[ -f "$TEST_ROOT/uninstall/env" ] && [ ! -e "$TEST_ROOT/uninstall/runtime" ] || fail "uninstall padrão incorreto"
env "${common[@]}" bash "$ROOT_DIR/scripts/uninstall-station-agent.sh" --purge >/dev/null
[ ! -e "$TEST_ROOT/uninstall/env" ] || fail "purge preservou env"

echo "Station installer safety and rollback tests: OK"
