// Chama Local — log de eventos append-only (JSONL, um arquivo por dia).
// Tolerante a linhas corrompidas: ignora silenciosamente ao ler.
import { promises as fs } from "node:fs";
import { join } from "node:path";

function dateString(date = new Date()) {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

export function buildEvent(input) {
  const {
    type,
    timestamp = new Date().toISOString(),
    visibility = "presence-safe",
    data = {},
  } = input;

  return {
    type,
    timestamp,
    visibility,
    data,
  };
}

export async function appendEvent(input, dataDir) {
  const event = buildEvent(input);
  const date = dateString(new Date(event.timestamp));
  const eventPath = join(dataDir, "events", `events-${date}.jsonl`);

  const line = JSON.stringify(event) + "\n";
  try {
    await fs.appendFile(eventPath, line, "utf8");
  } catch (err) {
    // Falha ao gravar: log mas segue (graceful degradation)
    console.error(`[Héstia] erro ao gravar evento: ${err.message}`);
  }

  return event;
}

export async function getRecentEvents({ limit = 100 }, dataDir) {
  const events = [];

  // Lê arquivos de eventos (todos disponíveis, em ordem reversa de data)
  try {
    const eventsDir = join(dataDir, "events");
    const files = await fs.readdir(eventsDir);

    // Filtra arquivos events-*.jsonl, ordena reverso (mais recente primeiro)
    const eventFiles = files
      .filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();

    for (const file of eventFiles) {
      if (events.length >= limit) break;

      const filePath = join(eventsDir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n").filter((l) => l.trim());

        // Lê linhas em reverso (mais recente dentro do arquivo primeiro)
        for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
          try {
            const event = JSON.parse(lines[i]);
            events.push(event);
          } catch {
            // Linha corrompida: ignora silenciosamente
          }
        }
      } catch {
        // Arquivo ilegível: pula para próximo
      }
    }
  } catch {
    // Diretório não existe ou não acessível: retorna vazio
  }

  return events.slice(0, limit);
}
