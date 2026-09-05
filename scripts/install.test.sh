#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/hestia-install-test-console-XXXXXX)"
SOURCE="$TEST_ROOT/source"
BIN="$TEST_ROOT/bin"
mkdir -p "$SOURCE/scripts" "$SOURCE/packaging" "$BIN"
trap 'rm -rf "$TEST_ROOT"' EXIT
cp "$ROOT_DIR/hestia.js" "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$SOURCE/"
cp -a "$ROOT_DIR/chama" "$SOURCE/chama"
cp "$ROOT_DIR/scripts/require-node.mjs" "$ROOT_DIR/scripts/console-doctor.mjs" "$SOURCE/scripts/"
cp "$ROOT_DIR/packaging/hestia-console.service.in" "$SOURCE/packaging/"
fail() { echo "[install-test] ERRO: $*" >&2; exit 1; }

! grep -q 'TVBOX_TOKEN=.*HESTIA_STATION_TOKEN' "$ROOT_DIR/scripts/install.sh" || \
  fail "installer não pode inferir Station Agent local como TV Box"

cat > "$BIN/id" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in -u) [ "$#" -eq 1 ] && echo 0 || echo 1000;; -gn) echo builder;; *) exit 0;; esac
EOF
cat > "$BIN/node" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  --check) exit 0;;
  *require-node.mjs) exit 0;;
  *console-doctor.mjs)
    [ "${HESTIA_FAKE_DOCTOR_FAIL:-0}" = 1 ] && exit 1
    if [ "${HESTIA_FAKE_DOCTOR_WARNING:-0}" = 1 ]; then echo "aviso: desktop: unavailable"; echo "Console Doctor: OK COM AVISOS"; exit 0; fi
    echo "Console Doctor: OK"; exit 0;;
esac
exit 0
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
[ "${HESTIA_FAKE_NPM_FAIL:-0}" = 1 ] && exit 20
if [[ -v npm_config_cache || -v NPM_CONFIG_CACHE ]]; then exit 22; fi
prefix=""
while [ "$#" -gt 0 ]; do
  [ "$1" = "--prefix" ] && { prefix="$2"; shift 2; continue; }
  [ "$1" = "run" ] && [ "${2:-}" = "build" ] && { mkdir -p "$prefix/dist/client" "$prefix/dist/server"; printf 'bundle' > "$prefix/dist/server/server.js"; }
  shift
done
[ -n "$prefix" ] && mkdir -p "$prefix/node_modules"
EOF
cat > "$BIN/runuser" <<EOF
#!/usr/bin/env bash
printf 'called\n' >> '$TEST_ROOT/runuser.log'
shift 2; [ "\${1:-}" = "--" ] && shift; exec "\$@"
EOF
cat > "$BIN/getent" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in passwd) echo "builder:x:1000:1000::/tmp:/bin/bash";; group) echo "hestia-console:x:1001:";; esac
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
while [ "$#" -gt 0 ]; do
  case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac
done
exec /usr/bin/install "${args[@]}"
EOF
for command in chown addgroup adduser; do printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/$command"; done
chmod +x "$BIN"/*

run_install() {
  local name="$1"; shift
  env -u HESTIA_INSTALL_ROOT -u HESTIA_ENV_FILE -u HESTIA_UNIT_FILE -u HESTIA_SYSTEMCTL_BIN \
    PATH="$BIN:/usr/bin:/bin" SUDO_USER=builder HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
    HESTIA_SOURCE_DIR="$SOURCE" HESTIA_INSTALL_ROOT="$TEST_ROOT/$name/runtime" \
    HESTIA_ENV_FILE="$TEST_ROOT/$name/console.env" HESTIA_UNIT_FILE="$TEST_ROOT/$name/console.service" \
    HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" "$@" bash "$ROOT_DIR/scripts/install.sh"
}

output="$(run_install fresh env npm_config_cache=/root/.npm NPM_CONFIG_CACHE=/root/.npm 2>&1)"
[ -f "$TEST_ROOT/fresh/runtime/hestia.js" ] && [ -f "$TEST_ROOT/fresh/runtime/dist/server/server.js" ] || fail "instalação nova incompleta"
[ "$(stat -c '%a' "$TEST_ROOT/fresh/runtime")" = 755 ] || fail "runtime final não possui modo 755"
grep -Fqx "WorkingDirectory=$TEST_ROOT/fresh/runtime" "$TEST_ROOT/fresh/console.service" || fail "unit depende do checkout"
[ -s "$TEST_ROOT/runuser.log" ] || fail "npm não passou pelo usuário não-root"
[[ "$output" != *"TOKEN_DESKTOP="* ]] || fail "env/token apareceu na saída"

printf 'runtime-antigo\n' > "$TEST_ROOT/fresh/runtime/previous-marker"
env_hash="$(sha256sum "$TEST_ROOT/fresh/console.env")"
run_install fresh env >/dev/null
[ ! -e "$TEST_ROOT/fresh/runtime/previous-marker" ] || fail "atualização não ativou runtime novo"
[ "$(sha256sum "$TEST_ROOT/fresh/console.env")" = "$env_hash" ] || fail "env foi alterado na atualização"

printf 'runtime-antigo\n' > "$TEST_ROOT/fresh/runtime/rollback-marker"
if run_install fresh env HESTIA_FAKE_NPM_FAIL=1 >/dev/null 2>&1; then fail "falha antes do swap foi aceita"; fi
[ -f "$TEST_ROOT/fresh/runtime/rollback-marker" ] || fail "falha antes do swap alterou runtime anterior"
if run_install fresh env HESTIA_FAKE_SYSTEMCTL_FAIL=restart >/dev/null 2>&1; then fail "falha no restart foi aceita"; fi
[ -f "$TEST_ROOT/fresh/runtime/rollback-marker" ] || fail "rollback de restart não restaurou runtime"
if run_install fresh env HESTIA_FAKE_DOCTOR_FAIL=1 >/dev/null 2>&1; then fail "falha no Doctor foi aceita"; fi
[ -f "$TEST_ROOT/fresh/runtime/rollback-marker" ] || fail "rollback de Doctor não restaurou runtime"
[ "$(sha256sum "$TEST_ROOT/fresh/console.env")" = "$env_hash" ] || fail "rollback alterou env"

printf 'runtime-antigo\n' > "$TEST_ROOT/fresh/runtime/sleeping-station-marker"
output="$(run_install fresh env HESTIA_FAKE_DOCTOR_WARNING=1 2>&1)"
[[ "$output" = *"Console Doctor: OK COM AVISOS"* ]] || fail "Doctor com Station offline não gerou aviso"
[ ! -e "$TEST_ROOT/fresh/runtime/sleeping-station-marker" ] || fail "Station offline causou rollback da atualização"
[ "$(sha256sum "$TEST_ROOT/fresh/console.env")" = "$env_hash" ] || fail "instalação com aviso alterou env"

[ -z "$(find "$TEST_ROOT/fresh" -maxdepth 1 \( -name '*.new.*' -o -name '*.previous.*' \) -print -quit)" ] || fail "temporários de swap sobraram"

mv "$SOURCE" "$TEST_ROOT/source.removed"
[ -f "$TEST_ROOT/fresh/runtime/hestia.js" ] && grep -Fqx "WorkingDirectory=$TEST_ROOT/fresh/runtime" "$TEST_ROOT/fresh/console.service" || fail "runtime depende do checkout"
SOURCE="$TEST_ROOT/source.removed"

OUTSIDE="$TEST_ROOT-outside"
mkdir -p "$OUTSIDE"
printf 'intacto\n' > "$OUTSIDE/sentinel"
printf 'external-console-env\n' > "$OUTSIDE/env"
chmod 0640 "$OUTSIDE/env"
external_hash="$(sha256sum "$OUTSIDE/env")"
external_mode="$(stat -c '%a' "$OUTSIDE/env")"
reject_existing_env() {
  local kind="$1" output
  rm -rf "$TEST_ROOT/fresh/console.env"
  case "$kind" in
    outside) ln -s "$OUTSIDE/env" "$TEST_ROOT/fresh/console.env" ;;
    inside) printf 'inside-target\n' > "$TEST_ROOT/inside-env"; ln -s "$TEST_ROOT/inside-env" "$TEST_ROOT/fresh/console.env" ;;
    broken) ln -s "$OUTSIDE/missing" "$TEST_ROOT/fresh/console.env" ;;
    directory) mkdir "$TEST_ROOT/fresh/console.env" ;;
    fifo) mkfifo "$TEST_ROOT/fresh/console.env" ;;
  esac
  printf 'runtime-antigo\n' > "$TEST_ROOT/fresh/runtime/env-safety-marker"
  if output="$(run_install fresh env 2>&1)"; then fail "env inseguro aceito pelo instalador: $kind"; fi
  [ -f "$TEST_ROOT/fresh/runtime/env-safety-marker" ] || fail "runtime alterado por env inseguro: $kind"
  [[ "$output" != *external-console-env* ]] || fail "conteúdo de env apareceu na saída: $kind"
  rm -rf "$TEST_ROOT/fresh/console.env"
}
for env_kind in outside inside broken directory fifo; do reject_existing_env "$env_kind"; done
[ "$(sha256sum "$OUTSIDE/env")" = "$external_hash" ] || fail "destino externo do env foi alterado"
[ "$(stat -c '%a' "$OUTSIDE/env")" = "$external_mode" ] || fail "modo do destino externo foi alterado"
reject_install() {
  if env PATH="$BIN:/usr/bin:/bin" SUDO_USER=builder HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
    HESTIA_SOURCE_DIR="$SOURCE" HESTIA_INSTALL_ROOT="$1" HESTIA_ENV_FILE="$TEST_ROOT/reject-install/env" \
    HESTIA_UNIT_FILE="$TEST_ROOT/reject-install/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" \
    bash "$ROOT_DIR/scripts/install.sh" >/dev/null 2>&1; then fail "runtime inseguro aceito pelo instalador: $1"; fi
}
for unsafe in / /etc /usr /home /KALINE /opt /tmp /opt/../etc relative "$OUTSIDE/runtime"; do reject_install "$unsafe"; done
ln -s "$OUTSIDE" "$TEST_ROOT/install-escape"
reject_install "$TEST_ROOT/install-escape/runtime"
if env PATH="$BIN:/usr/bin:/bin" SUDO_USER=builder HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
  HESTIA_SOURCE_DIR="$SOURCE" HESTIA_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" HESTIA_ENV_FILE="$OUTSIDE/env" \
  HESTIA_UNIT_FILE="$TEST_ROOT/reject-install/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/install.sh" >/dev/null 2>&1; then fail "env fora da raiz aceito pelo instalador"; fi
if env PATH="$BIN:/usr/bin:/bin" SUDO_USER=builder HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
  HESTIA_SOURCE_DIR="$SOURCE" HESTIA_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" HESTIA_ENV_FILE="$TEST_ROOT/reject-install/env" \
  HESTIA_UNIT_FILE="$OUTSIDE/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/install.sh" >/dev/null 2>&1; then fail "unit fora da raiz aceita pelo instalador"; fi
for bad_systemctl in "$OUTSIDE/systemctl" "$BIN/systemctl --quiet"; do
  if env PATH="$BIN:/usr/bin:/bin" SUDO_USER=builder HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
    HESTIA_SOURCE_DIR="$SOURCE" HESTIA_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" HESTIA_ENV_FILE="$TEST_ROOT/reject-install/env" \
    HESTIA_UNIT_FILE="$TEST_ROOT/reject-install/unit" HESTIA_SYSTEMCTL_BIN="$bad_systemctl" bash "$ROOT_DIR/scripts/install.sh" >/dev/null 2>&1; then fail "systemctl inseguro aceito pelo instalador"; fi
done
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 bash "$ROOT_DIR/scripts/install.sh" >/dev/null 2>&1; then fail "instalador aceitou modo de teste sem raiz"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_ROOT="$TEST_ROOT/reject-install/runtime" bash "$ROOT_DIR/scripts/install.sh" >/dev/null 2>&1; then fail "override operacional aceito pelo instalador"; fi
reject_uninstall() {
  if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
    HESTIA_INSTALL_ROOT="$1" HESTIA_ENV_FILE="$TEST_ROOT/reject/env" \
    HESTIA_UNIT_FILE="$TEST_ROOT/reject/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" \
    bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null 2>&1; then fail "runtime inseguro aceito: $1"; fi
}
for unsafe in / /etc /usr /home /KALINE /opt /tmp /opt/../etc relative "$OUTSIDE/runtime"; do reject_uninstall "$unsafe"; done
ln -s "$OUTSIDE" "$TEST_ROOT/escape"
reject_uninstall "$TEST_ROOT/escape/runtime"
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
  HESTIA_INSTALL_ROOT="$TEST_ROOT/reject/runtime" HESTIA_ENV_FILE="$OUTSIDE/env" \
  HESTIA_UNIT_FILE="$TEST_ROOT/reject/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null 2>&1; then fail "env fora da raiz aceito"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
  HESTIA_INSTALL_ROOT="$TEST_ROOT/reject/runtime" HESTIA_ENV_FILE="$TEST_ROOT/reject/env" \
  HESTIA_UNIT_FILE="$OUTSIDE/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl" bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null 2>&1; then fail "unit fora da raiz aceita"; fi
for bad_systemctl in "$OUTSIDE/systemctl" "$BIN/systemctl --quiet"; do
  if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" \
    HESTIA_INSTALL_ROOT="$TEST_ROOT/reject/runtime" HESTIA_ENV_FILE="$TEST_ROOT/reject/env" \
    HESTIA_UNIT_FILE="$TEST_ROOT/reject/unit" HESTIA_SYSTEMCTL_BIN="$bad_systemctl" bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null 2>&1; then fail "systemctl inseguro aceito"; fi
done
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null 2>&1; then fail "test mode sem raiz aceito"; fi
if env PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_ROOT="$TEST_ROOT/reject/runtime" bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null 2>&1; then fail "override operacional aceito"; fi
[ "$(cat "$OUTSIDE/sentinel")" = "intacto" ] || fail "arquivo fora da raiz foi alterado"

mkdir -p "$TEST_ROOT/uninstall/runtime"; printf 'secret\n' > "$TEST_ROOT/uninstall/env"; printf 'unit\n' > "$TEST_ROOT/uninstall/unit"
common_uninstall=(PATH="$BIN:/usr/bin:/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$TEST_ROOT" HESTIA_INSTALL_ROOT="$TEST_ROOT/uninstall/runtime" HESTIA_ENV_FILE="$TEST_ROOT/uninstall/env" HESTIA_UNIT_FILE="$TEST_ROOT/uninstall/unit" HESTIA_SYSTEMCTL_BIN="$BIN/systemctl")
env "${common_uninstall[@]}" bash "$ROOT_DIR/scripts/uninstall.sh" >/dev/null
[ -f "$TEST_ROOT/uninstall/env" ] && [ ! -e "$TEST_ROOT/uninstall/runtime" ] || fail "uninstall padrão incorreto"
env "${common_uninstall[@]}" bash "$ROOT_DIR/scripts/uninstall.sh" --purge >/dev/null
[ ! -e "$TEST_ROOT/uninstall/env" ] || fail "purge preservou env"

rm -rf "$OUTSIDE"
echo "Console installer safety and rollback tests: OK"
