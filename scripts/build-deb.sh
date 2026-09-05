#!/usr/bin/env bash
# Gera um pacote para a arquitetura nativa informada pelo dpkg.
# Empacota o backend (hestia.js + chama/), o frontend buildado, um serviço
# systemd (bind fixo em 127.0.0.1:4517), um launcher de menu e os ícones.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="hestia-console"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
if [ "${HESTIA_BUILD_TEST_MODE:-0}" = "1" ]; then
  if [[ -v HESTIA_DEB_ARCH ]]; then ARCH="$HESTIA_DEB_ARCH"; else ARCH="$(dpkg --print-architecture)"; fi
  [[ -v HESTIA_DEB_ARCH ]] && echo "[build-deb] TESTE: override altera somente metadata; não valida execução na arquitetura $ARCH."
elif [ "${HESTIA_BUILD_TEST_MODE:-0}" = "0" ]; then
  [ -z "${HESTIA_DEB_ARCH+x}" ] || { echo "[build-deb] ERRO: HESTIA_DEB_ARCH é permitido somente com HESTIA_BUILD_TEST_MODE=1." >&2; exit 1; }
  ARCH="$(dpkg --print-architecture)"
else
  echo "[build-deb] ERRO: HESTIA_BUILD_TEST_MODE aceita somente 0 ou 1." >&2
  exit 1
fi
case "$ARCH" in amd64|arm64|armhf|i386) ;; *) echo "[build-deb] ERRO: arquitetura Debian inválida: $ARCH" >&2; exit 1;; esac
OUT_DIR="$ROOT_DIR/dist-deb"
STAGING="$ROOT_DIR/.deb-staging"
DEB_FILE="$OUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"

log() { echo "[build-deb] $*"; }

[ "$(id -u)" -ne 0 ] || { echo "[build-deb] ERRO: não execute npm/build como root." >&2; exit 1; }
[ "${HESTIA_BUILD_METADATA_ONLY:-0}" = "0" ] || [ "${HESTIA_BUILD_TEST_MODE:-0}" = "1" ] || {
  echo "[build-deb] ERRO: HESTIA_BUILD_METADATA_ONLY é permitido somente em teste." >&2
  exit 1
}
if [ "${HESTIA_BUILD_METADATA_ONLY:-0}" = "1" ]; then
  echo "Arquivo de metadata: ${PKG_NAME}_${VERSION}_${ARCH}.deb"
  sed -e "s/__VERSION__/$VERSION/" -e "s/__ARCH__/$ARCH/" "$ROOT_DIR/packaging/debian/control.template"
  exit 0
elif [ "${HESTIA_BUILD_METADATA_ONLY:-0}" != "0" ]; then
  echo "[build-deb] ERRO: HESTIA_BUILD_METADATA_ONLY aceita somente 0 ou 1." >&2
  exit 1
fi

# --- Pré-requisitos: falha rápido com mensagem clara em vez de erro cru de shell. ------
command -v node >/dev/null 2>&1 || {
  echo "[build-deb] ERRO: node não encontrado. Instale Node.js >=22.13.0 antes de continuar." >&2
  exit 1
}
node "$ROOT_DIR/scripts/require-node.mjs" || exit 1
command -v npm >/dev/null 2>&1 || {
  echo "[build-deb] ERRO: npm não encontrado." >&2
  exit 1
}
command -v dpkg-deb >/dev/null 2>&1 || {
  echo "[build-deb] ERRO: dpkg-deb não encontrado. No Debian/Mint: sudo apt install dpkg-dev." >&2
  exit 1
}
command -v dpkg >/dev/null 2>&1 || {
  echo "[build-deb] ERRO: dpkg não encontrado." >&2
  exit 1
}

log "limpando staging e dist-deb/ anteriores"
rm -rf "$STAGING" "$OUT_DIR"
mkdir -p "$OUT_DIR" "$STAGING/DEBIAN"

if [ -f "$ROOT_DIR/package-lock.json" ]; then
  log "instalando dependências do projeto com npm ci"
  (cd "$ROOT_DIR" && npm ci)
else
  log "package-lock ausente; instalando dependências do projeto com npm install"
  (cd "$ROOT_DIR" && npm install)
fi

log "buildando o frontend"
(cd "$ROOT_DIR" && npm run build)

# hestia.js procura estes mesmos pares (público + bundle SSR) nesta ordem —
# mantém staging consistente com o que o servidor espera encontrar em
# runtime. O build é SSR (bundle Nitro), não uma SPA estática: precisa dos
# dois lados, não só do público.
PUBLIC_SRC=""
for candidate in "dist/client:dist/server/index.mjs" "dist/client:dist/server/server.js" ".output/public:.output/server/index.mjs"; do
  publicRel="${candidate%%:*}"
  serverRel="${candidate##*:}"
  if [ -d "$ROOT_DIR/$publicRel" ] && [ -f "$ROOT_DIR/$serverRel" ]; then
    PUBLIC_SRC="$ROOT_DIR/$publicRel"
    PUBLIC_DEST="$publicRel"
    SERVER_SRC_DIR="$ROOT_DIR/$(dirname "$serverRel")"
    SERVER_DEST_DIR="$(dirname "$serverRel")"
    break
  fi
done
if [ -z "$PUBLIC_SRC" ]; then
  echo "[build-deb] ERRO: build do frontend (SSR) não encontrado (dist/client+dist/server/index.mjs|server.js ou .output/public+.output/server)." >&2
  exit 1
fi
log "frontend encontrado em $PUBLIC_DEST (+ bundle SSR em $SERVER_DEST_DIR)"

APP_DIR="$STAGING/opt/$PKG_NAME"
mkdir -p "$APP_DIR"

log "copiando app para staging ($APP_DIR)"
cp "$ROOT_DIR/hestia.js" "$APP_DIR/"
cp -r "$ROOT_DIR/chama" "$APP_DIR/"
find "$APP_DIR/chama" -name "*.test.js" -delete
cp "$ROOT_DIR/package.json" "$APP_DIR/"
[ -f "$ROOT_DIR/package-lock.json" ] && cp "$ROOT_DIR/package-lock.json" "$APP_DIR/"
mkdir -p "$APP_DIR/scripts"
cp "$ROOT_DIR/scripts/console-doctor.mjs" "$ROOT_DIR/scripts/require-node.mjs" "$ROOT_DIR/scripts/install-safety.sh" "$APP_DIR/scripts/"
mkdir -p "$(dirname "$APP_DIR/$PUBLIC_DEST")"
cp -r "$PUBLIC_SRC" "$APP_DIR/$PUBLIC_DEST"
mkdir -p "$APP_DIR/$SERVER_DEST_DIR"
cp -r "$SERVER_SRC_DIR/." "$APP_DIR/$SERVER_DEST_DIR/"

log "instalando dependências de produção no staging"
if [ -f "$APP_DIR/package-lock.json" ]; then
  (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
else
  (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
fi

log "instalando systemd unit, launcher, desktop entry e ícones"
mkdir -p "$STAGING/etc/systemd/system"
sed -e 's#__RUNTIME_DIR__#/opt/hestia-console#g' \
  -e 's#__SERVICE_USER__#hestia-console#g' \
  -e 's#__SERVICE_GROUP__#hestia-console#g' \
  "$ROOT_DIR/packaging/hestia-console.service.in" > "$STAGING/etc/systemd/system/hestia-console.service"

mkdir -p "$STAGING/usr/bin"
for bin in hestia-console hestia-console-status hestia-console-stop; do
  cp "$ROOT_DIR/packaging/bin/$bin" "$STAGING/usr/bin/$bin"
  chmod 0755 "$STAGING/usr/bin/$bin"
done

mkdir -p "$STAGING/usr/share/applications"
cp "$ROOT_DIR/packaging/hestia-console.desktop" "$STAGING/usr/share/applications/"

ICONS_SRC="$ROOT_DIR/assets/icons"
for size in 512 256 128 64 48; do
  dest="$STAGING/usr/share/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$dest"
  cp "$ICONS_SRC/hestia-console-${size}.png" "$dest/hestia-console.png"
done
if [ -f "$ICONS_SRC/hestia-console.svg" ]; then
  dest="$STAGING/usr/share/icons/hicolor/scalable/apps"
  mkdir -p "$dest"
  cp "$ICONS_SRC/hestia-console.svg" "$dest/hestia-console.svg"
fi

log "gerando metadados DEBIAN/"
sed -e "s/__VERSION__/$VERSION/" -e "s/__ARCH__/$ARCH/" "$ROOT_DIR/packaging/debian/control.template" > "$STAGING/DEBIAN/control"
cp "$ROOT_DIR/packaging/debian/postinst" "$STAGING/DEBIAN/postinst"
cp "$ROOT_DIR/packaging/debian/prerm" "$STAGING/DEBIAN/prerm"
cp "$ROOT_DIR/packaging/debian/postrm" "$STAGING/DEBIAN/postrm"
chmod 0755 "$STAGING/DEBIAN/postinst" "$STAGING/DEBIAN/prerm" "$STAGING/DEBIAN/postrm"

log "empacotando $DEB_FILE"
dpkg-deb --build --root-owner-group -Zgzip "$STAGING" "$DEB_FILE"
dpkg-deb --info "$DEB_FILE" >/dev/null
dpkg-deb --contents "$DEB_FILE" >/dev/null

log "pronto: $DEB_FILE"
