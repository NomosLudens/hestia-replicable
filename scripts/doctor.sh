#!/usr/bin/env bash
set -u -o pipefail
SERVICE_NAME="${HESTIA_SERVICE_NAME:-hestia-console}"
BASE_URL="${HESTIA_URL:-http://127.0.0.1:4517}"
DESKTOP_FILE="${HESTIA_DESKTOP_FILE:-/usr/share/applications/hestia-console.desktop}"
KALINE_ROOT="${HESTIA_STORAGE_PATH:-${HESTIA_KALINE_ROOT:-/KALINE}}"
DATA_DIR="${HESTIA_DATA_DIR:-}"
if [ -z "$DATA_DIR" ] && [ -n "${STATE_DIRECTORY:-}" ]; then
  DATA_DIR="${STATE_DIRECTORY%%:*}"
fi
DATA_DIR="${DATA_DIR:-${HOME:-/tmp}/.chama/data}"
fail=0
ok(){ echo "ok: $*"; }
warn(){ echo "warn: $*"; }
bad(){ echo "erro: $*"; fail=1; }
check_path(){ [ -e "$1" ] && ok "$1 existe" || bad "$1 ausente"; }
check_command(){ command -v "$1" >/dev/null 2>&1 && ok "$1 disponível ($(command -v "$1"))" || warn "$1 não encontrado no PATH"; }
if command -v node >/dev/null 2>&1; then node "$(dirname "$0")/require-node.mjs" && ok "Node $(node -v)" || bad "Node >=22.13.0 necessário (detectado $(node -v 2>/dev/null || echo n/a))"; else bad "node ausente"; fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || bad "npm ausente"
[ -d dist/client ] && ok "dist/client existe" || bad "dist/client ausente; rode npm run build"
if [ -f dist/server/index.mjs ] || [ -f dist/server/server.js ] || [ -f .output/server/index.mjs ]; then ok "bundle SSR encontrado"; else bad "bundle SSR ausente; rode npm run build"; fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-unit-files "$SERVICE_NAME.service" --no-legend 2>/dev/null | grep -q . && ok "serviço $SERVICE_NAME existe" || warn "serviço $SERVICE_NAME não instalado"
  systemctl is-active --quiet "$SERVICE_NAME.service" 2>/dev/null && active=1 || active=0
  [ "$active" -eq 1 ] && ok "serviço $SERVICE_NAME ativo" || warn "serviço $SERVICE_NAME inativo"
else warn "systemctl indisponível"; active=0; fi
check_command hestia-console
check_command hestia-console-status
check_command hestia-console-stop
if [ -f "$DESKTOP_FILE" ]; then
  ok "$DESKTOP_FILE existe"
  grep -qx "Exec=hestia-console" "$DESKTOP_FILE" && ok "desktop Exec=hestia-console" || warn "desktop sem Exec=hestia-console"
  grep -qx "Icon=hestia-console" "$DESKTOP_FILE" && ok "desktop Icon=hestia-console" || warn "desktop sem Icon=hestia-console"
  grep -qx "Terminal=false" "$DESKTOP_FILE" && ok "desktop Terminal=false" || warn "desktop abre terminal"
else
  warn "$DESKTOP_FILE ausente; launcher .desktop não instalado"
fi
if [ -e "$KALINE_ROOT" ]; then
  ok "$KALINE_ROOT existe"
elif [ "${HESTIA_REQUIRE_KALINE:-0}" = "1" ]; then
  bad "$KALINE_ROOT ausente"
else
  warn "$KALINE_ROOT ausente"
fi

[ -w "$KALINE_ROOT" ] && ok "$KALINE_ROOT gravável pelo usuário atual" || warn "$KALINE_ROOT não é gravável pelo usuário atual"
[ -d "$KALINE_ROOT/entrada" ] && ok "$KALINE_ROOT/entrada existe" || warn "$KALINE_ROOT/entrada ausente; crie o diretório manualmente ou configure HESTIA_STORAGE_PATH"
if command -v findmnt >/dev/null 2>&1 && findmnt -n -T "$KALINE_ROOT" >/dev/null 2>&1; then
  fs="$(findmnt -n -T "$KALINE_ROOT" -o FSTYPE 2>/dev/null | head -n1)"
  ok "$KALINE_ROOT fstype=$fs"
  case "$fs" in fuseblk|ntfs|ntfs-3g) warn "NTFS/fuseblk: permissões vêm das opções de montagem; chown/chgrp/chmod podem não funcionar. Use HESTIA_SERVICE_USER=<dono do mount> para organizer.";; esac
fi
if command -v curl >/dev/null 2>&1; then
  if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then
    ok "$BASE_URL/api/health responde"
  elif [ "${active:-0}" -eq 1 ]; then
    bad "$BASE_URL/api/health não respondeu com serviço ativo"
  else
    warn "$BASE_URL/api/health não respondeu; serviço local aparentemente inativo"
  fi
else
  warn "curl indisponível; pulando checagens HTTP"
fi
exit "$fail"
