// Chama Local — varredura read-only de /KALINE e das fontes externas configuradas.
// Nunca aceita path vindo de fora (só de storageModel.js ou de config.storageSources, que só
// vem do whitelist de ~/.chama/config.json — nunca de query/body/header).
// Nunca segue symlink recursivamente nesta PR. `scanPath`/`scanStorageModel`/`scanConfiguredSources`
// nunca devolvem lista de arquivos, só resumo agregado (contagem/bytes/extensões) — mesmo em
// endpoints locais, não só na Presence. `listFiles` é a exceção deliberada: devolve paths reais,
// mas é só para uso interno do módulo chama (nunca ligado a nenhum endpoint Presence).
import { readdir, stat, lstat } from "node:fs/promises";
import { extname, join } from "node:path";
import { getStorageModel } from "./storageModel.js";
import { config } from "./config.js";
import { legacyStorageRoot } from "./legacyStorageConfig.js";

export const DEFAULT_INDEX_LIMITS = {
  maxDepth: 12,
  maxFiles: 5000,
};

const IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".Trash",
  "$RECYCLE.BIN",
  "System Volume Information",
]);
function getIgnoredKalineDirs() {
  const root = legacyStorageRoot();
  return new Set([
    join(root, "ash"),
    join(root, "codice"),
    join(root, "midia"),
    join(root, "design"),
    join(root, "documentos"),
    join(root, "codigo"),
  ]);
}
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export function isIgnoredFileName(name) {
  return (
    IGNORED_FILES.has(name) ||
    name.startsWith("~$") ||
    [".tmp", ".temp", ".part", ".crdownload", ".download", ".swp", ".lock"].some((suffix) =>
      name.toLowerCase().endsWith(suffix),
    )
  );
}

async function walk(rootPath, limits, state) {
  async function walkDir(dirPath, depth) {
    if (state.truncated) return;
    if (depth > limits.maxDepth) {
      state.truncated = true;
      state.truncatedReason = "maxDepth";
      return;
    }
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      state.safeErrors.push({ path: dirPath, code: err.code || "EUNKNOWN" });
      return;
    }
    for (const entry of entries) {
      if (state.truncated) return;
      if (entry.isSymbolicLink()) continue; // não segue symlink recursivamente nesta PR
      const entryPath = join(dirPath, entry.name);
      if (
        entry.isDirectory() &&
        (IGNORED_DIR_NAMES.has(entry.name) || getIgnoredKalineDirs().has(entryPath))
      ) {
        state.ignored += 1;
        continue;
      }
      if (entry.isFile() && isIgnoredFileName(entry.name)) {
        state.ignored += 1;
        continue;
      }
      if (entry.isDirectory()) {
        await walkDir(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue; // ignora sockets/fifos/devices
      if (state.entries.length >= limits.maxFiles) {
        state.truncated = true;
        state.truncatedReason = "maxFiles";
        return;
      }
      try {
        const st = await stat(entryPath);
        const ext = extname(entry.name).toLowerCase() || "(sem extensão)";
        state.entries.push({
          name: entry.name,
          path: entryPath,
          ext,
          size: st.size,
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs,
          mtimeIso: st.mtime.toISOString(),
          birthtimeIso: st.birthtime.toISOString(),
        });
      } catch (err) {
        state.safeErrors.push({ path: entryPath, code: err.code || "EUNKNOWN" });
      }
    }
  }
  await walkDir(rootPath, 0);
}

async function walkTarget(targetPath, limits) {
  let rootStat;
  try {
    rootStat = await lstat(targetPath);
  } catch (err) {
    return {
      exists: false,
      entries: [],
      truncated: false,
      truncatedReason: null,
      safeErrors: [{ path: targetPath, code: err.code || "ENOENT" }],
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      exists: true,
      entries: [],
      truncated: false,
      truncatedReason: null,
      safeErrors: [{ path: targetPath, code: "ENOTDIR" }],
    };
  }
  const state = {
    entries: [],
    ignored: 0,
    safeErrors: [],
    truncated: false,
    truncatedReason: null,
  };
  await walk(targetPath, limits, state);
  return { exists: true, ...state };
}

export async function scanPath(targetPath, limits = DEFAULT_INDEX_LIMITS) {
  const generatedAt = new Date().toISOString();
  const result = await walkTarget(targetPath, limits);

  const extensions = {};
  let bytes = 0;
  for (const entry of result.entries) {
    bytes += entry.size;
    extensions[entry.ext] = (extensions[entry.ext] || 0) + 1;
  }

  return {
    path: targetPath,
    exists: result.exists,
    files: result.entries.length,
    ignored: result.ignored || 0,
    bytes,
    extensions,
    truncated: result.truncated,
    ...(result.truncated ? { reason: result.truncatedReason } : {}),
    safeErrors: result.safeErrors,
    generatedAt,
  };
}

// Lista arquivos reais (path/ext/size) — só para uso interno do módulo chama.
// Nunca expor diretamente num endpoint (Presence ou local).
export async function listFiles(targetPath, limits = DEFAULT_INDEX_LIMITS) {
  const result = await walkTarget(targetPath, limits);
  return {
    path: targetPath,
    exists: result.exists,
    files: result.entries,
    ignored: result.ignored || 0,
    truncated: result.truncated,
    ...(result.truncated ? { reason: result.truncatedReason } : {}),
    safeErrors: result.safeErrors,
  };
}

export async function scanStorageModel(limits = DEFAULT_INDEX_LIMITS) {
  const model = getStorageModel();
  const folders = await Promise.all(
    model.folders.map(async (folder) => {
      const scan = await scanPath(folder.absolutePath, limits);
      return { id: folder.id, label: folder.label, category: folder.category, ...scan };
    }),
  );
  return { root: model.root, folders, generatedAt: new Date().toISOString() };
}

export async function scanConfiguredSources(limits = DEFAULT_INDEX_LIMITS) {
  const sources = config.storageSources || [];
  const items = await Promise.all(
    sources.map(async (source) => {
      const scan = await scanPath(source.path, limits);
      return {
        id: source.id,
        label: source.label,
        category: source.category,
        mode: source.mode,
        ...scan,
      };
    }),
  );
  return { items, generatedAt: new Date().toISOString() };
}
