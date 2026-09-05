#!/usr/bin/env bash

# Shared path validation for the root installers. Callers must use set -euo pipefail.

hestia_safety_fail() {
  printf '%s\n' "ERRO: $*" >&2
  return 1
}

hestia_has_parent_component() {
  [[ "/$1/" == *"/../"* || "/$1/" == *"/./"* ]]
}

hestia_normalize_path() {
  realpath -m -- "$1"
}

hestia_validate_test_root() {
  local raw="${HESTIA_TEST_ROOT:-}" normalized
  [ -n "$raw" ] || { hestia_safety_fail "HESTIA_TEST_ROOT é obrigatório no modo de teste."; return 1; }
  [[ "$raw" = /* ]] || { hestia_safety_fail "HESTIA_TEST_ROOT deve ser absoluto."; return 1; }
  if hestia_has_parent_component "$raw"; then hestia_safety_fail "HESTIA_TEST_ROOT não pode conter . ou ..."; return 1; fi
  [ ! -L "$raw" ] || { hestia_safety_fail "HESTIA_TEST_ROOT não pode ser symlink."; return 1; }
  [ -d "$raw" ] || { hestia_safety_fail "HESTIA_TEST_ROOT deve existir."; return 1; }
  normalized="$(hestia_normalize_path "$raw")"
  [ "$raw" = "$normalized" ] || { hestia_safety_fail "HESTIA_TEST_ROOT deve estar normalizado."; return 1; }
  case "$normalized" in
    /|/tmp|/opt|/etc|/usr|/home|/KALINE)
      hestia_safety_fail "HESTIA_TEST_ROOT é amplo demais."
      return 1
      ;;
  esac
  HESTIA_TEST_ROOT="$normalized"
}

hestia_validate_test_path() {
  local label="$1" raw="$2" normalized parent
  [ -n "$raw" ] || { hestia_safety_fail "$label não pode ser vazio."; return 1; }
  [[ "$raw" = /* ]] || { hestia_safety_fail "$label deve ser absoluto."; return 1; }
  if hestia_has_parent_component "$raw"; then hestia_safety_fail "$label não pode conter . ou ..."; return 1; fi
  [ ! -L "$raw" ] || { hestia_safety_fail "$label não pode ser symlink."; return 1; }
  normalized="$(hestia_normalize_path "$raw")"
  [ "$raw" = "$normalized" ] || { hestia_safety_fail "$label deve estar normalizado e não pode escapar por symlink."; return 1; }
  case "$normalized" in
    "$HESTIA_TEST_ROOT"/*) ;;
    *) hestia_safety_fail "$label deve permanecer dentro de HESTIA_TEST_ROOT."; return 1 ;;
  esac
  parent="$(hestia_normalize_path "$(dirname -- "$raw")")"
  case "$parent" in
    "$HESTIA_TEST_ROOT"|"$HESTIA_TEST_ROOT"/*) ;;
    *) hestia_safety_fail "o parent de $label escapa de HESTIA_TEST_ROOT."; return 1 ;;
  esac
  printf '%s\n' "$normalized"
}

hestia_assert_regular_config_file() {
  local path="${1:-}"
  [ "$#" -eq 1 ] || { hestia_safety_fail "arquivo de configuração não informado."; return 1; }
  if [ -e "$path" ] || [ -L "$path" ]; then
    [ ! -L "$path" ] && [ -f "$path" ] || {
      hestia_safety_fail "arquivo de configuração existente deve ser regular e não pode ser symlink."
      return 1
    }
  fi
}

hestia_reject_production_override() {
  local name
  for name in "$@"; do
    if [[ -v "$name" ]]; then
      hestia_safety_fail "$name é permitido somente com HESTIA_INSTALL_TEST_MODE=1."
      return 1
    fi
  done
}

hestia_configure_install_paths() {
  local product="$1"
  case "$product" in
    console)
      HESTIA_CANONICAL_RUNTIME="/opt/hestia-console"
      HESTIA_CANONICAL_ENV="/etc/default/hestia-console"
      HESTIA_CANONICAL_UNIT="/etc/systemd/system/hestia-console.service"
      ;;
    station)
      HESTIA_CANONICAL_RUNTIME="/opt/hestia-station"
      HESTIA_CANONICAL_ENV="/etc/default/hestia-station-agent"
      HESTIA_CANONICAL_UNIT="/etc/systemd/system/hestia-station-agent.service"
      ;;
    *) hestia_safety_fail "produto de instalação desconhecido."; return 1 ;;
  esac

  if [ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ]; then
    hestia_validate_test_root
    if [ "$product" = "console" ]; then
      RUNTIME_DIR="${HESTIA_INSTALL_ROOT:-$HESTIA_TEST_ROOT/opt/hestia-console}"
      ENV_FILE="${HESTIA_ENV_FILE:-$HESTIA_TEST_ROOT/etc/default/hestia-console}"
      UNIT_FILE="${HESTIA_UNIT_FILE:-$HESTIA_TEST_ROOT/etc/systemd/system/hestia-console.service}"
    else
      RUNTIME_DIR="${HESTIA_STATION_INSTALL_ROOT:-${HESTIA_INSTALL_ROOT:-$HESTIA_TEST_ROOT/opt/hestia-station}}"
      ENV_FILE="${HESTIA_STATION_ENV_FILE:-$HESTIA_TEST_ROOT/etc/default/hestia-station-agent}"
      UNIT_FILE="${HESTIA_STATION_UNIT_FILE:-$HESTIA_TEST_ROOT/etc/systemd/system/hestia-station-agent.service}"
    fi
    SYSTEMCTL_BIN="${HESTIA_SYSTEMCTL_BIN:-$HESTIA_TEST_ROOT/bin/systemctl}"
    RUNTIME_DIR="$(hestia_validate_test_path "runtime" "$RUNTIME_DIR")"
    ENV_FILE="$(hestia_validate_test_path "env file" "$ENV_FILE")"
    UNIT_FILE="$(hestia_validate_test_path "unit file" "$UNIT_FILE")"
    [[ "$SYSTEMCTL_BIN" != *[[:space:]]* ]] || { hestia_safety_fail "systemctl fake não pode conter argumentos."; return 1; }
    SYSTEMCTL_BIN="$(hestia_validate_test_path "systemctl fake" "$SYSTEMCTL_BIN")"
    [ -x "$SYSTEMCTL_BIN" ] || { hestia_safety_fail "systemctl fake deve ser executável."; return 1; }
  elif [ "${HESTIA_INSTALL_TEST_MODE:-0}" = "0" ]; then
    hestia_reject_production_override \
      HESTIA_TEST_ROOT HESTIA_INSTALL_ROOT HESTIA_STATION_INSTALL_ROOT \
      HESTIA_ENV_FILE HESTIA_STATION_ENV_FILE HESTIA_UNIT_FILE \
      HESTIA_STATION_UNIT_FILE HESTIA_SYSTEMCTL_BIN
    RUNTIME_DIR="$HESTIA_CANONICAL_RUNTIME"
    ENV_FILE="$HESTIA_CANONICAL_ENV"
    UNIT_FILE="$HESTIA_CANONICAL_UNIT"
    SYSTEMCTL_BIN="systemctl"
  else
    hestia_safety_fail "HESTIA_INSTALL_TEST_MODE aceita somente 0 ou 1."
    return 1
  fi
}

hestia_assert_runtime_target() {
  local normalized parent
  [ ! -L "$RUNTIME_DIR" ] || { hestia_safety_fail "runtime não pode ser symlink."; return 1; }
  normalized="$(hestia_normalize_path "$RUNTIME_DIR")"
  [ "$normalized" = "$RUNTIME_DIR" ] || { hestia_safety_fail "runtime deve estar normalizado."; return 1; }
  parent="$(hestia_normalize_path "$(dirname -- "$RUNTIME_DIR")")"
  [ "$normalized" != "$parent" ] || { hestia_safety_fail "runtime não pode ser a raiz do parent."; return 1; }
  if [ "${HESTIA_INSTALL_TEST_MODE:-0}" = "1" ]; then
    hestia_validate_test_path "runtime" "$RUNTIME_DIR" >/dev/null
  else
    [ "$RUNTIME_DIR" = "$HESTIA_CANONICAL_RUNTIME" ] || { hestia_safety_fail "runtime operacional não canônico."; return 1; }
  fi
}

hestia_safe_remove_runtime_path() {
  local path="$1" normalized parent runtime_parent
  [ ! -L "$path" ] || { hestia_safety_fail "recusa remover runtime symlink."; return 1; }
  normalized="$(hestia_normalize_path "$path")"
  [ "$normalized" = "$path" ] || { hestia_safety_fail "recusa remover path não normalizado."; return 1; }
  parent="$(hestia_normalize_path "$(dirname -- "$path")")"
  runtime_parent="$(hestia_normalize_path "$(dirname -- "$RUNTIME_DIR")")"
  [ "$parent" = "$runtime_parent" ] || { hestia_safety_fail "recusa remover path fora do parent do runtime."; return 1; }
  case "$path" in
    "$RUNTIME_DIR"|"$RUNTIME_DIR.new.$$"|"$RUNTIME_DIR.previous.$$") ;;
    *) hestia_safety_fail "recusa remover path não administrado."; return 1 ;;
  esac
  [ "$path" != "$parent" ] || { hestia_safety_fail "recusa remover a raiz do parent."; return 1; }
  if [ -e "$path" ]; then rm -rf -- "$path"; fi
}
