import { resolveStationAgentConfig, startStationAgent } from "./chama/stationAgent.js";

let app;
let closing = false;

async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await app?.close();
  } catch (error) {
    console.error(`[Station Agent] falha ao encerrar: ${error.message}`);
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  const config = resolveStationAgentConfig();
  app = await startStationAgent(config);
  console.log(`[Station Agent] ouvindo em ${config.host}:${config.port}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
