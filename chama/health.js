import { accessSync, constants, existsSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";

function canWrite(path) {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function getHealth() {
  return {
    ok: true,
    appName: config.appName,
    serverName: config.serverName,
    agentName: config.agentName,
    version: config.version,
    hostname: hostname(),
    timestamp: new Date().toISOString(),
    processUptime: process.uptime(),
    readonly: config.readonly,
    frontendBuilt:
      existsSync(join(process.cwd(), "dist", "client")) ||
      existsSync(join(process.cwd(), ".output", "public")),
    serviceUser: userInfo().username,
    dataDirWritable: existsSync(config.dataDir)
      ? canWrite(config.dataDir)
      : canWrite(join(config.dataDir, "..")),
    sambaActive: existsSync(config.storageRoot),
  };
}
