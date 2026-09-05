import { execFile as execFileCallback } from "node:child_process";
import {
  existsSync as existsSyncDefault,
  readFileSync as readFileSyncDefault,
  readdirSync as readdirSyncDefault,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCallback);

export const DEFAULT_STATION_APPS_TIMEOUT_MS = 20000;
export const MIN_STATION_APPS_TIMEOUT_MS = 1000;
export const MAX_STATION_APPS_TIMEOUT_MS = 60000;

export function resolveAppsTimeoutMs(
  raw = process.env.HESTIA_STATION_APPS_TIMEOUT_MS,
  fallback = DEFAULT_STATION_APPS_TIMEOUT_MS,
) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_STATION_APPS_TIMEOUT_MS || n > MAX_STATION_APPS_TIMEOUT_MS) {
    return fallback;
  }
  return n;
}

/**
 * Clean field codes (%u, %U, %f, %F, %i, %c, %k, etc.) from Desktop Exec line.
 * Never executes the command string; pure string parsing.
 */
export function cleanDesktopExec(rawExec) {
  if (typeof rawExec !== "string" || !rawExec.trim()) return "";
  // Strip field codes %f, %F, %u, %U, %d, %D, %n, %N, %i, %c, %k, %v, %m
  const cleaned = rawExec.replace(/%[fFuUdDnNiIckvm]/g, "").trim();
  if (!cleaned) return "";

  // Split into arguments safely respecting quotes to get the executable
  const parts = cleaned.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (parts.length === 0) return "";

  let bin = parts[0].replace(/^["']|["']$/g, "").trim();
  return bin;
}

/**
 * Safely parse a .desktop file content.
 */
export function parseDesktopFile(content, filePath = "") {
  if (typeof content !== "string" || !content.trim()) return null;

  const lines = content.split(/\r?\n/);
  let inDesktopEntry = false;
  let name = "";
  let rawExec = "";
  let icon = "";
  let comment = "";
  let type = "";
  let noDisplay = false;
  const categories = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDesktopEntry = trimmed === "[Desktop Entry]";
      continue;
    }

    if (!inDesktopEntry) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (key === "Type" && !type) type = value;
    if (key === "Name" && !name) name = value;
    if (key === "Exec" && !rawExec) rawExec = value;
    if (key === "Icon" && !icon) icon = value;
    if (key === "Comment" && !comment) comment = value;
    if (key === "NoDisplay") noDisplay = value.toLowerCase() === "true";
    if (key === "Categories" && categories.length === 0) {
      categories.push(
        ...value
          .split(";")
          .map((c) => c.trim())
          .filter(Boolean),
      );
    }
  }

  if (type !== "Application" || noDisplay || !name || !rawExec) {
    return null;
  }

  const executablePath = cleanDesktopExec(rawExec);
  if (!executablePath) return null;

  return {
    desktopEntry: filePath,
    name,
    rawExec,
    executablePath,
    icon: icon || null,
    comment: comment || null,
    categories,
  };
}

/**
 * Scan standard .desktop directories.
 */
export function scanDesktopEntries(options = {}) {
  const readFileSync = options.readFileSyncImpl || readFileSyncDefault;
  const readdirSync = options.readdirSyncImpl || readdirSyncDefault;
  const existsSync = options.existsSyncImpl || existsSyncDefault;
  const homeDir = options.homeDir || process.env.HOME || "";

  const dirs = [
    "/usr/share/applications",
    "/usr/local/share/applications",
    homeDir ? path.join(homeDir, ".local/share/applications") : "",
  ].filter(Boolean);

  const desktopEntries = [];
  const seenPaths = new Set();

  for (const dirPath of dirs) {
    if (!existsSync(dirPath)) continue;
    try {
      const files = readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith(".desktop")) continue;
        const fullPath = path.join(dirPath, file);
        if (seenPaths.has(fullPath)) continue;
        seenPaths.add(fullPath);

        try {
          const content = readFileSync(fullPath, "utf8");
          const parsed = parseDesktopFile(content, fullPath);
          if (parsed) {
            desktopEntries.push(parsed);
          }
        } catch {
          // ignore unreadable files
        }
      }
    } catch {
      // ignore directory access errors
    }
  }

  return desktopEntries;
}

/**
 * Bulk collect installed DEB packages and candidates in memory (No N+1 queries).
 */
export async function getAptMetadata(executablePaths = [], options = {}) {
  const runExecFile = options.execFileImpl || execFileDefault;
  const execTimeoutMs = options.timeoutMs || DEFAULT_STATION_APPS_TIMEOUT_MS;

  const installedPackages = new Map(); // package -> version
  const candidatePackages = new Map(); // package -> version
  const execToPackage = new Map(); // executable -> package

  // 1. Bulk list installed packages (dpkg-query)
  try {
    const { stdout } = await runExecFile("dpkg-query", ["-W", "-f=${Package}\t${Version}\n"], {
      timeout: execTimeoutMs,
    });
    const lines = (stdout || "").split(/\r?\n/);
    for (const line of lines) {
      const [pkg, ver] = line.trim().split("\t");
      if (pkg && ver) installedPackages.set(pkg, ver);
    }
  } catch {
    // dpkg-query not available or error
  }

  // 2. Bulk get candidate versions (apt-get -s upgrade)
  try {
    const { stdout } = await runExecFile("apt-get", ["-s", "upgrade"], {
      timeout: execTimeoutMs,
    });
    const lines = (stdout || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("Inst ")) continue;
      const match = /^Inst\s+([^\s]+)\s+\[([^\]]+)\]\s+\(([^\s\)]+)/.exec(trimmed);
      if (match) {
        const [, pkg, , candidateVer] = match;
        candidatePackages.set(pkg, candidateVer);
      }
    }
  } catch {
    // apt-get not available or error
  }

  // 3. Batch resolve executable paths to packages (dpkg -S)
  const validPaths = executablePaths.filter((p) => typeof p === "string" && p.startsWith("/"));
  if (validPaths.length > 0) {
    // Query in batches of 50 to avoid arg list length issues
    const batchSize = 50;
    for (let i = 0; i < validPaths.length; i += batchSize) {
      const chunk = validPaths.slice(i, i + batchSize);
      try {
        const { stdout } = await runExecFile("dpkg", ["-S", ...chunk], {
          timeout: execTimeoutMs,
        });
        const lines = (stdout || "").split(/\r?\n/);
        for (const line of lines) {
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;
          const pkg = line.slice(0, colonIdx).trim();
          const filePath = line.slice(colonIdx + 1).trim();

          // A line can be "pkg1, pkg2: /path"
          const firstPkg = pkg.split(",")[0].trim();
          if (firstPkg && filePath) {
            execToPackage.set(filePath, firstPkg);
          }
        }
      } catch {
        // dpkg -S fails if any path is unowned, fallback to single queries for remaining or handle partial
      }
    }
  }

  return {
    installedPackages,
    candidatePackages,
    execToPackage,
  };
}

/**
 * Discover Flatpak Applications if Flatpak CLI exists.
 */
export async function getFlatpakApps(options = {}) {
  const runExecFile = options.execFileImpl || execFileDefault;
  const execTimeoutMs = options.timeoutMs || DEFAULT_STATION_APPS_TIMEOUT_MS;

  try {
    const { stdout } = await runExecFile(
      "flatpak",
      ["list", "--app", "--columns=application,name,version,origin"],
      {
        timeout: execTimeoutMs,
      },
    );
    if (!stdout || !stdout.trim()) return [];

    const apps = [];
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      const parts = line.trim().split(/\t+/);
      if (parts.length < 2) continue;
      const [appId, name, version = null] = parts;
      if (!appId || appId === "Application") continue; // Header skip

      apps.push({
        id: `flatpak:${appId}`,
        name: name || appId,
        installedVersion: version || null,
        availableVersion: null,
        updateStatus: "unknown",
        source: "flatpak",
        packageId: appId,
        executable: null,
        desktopEntry: null,
        managed: true,
        updateCapability: "controlled",
      });
    }
    return apps;
  } catch {
    return [];
  }
}

/**
 * Discover Snap Applications if Snap CLI exists.
 */
export async function getSnapApps(options = {}) {
  const runExecFile = options.execFileImpl || execFileDefault;
  const execTimeoutMs = options.timeoutMs || DEFAULT_STATION_APPS_TIMEOUT_MS;

  try {
    const { stdout } = await runExecFile("snap", ["list"], {
      timeout: execTimeoutMs,
    });
    if (!stdout || !stdout.trim()) return [];

    const apps = [];
    const lines = stdout.split(/\r?\n/);
    let headerPassed = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!headerPassed) {
        if (trimmed.startsWith("Name ")) headerPassed = true;
        continue;
      }
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const [snapName, version] = parts;
      if (!snapName) continue;

      apps.push({
        id: `snap:${snapName}`,
        name: snapName,
        installedVersion: version || null,
        availableVersion: null,
        updateStatus: "unknown",
        source: "snap",
        packageId: snapName,
        executable: null,
        desktopEntry: null,
        managed: true,
        updateCapability: "controlled",
      });
    }
    return apps;
  } catch {
    return [];
  }
}

/**
 * Main Software Inventory discovery orchestrator.
 */
export async function getStationSoftwareInventory(options = {}) {
  const now = new Date().toISOString();
  const runExecFile = options.execFileImpl || execFileDefault;

  // Audit provider availability
  const providers = {
    apt: false,
    desktopEntry: true,
    flatpak: false,
    snap: false,
  };

  try {
    await runExecFile("dpkg", ["--version"]);
    providers.apt = true;
  } catch {
    providers.apt = false;
  }

  try {
    await runExecFile("flatpak", ["--version"]);
    providers.flatpak = true;
  } catch {
    providers.flatpak = false;
  }

  try {
    await runExecFile("snap", ["--version"]);
    providers.snap = true;
  } catch {
    providers.snap = false;
  }

  // 1. Discover desktop entries
  const desktopEntries = scanDesktopEntries(options);
  const executablePaths = desktopEntries.map((e) => e.executablePath);

  // 2. Fetch APT metadata if APT is supported (Bulk, no N+1)
  let aptMeta = {
    installedPackages: new Map(),
    candidatePackages: new Map(),
    execToPackage: new Map(),
  };

  if (providers.apt) {
    try {
      aptMeta = await getAptMetadata(executablePaths, options);
    } catch {
      // APT provider failure fallback
    }
  }

  // 3. Fetch Flatpak & Snap apps if available
  const flatpakApps = providers.flatpak ? await getFlatpakApps(options) : [];
  const snapApps = providers.snap ? await getSnapApps(options) : [];

  // Map to collect and deduplicate applications
  const appMap = new Map(); // id -> ApplicationItem

  // Process Desktop Entries (APT or Manual)
  for (const entry of desktopEntries) {
    const execPath = entry.executablePath;
    let pkgName = aptMeta.execToPackage.get(execPath);

    // If execPath isn't directly mapped, try matching binary name (e.g. /usr/bin/google-chrome-stable -> google-chrome-stable)
    if (!pkgName && execPath) {
      const baseName = path.basename(execPath);
      if (aptMeta.installedPackages.has(baseName)) {
        pkgName = baseName;
      }
    }

    if (pkgName && aptMeta.installedPackages.has(pkgName)) {
      // APT application
      const installedVer = aptMeta.installedPackages.get(pkgName);
      const candidateVer = aptMeta.candidatePackages.get(pkgName) || null;

      let updateStatus = "up_to_date";
      let availableVer = installedVer;

      if (candidateVer && candidateVer !== installedVer) {
        updateStatus = "update_available";
        availableVer = candidateVer;
      }

      const id = `apt:${pkgName}`;
      appMap.set(id, {
        id,
        name: entry.name,
        installedVersion: installedVer,
        availableVersion: availableVer,
        updateStatus,
        source: "apt",
        packageId: pkgName,
        executable: execPath,
        desktopEntry: entry.desktopEntry,
        managed: true,
        updateCapability: "controlled",
        checkedAt: now,
      });
    } else {
      // Manual / AppImage application referenced by trusted .desktop entry
      const baseName = path.basename(entry.desktopEntry || execPath);
      const id = `manual:${baseName}`;
      if (!appMap.has(id)) {
        appMap.set(id, {
          id,
          name: entry.name,
          installedVersion: null,
          availableVersion: null,
          updateStatus: "unknown",
          source: "manual",
          packageId: null,
          executable: execPath,
          desktopEntry: entry.desktopEntry,
          managed: false,
          updateCapability: "none",
          checkedAt: now,
        });
      }
    }
  }

  // Merge Flatpak Apps
  for (const fpApp of flatpakApps) {
    if (!appMap.has(fpApp.id)) {
      appMap.set(fpApp.id, { ...fpApp, checkedAt: now });
    }
  }

  // Merge Snap Apps
  for (const snapApp of snapApps) {
    if (!appMap.has(snapApp.id)) {
      appMap.set(snapApp.id, { ...snapApp, checkedAt: now });
    }
  }

  const applications = Array.from(appMap.values());

  const summary = {
    totalInstalled: applications.length,
    upToDate: applications.filter((a) => a.updateStatus === "up_to_date").length,
    updateAvailable: applications.filter((a) => a.updateStatus === "update_available").length,
    unknownVerification: applications.filter((a) => a.updateStatus === "unknown").length,
  };

  return {
    ok: true,
    schemaVersion: 1,
    status: "ok",
    checkedAt: now,
    applications,
    summary,
    providers,
  };
}

/**
 * Controlled update execution for a discovered, managed application with optional transient sudo password.
 */
export async function updateStationApplication(appId, options = {}) {
  const runExecFile = options.execFileImpl || execFileDefault;
  const execTimeoutMs = options.timeoutMs || DEFAULT_STATION_APPS_TIMEOUT_MS;
  const sudoPassword = typeof options.sudoPassword === "string" ? options.sudoPassword : "";
  const now = new Date().toISOString();

  // 1. Get current inventory
  const inventory = await getStationSoftwareInventory(options);
  if (!inventory.ok) {
    return {
      ok: false,
      code: "INVENTORY_FAILED",
      error: "Não foi possível consultar o inventário para validar a atualização.",
      checkedAt: now,
    };
  }

  // 2. Find target app
  const app = inventory.applications.find((a) => a.id === appId);
  if (!app) {
    return {
      ok: false,
      code: "APP_NOT_FOUND",
      error: `Aplicativo '${appId}' não encontrado no inventário atual.`,
      checkedAt: now,
    };
  }

  // 3. Validate management and capability
  if (!app.managed || app.updateCapability !== "controlled") {
    return {
      ok: false,
      code: "UPDATE_NOT_SUPPORTED",
      error: `O aplicativo '${app.name}' não possui gerenciamento de atualização controlado.`,
      checkedAt: now,
    };
  }

  if (app.updateStatus !== "update_available") {
    return {
      ok: false,
      code: "NO_UPDATE_AVAILABLE",
      error: `Nenhuma atualização disponível para o aplicativo '${app.name}'.`,
      checkedAt: now,
    };
  }

  // Helper to execute commands safely with transient sudo password via stdin
  const executeCommand = async (cmd, args) => {
    if (options.execFileImpl) {
      // Unit test mock override
      return options.execFileImpl(cmd, args, { sudoPassword });
    }

    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      let fullCmd = cmd;
      let fullArgs = args;

      if (sudoPassword) {
        fullCmd = "sudo";
        fullArgs = ["-S", "-p", "", cmd, ...args];
      }

      const child = spawn(fullCmd, fullArgs, {
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      if (sudoPassword && child.stdin) {
        child.stdin.write(`${sudoPassword}\n`);
        child.stdin.end();
      }

      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        reject(new Error("Timeout de execução de atualização excedido."));
      }, execTimeoutMs * 2);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const combinedErr = (stderr + " " + stdout).toLowerCase();
          if (
            combinedErr.includes("incorrect password") ||
            combinedErr.includes("sorry, try again") ||
            combinedErr.includes("password")
          ) {
            const err = new Error("Senha sudo incorreta ou autorização negada.");
            err.code = "AUTHORIZATION_FAILED";
            reject(err);
          } else {
            reject(
              new Error(stderr.trim() || stdout.trim() || `Processo finalizou com código ${code}`),
            );
          }
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  // 4. Controlled Execution based on Whitelisted Provider & PackageId
  try {
    if (app.source === "apt") {
      if (!app.packageId || typeof app.packageId !== "string") {
        return {
          ok: false,
          code: "INVALID_PACKAGE_ID",
          error: "PackageId inválido para o app.",
          checkedAt: now,
        };
      }
      // Execute whitelisted apt-get install command ONLY on the discovered packageId
      await executeCommand("apt-get", ["install", "-y", "--only-upgrade", app.packageId]);
    } else if (app.source === "flatpak") {
      if (!app.packageId)
        return {
          ok: false,
          code: "INVALID_PACKAGE_ID",
          error: "AppId flatpak inválido.",
          checkedAt: now,
        };
      await executeCommand("flatpak", ["update", "-y", app.packageId]);
    } else if (app.source === "snap") {
      if (!app.packageId)
        return {
          ok: false,
          code: "INVALID_PACKAGE_ID",
          error: "SnapName inválido.",
          checkedAt: now,
        };
      await executeCommand("snap", ["refresh", app.packageId]);
    } else {
      return {
        ok: false,
        code: "UNSUPPORTED_PROVIDER",
        error: "Provider não suportado para atualização.",
        checkedAt: now,
      };
    }
  } catch (err) {
    if (err?.code === "AUTHORIZATION_FAILED") {
      return {
        ok: false,
        code: "AUTHORIZATION_FAILED",
        error: "Senha sudo incorreta ou autorização negada.",
        checkedAt: now,
      };
    }

    // Ensure secrets are never leaked in error messages
    const safeErrorMessage = String(err.message || "").replace(
      new RegExp(sudoPassword || "____", "g"),
      "***",
    );

    return {
      ok: false,
      code: "UPDATE_EXEC_FAILED",
      error: `Falha ao executar atualização do aplicativo '${app.name}': ${safeErrorMessage}`,
      checkedAt: now,
    };
  }

  // 5. Re-scan inventory to confirm status
  const freshInventory = await getStationSoftwareInventory(options);
  const updatedApp = freshInventory.applications?.find((a) => a.id === appId) || null;

  return {
    ok: true,
    status: "updated",
    appId,
    name: app.name,
    installedVersion: updatedApp?.installedVersion || app.availableVersion,
    checkedAt: new Date().toISOString(),
    inventory: freshInventory,
  };
}
