#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-safety.sh
source "$SCRIPT_DIR/install-safety.sh"
hestia_configure_install_paths station
hestia_assert_runtime_target

SERVICE_NAME="hestia-station-agent"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
[ "$#" -le 1 ] && { [ "${1:-}" = "" ] || [ "${1:-}" = "--purge" ]; } || { echo "Uso: $0 [--purge]" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "execute como root" >&2; exit 1; }
command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 || { echo "systemctl não encontrado" >&2; exit 1; }

"$SYSTEMCTL_BIN" disable --now "$SERVICE_NAME.service" 2>/dev/null || true
rm -f -- "$UNIT_FILE"
"$SYSTEMCTL_BIN" daemon-reload
[ ! -e "$UNIT_FILE" ] || { echo "falha ao remover unit" >&2; exit 1; }
if "$SYSTEMCTL_BIN" is-active --quiet "$SERVICE_NAME.service" 2>/dev/null; then echo "serviço continua ativo" >&2; exit 1; fi
hestia_safe_remove_runtime_path "$RUNTIME_DIR"
if [ "$PURGE" -eq 1 ]; then
  rm -f -- "$ENV_FILE"
  echo "[station-uninstall] serviço, runtime e configuração removidos"
else
  echo "[station-uninstall] serviço e runtime removidos; configuração preservada em $ENV_FILE"
fi
