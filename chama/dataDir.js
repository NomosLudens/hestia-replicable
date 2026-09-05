// Chama Local — resolve e garante o diretório de dados persistentes
// (identidade, eventos, snapshots). Nunca lê de fora de env/systemd.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveDataDir(env = process.env, homedirFn = homedir) {
  if (env.HESTIA_DATA_DIR) return env.HESTIA_DATA_DIR;
  // systemd StateDirectory= exporta STATE_DIRECTORY (pode vir "a:b" se houver
  // múltiplos diretórios declarados; usamos só o primeiro).
  if (env.STATE_DIRECTORY) return env.STATE_DIRECTORY.split(":")[0];
  return join(homedirFn(), ".chama", "data");
}

export function ensureDataDir(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "events"), { recursive: true });
  mkdirSync(join(dataDir, "snapshots"), { recursive: true });
  mkdirSync(join(dataDir, "organizer", "plans"), { recursive: true });
  mkdirSync(join(dataDir, "organizer", "runs"), { recursive: true });
  return dataDir;
}
