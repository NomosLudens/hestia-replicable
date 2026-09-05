#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { echo "[build-deb-test] ERRO: $*" >&2; exit 1; }

if HESTIA_DEB_ARCH=armhf bash "$ROOT_DIR/scripts/build-deb.sh" >/dev/null 2>&1; then
  fail "override de arquitetura foi aceito em produção"
fi
for invalid in "" mips64 "armhf;touch /tmp/x"; do
  if HESTIA_BUILD_TEST_MODE=1 HESTIA_BUILD_METADATA_ONLY=1 HESTIA_DEB_ARCH="$invalid" \
    bash "$ROOT_DIR/scripts/build-deb.sh" >/dev/null 2>&1; then
    fail "arquitetura inválida aceita: '$invalid'"
  fi
done
output="$(HESTIA_BUILD_TEST_MODE=1 HESTIA_BUILD_METADATA_ONLY=1 HESTIA_DEB_ARCH=armhf bash "$ROOT_DIR/scripts/build-deb.sh")"
grep -Fq 'Arquivo de metadata: hestia-console_0.1.0_armhf.deb' <<<"$output" || fail "nome armhf incorreto"
grep -Fq 'Architecture: armhf' <<<"$output" || fail "control armhf incorreto"
grep -Fq 'não valida execução na arquitetura armhf' <<<"$output" || fail "aviso de metadata ausente"

echo "Debian architecture metadata tests: OK"
