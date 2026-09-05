// Chama Local — identidade persistente da estação local.
// {id, createdAt} são gravados uma vez em identity.json; machine é computado ao vivo.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";

async function readOrCreateIdentity(dataDir) {
  const identityPath = join(dataDir, "identity.json");
  try {
    const raw = await fs.readFile(identityPath, "utf8");
    return JSON.parse(raw);
  } catch {
    // Primeira vez: cria e persiste {id, createdAt}
    const identity = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      await fs.writeFile(identityPath, JSON.stringify(identity, null, 2), "utf8");
    } catch {
      // Falha ao gravar: segue com in-memory (graceful degradation)
    }
    return identity;
  }
}

export async function getIdentity(dataDir) {
  const persisted = await readOrCreateIdentity(dataDir);
  return {
    id: persisted.id,
    createdAt: persisted.createdAt,
    machine: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      gpu: null,
    },
    checkedAt: new Date().toISOString(),
  };
}
