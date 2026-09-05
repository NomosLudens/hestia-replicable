// Chama Local — snapshots periódicos do estado (server/services).
// Escreve atomicamente; emite eventos apenas quando um serviço ou station muda de estado.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { getServerStatus } from "./system.js";
import { getServicesStatus } from "./services.js";
import { appendEvent, getRecentEvents } from "./events.js";
import {
  STATION_IDS,
  resolveNamedStationConfig,
  getStationConnectionStatus,
} from "./stationClient.js";

export const SNAPSHOT_INTERVAL_MS = 60_000; // 60 segundos

// Compara serviços anterior/atual, retorna lista de transições
export function diffServiceTransitions(prevSnapshot, currSnapshot) {
  if (!prevSnapshot?.services) return [];

  const transitions = [];
  const prevByName = Object.fromEntries(prevSnapshot.services.items.map((s) => [s.name, s]));
  const currByName = Object.fromEntries(currSnapshot.services.items.map((s) => [s.name, s]));

  // Detecta mudanças de estado
  for (const curr of currSnapshot.services.items) {
    const prev = prevByName[curr.name];
    if (!prev) continue; // Novo serviço: ignora (não é transição)

    if (prev.active && !curr.active) {
      transitions.push({ name: curr.name, from: "active", to: "inactive" });
    } else if (!prev.active && curr.active) {
      transitions.push({ name: curr.name, from: "inactive", to: "active" });
    }
  }

  return transitions;
}

// Compara stations anterior/atual, retorna lista de transições
export function diffStationTransitions(prevSnapshot, currSnapshot) {
  if (!prevSnapshot?.stations || !currSnapshot?.stations) return [];

  const transitions = [];
  for (const id of Object.keys(currSnapshot.stations)) {
    const prev = prevSnapshot.stations[id];
    const curr = currSnapshot.stations[id];
    if (!prev || !curr) continue;

    const prevAvailable = prev.state === "available";
    const currAvailable = curr.state === "available";

    if (prevAvailable && !currAvailable) {
      transitions.push({
        id,
        from: prev.state,
        to: curr.state,
        code: curr.code,
        transition: "down",
      });
    } else if (!prevAvailable && currAvailable) {
      transitions.push({
        id,
        from: prev.state,
        to: curr.state,
        code: curr.code,
        transition: "up",
      });
    }
  }

  return transitions;
}

export async function generateSnapshot(env = process.env) {
  const server = getServerStatus();
  const services = await getServicesStatus();

  // Consulta as seis stations de forma independente e concorrente
  const stations = {};
  await Promise.all(
    STATION_IDS.map(async (id) => {
      try {
        const cfg = resolveNamedStationConfig(id, env);
        const conn = await getStationConnectionStatus(cfg);
        stations[id] = {
          state: conn.state, // "available", "unavailable", "unauthorized", etc.
          code: conn.code || null,
          latencyMs: conn.latencyMs || null,
        };
      } catch {
        stations[id] = {
          state: "unavailable",
          code: "STATION_UNAVAILABLE",
          latencyMs: null,
        };
      }
    }),
  );

  return {
    timestamp: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SNAPSHOT_INTERVAL_MS * 2).toISOString(),
    server,
    services,
    stations,
  };
}

export async function writeSnapshot(snapshot, dataDir) {
  const snapshotPath = join(dataDir, "snapshots", "latest.json");
  const tmpPath = `${snapshotPath}.tmp`;

  try {
    await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf8");
    // Rename atômico (POSIX)
    await fs.rename(tmpPath, snapshotPath);
    return snapshot;
  } catch (err) {
    // Falha ao gravar: ignora (graceful degradation)
    console.error(`[Héstia] erro ao gravar snapshot: ${err.message}`);
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignora erro ao limpar .tmp
    }
    return null;
  }
}

export async function getLatestSnapshot(dataDir) {
  const snapshotPath = join(dataDir, "snapshots", "latest.json");
  try {
    const content = await fs.readFile(snapshotPath, "utf8");
    const snapshot = JSON.parse(content);
    const now = new Date();
    const expiresAt = new Date(snapshot.expiresAt);
    return {
      ...snapshot,
      stale: now > expiresAt,
    };
  } catch {
    // Nenhum snapshot gravado ainda
    return {
      status: "unavailable",
      reason: "Nenhum snapshot disponível ainda",
      timestamp: new Date().toISOString(),
    };
  }
}

let lastSnapshot = null;

export async function runSnapshotCycle(dataDir, env = process.env) {
  try {
    const snapshot = await generateSnapshot(env);
    await writeSnapshot(snapshot, dataDir);

    if (lastSnapshot) {
      // 1. Transições de Serviços
      const transitions = diffServiceTransitions(lastSnapshot, snapshot);
      for (const transition of transitions) {
        const eventType = transition.to === "active" ? "service.up" : "service.down";
        let durationMs = null;
        if (transition.to === "active") {
          try {
            const recent = await getRecentEvents({ limit: 100 }, dataDir);
            const lastDown = recent.find(
              (e) => e.type === "service.down" && e.data?.service === transition.name,
            );
            if (lastDown) {
              durationMs = Date.now() - new Date(lastDown.timestamp).getTime();
            }
          } catch {
            // ignore
          }
        }
        await appendEvent(
          {
            type: eventType,
            data: {
              service: transition.name,
              from: transition.from,
              to: transition.to,
              ...(durationMs !== null ? { durationMs } : {}),
            },
          },
          dataDir,
        );
      }

      // 2. Transições de Stations
      const stationTransitions = diffStationTransitions(lastSnapshot, snapshot);
      for (const transition of stationTransitions) {
        const eventType = transition.transition === "up" ? "station.up" : "station.down";
        let durationMs = null;
        if (transition.transition === "up") {
          try {
            const recent = await getRecentEvents({ limit: 100 }, dataDir);
            const lastDown = recent.find(
              (e) => e.type === "station.down" && e.data?.station === transition.id,
            );
            if (lastDown) {
              durationMs = Date.now() - new Date(lastDown.timestamp).getTime();
            }
          } catch {
            // ignore
          }
        }
        await appendEvent(
          {
            type: eventType,
            data: {
              station: transition.id,
              from: transition.from,
              to: transition.to,
              code: transition.code || null,
              ...(durationMs !== null ? { durationMs } : {}),
            },
          },
          dataDir,
        );
      }
    }

    lastSnapshot = snapshot;
  } catch (err) {
    console.error(`[Héstia] erro no ciclo de snapshot: ${err.message}`);
  }
}
