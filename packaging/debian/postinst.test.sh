#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTER="$(mktemp -d /tmp/hestia-postinst-test-XXXXXX)"
trap 'rm -rf "$OUTER"' EXIT
fail() { echo "[postinst-test] ERRO: $*" >&2; exit 1; }

prepare_case() {
  local root="$1"
  mkdir -p "$root/bin" "$root/opt/hestia-console/scripts" "$root/etc/default"
  cp "$ROOT_DIR/scripts/install-safety.sh" "$ROOT_DIR/scripts/require-node.mjs" "$ROOT_DIR/scripts/console-doctor.mjs" "$root/opt/hestia-console/scripts/"
  printf 'runtime\n' > "$root/opt/hestia-console/hestia.js"
  for command in bash dirname realpath chmod; do ln -s "$(command -v "$command")" "$root/bin/$command"; done
  cat > "$root/bin/install" <<'EOF'
#!/usr/bin/env bash
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac
done
exec /usr/bin/install "${args[@]}"
EOF
  for command in chown addgroup adduser; do printf '#!/usr/bin/env bash\nexit 0\n' > "$root/bin/$command"; done
  cat > "$root/bin/getent" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in group) echo 'hestia-console:x:1001:';; passwd) echo 'hestia-console:x:1001:1001::/opt/hestia-console:/usr/sbin/nologin';; esac
EOF
  cat > "$root/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
[ -n "${POSTINST_SYSTEMCTL_LOG:-}" ] && printf '%s\n' "$*" >> "$POSTINST_SYSTEMCTL_LOG"
[ "${POSTINST_SERVICE_INACTIVE:-0}" = 1 ] && [ "${1:-}" = is-active ] && exit 1
exit 0
EOF
  find "$root/bin" -type f -exec chmod +x {} +
}

write_node() {
  local root="$1"
  cat > "$root/bin/node" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  *require-node.mjs) [ "${POSTINST_NODE_OLD:-0}" = 1 ] && exit 1; exit 0;;
  *console-doctor.mjs) [ -n "${POSTINST_DOCTOR_LOG:-}" ] && : > "$POSTINST_DOCTOR_LOG"; [ "${POSTINST_DOCTOR_FAIL:-0}" = 1 ] && { echo 'Console Doctor: FALHOU'; exit 1; }; echo 'Console Doctor: OK'; exit 0;;
esac
exit 0
EOF
  chmod +x "$root/bin/node"
}

run_postinst() {
  local root="$1"; shift
  env PATH="$root/bin" HESTIA_INSTALL_TEST_MODE=1 HESTIA_TEST_ROOT="$root" "$@" \
    bash "$ROOT_DIR/packaging/debian/postinst"
}

root="$OUTER/no-node"; prepare_case "$root"
if run_postinst "$root" >/dev/null 2>&1; then fail "Node ausente foi aceito"; fi

root="$OUTER/old-node"; prepare_case "$root"; write_node "$root"
if run_postinst "$root" env POSTINST_NODE_OLD=1 >/dev/null 2>&1; then fail "Node antigo foi aceito"; fi

root="$OUTER/inactive"; prepare_case "$root"; write_node "$root"
if run_postinst "$root" env POSTINST_SERVICE_INACTIVE=1 >/dev/null 2>&1; then fail "serviço inativo foi aceito"; fi

root="$OUTER/doctor"; prepare_case "$root"; write_node "$root"
if run_postinst "$root" env POSTINST_DOCTOR_FAIL=1 >/dev/null 2>&1; then fail "Doctor falho foi aceito"; fi

root="$OUTER/success"; prepare_case "$root"; write_node "$root"
printf 'HESTIA_DESKTOP_TOKEN=postinst-secret\n' > "$root/etc/default/hestia-console"
before="$(sha256sum "$root/etc/default/hestia-console")"
output="$(run_postinst "$root" 2>&1)"
[ "$(sha256sum "$root/etc/default/hestia-console")" = "$before" ] || fail "env existente foi sobrescrito"
grep -Fq 'Héstia Console instalada e validada.' <<<"$output" || fail "mensagem final de sucesso ausente"
[[ "$output" != *postinst-secret* ]] || fail "token apareceu na saída"

root="$OUTER/env-symlink"; prepare_case "$root"; write_node "$root"
printf 'external-postinst-env\n' > "$OUTER/postinst-target"
chmod 0640 "$OUTER/postinst-target"
target_hash="$(sha256sum "$OUTER/postinst-target")"; target_mode="$(stat -c '%a' "$OUTER/postinst-target")"
ln -s "$OUTER/postinst-target" "$root/etc/default/hestia-console"
if run_postinst "$root" env POSTINST_DOCTOR_LOG="$root/doctor.log" POSTINST_SYSTEMCTL_LOG="$root/systemctl.log" >/dev/null 2>&1; then fail "env symlink foi aceito"; fi
[ "$(sha256sum "$OUTER/postinst-target")" = "$target_hash" ] || fail "destino do symlink foi alterado"
[ "$(stat -c '%a' "$OUTER/postinst-target")" = "$target_mode" ] || fail "modo do destino do symlink foi alterado"
[ ! -e "$root/doctor.log" ] || fail "Doctor executou para env symlink"
[ ! -e "$root/systemctl.log" ] || fail "serviço foi operado para env symlink"

root="$OUTER/env-special"; prepare_case "$root"; write_node "$root"
mkdir "$root/etc/default/hestia-console"
if run_postinst "$root" >/dev/null 2>&1; then fail "env diretório foi aceito"; fi
rm -rf "$root/etc/default/hestia-console"
mkfifo "$root/etc/default/hestia-console"
if run_postinst "$root" >/dev/null 2>&1; then fail "env FIFO foi aceito"; fi

echo "Debian postinst failure tests: OK"
