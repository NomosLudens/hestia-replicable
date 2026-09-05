import {
  STATION_IDS,
  fetchStationApps,
  fetchStationHealth,
  fetchStationServicesReport,
  fetchStationServicesStatus,
  fetchStationStorageStatus,
  fetchStationSuspend,
  fetchStationSystemStatus,
  fetchStationTunnelStatus,
  fetchStationUpdates,
  fetchTvboxCodiceHealth,
  getStationConnectionStatus,
  resolveNamedStationConfig,
  stationHealthHttpStatus,
  updateStationApp,
} from "./stationClient.js";
import { executeWakeServerAction, getWakeExecutorStatus } from "./wakeServer.js";
import { appendEvent } from "./events.js";

function unavailable(reply, result, resource) {
  reply.code(result.remoteStatus || stationHealthHttpStatus(result.code));
  return {
    ok: false,
    code: result.remoteCode || result.code,
    state: result.state,
    error: `${resource} indisponível`,
    checkedAt: result.checkedAt,
  };
}

function registerNamedStationRoutes(app, stationId, env) {
  const config = () => resolveNamedStationConfig(stationId, env);
  const prefix = `/api/stations/${stationId}`;

  app.get(`${prefix}/connection`, async () => getStationConnectionStatus(config()));
  app.get(`${prefix}/health`, async (_request, reply) => {
    const result = await fetchStationHealth(config());
    return result.ok ? result.station : unavailable(reply, result, `${stationId} health`);
  });
  app.get(`${prefix}/system/status`, async (_request, reply) => {
    const result = await fetchStationSystemStatus(config());
    return result.ok ? result.system : unavailable(reply, result, `${stationId} system`);
  });
  app.get(`${prefix}/storage/status`, async (_request, reply) => {
    const result = await fetchStationStorageStatus(config());
    return result.ok ? result.storage : unavailable(reply, result, `${stationId} storage`);
  });
  app.get(`${prefix}/services/status`, async (_request, reply) => {
    const result = await fetchStationServicesStatus(config());
    return result.ok ? result.services : unavailable(reply, result, `${stationId} services`);
  });
  // Inventário COMPLETO de TODOS os *.service instalados — somente para a
  // KAOS a recomendação de uso (Whitelist é só para status/status agregados).
  // Mantém-se registrado para todas as Stations por simetria: qualquer
  // estação pode, no futuro, oferecer seu próprio inventário.
  app.get(`${prefix}/services/report`, async (_request, reply) => {
    const result = await fetchStationServicesReport(config(), env);
    return result.ok ? result.report : unavailable(reply, result, `${stationId} services report`);
  });
  app.get(`${prefix}/updates`, async (_request, reply) => {
    const result = await fetchStationUpdates(config());
    return result.ok ||
      result.updates?.status === "unsupported" ||
      result.updates?.status === "error"
      ? result.updates
      : unavailable(reply, result, `${stationId} updates`);
  });
  app.get(`${prefix}/apps`, async (_request, reply) => {
    const result = await fetchStationApps(config());
    return result.ok || result.apps?.status === "unsupported" || result.apps?.status === "error"
      ? result.apps
      : unavailable(reply, result, `${stationId} apps`);
  });
  app.post(`${prefix}/apps/:appId/update`, async (request, reply) => {
    const appId = request.params?.appId;
    const secret = request.body?.authorization?.secret || request.body?.secret || "";
    const result = await updateStationApp(config(), appId, { secret });
    if (!result.ok) {
      return reply.code(result.remoteStatus || 400).send(result);
    }
    return result;
  });
  app.get(`${prefix}/tunnel/status`, async (_request, reply) => {
    const result = await fetchStationTunnelStatus(config());
    return result.ok || result.tunnelStatus?.status === "unsupported"
      ? result.tunnelStatus
      : unavailable(reply, result, `${stationId} tunnel status`);
  });
}

export function registerStationRoutes(app, env = process.env, options = {}) {
  const executeWake = options.executeWakeServerAction || executeWakeServerAction;
  const wakeExecutorStatus = options.getWakeExecutorStatus || getWakeExecutorStatus;
  const suspendStation = options.fetchStationSuspend || fetchStationSuspend;
  for (const stationId of STATION_IDS) registerNamedStationRoutes(app, stationId, env);

  app.get("/api/wake-executor/status", async () => wakeExecutorStatus(env, options));

  app.get("/api/stations/tvbox/codice/health", async (_request, reply) => {
    const result = await fetchTvboxCodiceHealth(resolveNamedStationConfig("tvbox", env));
    return result.ok ? result : unavailable(reply, result, "tvbox Códice");
  });

  app.post("/api/actions/wake-server", async (_request, reply) => {
    const result = await executeWake(env);
    if (!result.ok) {
      reply.code(400);
      return result;
    }

    const dataDir = options.dataDir || process.env.HESTIA_DATA_DIR;
    if (dataDir) {
      try {
        await appendEvent(
          {
            type: "wake.requested",
            data: {
              target: "desktop",
              sentAt: result.sentAt,
            },
          },
          dataDir,
        );
      } catch {
        // ignora se dataDir não estiver gravável no teste
      }
    }

    return {
      ok: true,
      state: "wake_requested",
      target: "desktop",
      message: "Despertar solicitado para o Servidor",
      sentAt: result.sentAt,
    };
  });

  app.post("/api/actions/sleep-server", async (_request, reply) => {
    const desktopConfig = resolveNamedStationConfig("desktop", env);
    const result = await suspendStation(desktopConfig);
    if (!result.ok) {
      return unavailable(reply, result, "Servidor");
    }
    const dataDir = options.dataDir || process.env.HESTIA_DATA_DIR;
    if (dataDir) {
      try {
        await appendEvent(
          {
            type: "sleep.requested",
            data: {
              target: "desktop",
              sentAt: new Date().toISOString(),
            },
          },
          dataDir,
        );
      } catch {
        // ignora se dataDir não estiver gravável no teste
      }
    }

    return {
      ok: true,
      state: "sleep_requested",
      target: "desktop",
      message: "Solicitação de repouso enviada para o Servidor",
      result,
    };
  });
}
