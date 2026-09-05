#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [ "$(id -u)" = "0" ] && [ -n "${SUDO_USER:-}" ]; then
  echo "[setup] ERRO: não rode setup/build como root. Use: sudo -u $SUDO_USER npm run setup:local" >&2
  exit 1
fi
if [ -f package-lock.json ]; then npm ci; elif [ -d node_modules ]; then echo "[setup] node_modules já existe"; else npm install; fi
npm run build
