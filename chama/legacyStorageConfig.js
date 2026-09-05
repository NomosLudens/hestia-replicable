// Configuração legada de storage para módulos fora do runtime ativo do Console.
// O Console do notebook não importa este arquivo.

export function legacyStorageRoot() {
  return process.env.HESTIA_STORAGE_PATH || process.env.HESTIA_KALINE_ROOT || "/KALINE";
}

export function legacyStoragePaths() {
  return ["/", legacyStorageRoot()];
}
