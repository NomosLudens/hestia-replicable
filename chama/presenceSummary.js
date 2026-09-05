// Chama Local — sumário de presence agregando identidade + services.
import { getIdentity } from "./identity.js";
import { getServicesStatus } from "./services.js";
import { getServerStatus } from "./system.js";
import { getPresenceServiceBindings } from "./serviceBindings.js";

export async function getPresenceSummary(dataDir) {
  const identity = await getIdentity(dataDir);
  const services = await getServicesStatus();
  const server = getServerStatus();

  const activeServices = services.items.filter((s) => s.active).length;
  return {
    timestamp: new Date().toISOString(),
    identity: {
      id: identity.id,
      createdAt: identity.createdAt,
      hostname: identity.machine.hostname,
      platform: identity.machine.platform,
    },
    server: {
      uptime: server.uptime,
      loadAverage: server.loadAverage,
      freeMemory: server.freeMemory,
    },
    servicesSummary: {
      total: services.items.length,
      active: activeServices,
    },
    services: getPresenceServiceBindings(),
  };
}
