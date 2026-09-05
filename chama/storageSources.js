import { normalize, resolve, isAbsolute, sep } from "node:path";

const EXTERNAL_READONLY = "external-readonly";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function storageRootFromEnv(env = process.env) {
  return env.HESTIA_STORAGE_PATH || env.HESTIA_KALINE_ROOT || "/KALINE";
}

function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(`${p}${sep}`);
}

function hasKalineSegment(pathValue) {
  return normalize(pathValue).split(sep).includes("KALINE");
}

export function validateStorageSources(rawSources, options = {}) {
  if (!Array.isArray(rawSources)) return [];

  const storageRoot = normalize(resolve(options.storageRoot || storageRootFromEnv(options.env)));
  const seenIds = new Set();
  const seenPaths = new Set();
  const valid = [];

  for (const item of rawSources) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const id = cleanString(item.id);
    const label = cleanString(item.label);
    const rawPath = cleanString(item.path);
    const category = cleanString(item.category);
    const mode = cleanString(item.mode);

    if (!id || !label || !rawPath || !category) continue;
    if (mode !== EXTERNAL_READONLY) continue;
    if (!isAbsolute(rawPath)) continue;

    const normalizedPath = normalize(resolve(rawPath));
    if (normalizedPath === sep) continue;
    if (hasKalineSegment(normalizedPath)) continue;
    if (isInside(normalizedPath, storageRoot) || isInside(storageRoot, normalizedPath)) continue;
    if (seenIds.has(id) || seenPaths.has(normalizedPath)) continue;

    seenIds.add(id);
    seenPaths.add(normalizedPath);
    valid.push({ id, label, path: normalizedPath, category, mode });
  }

  return valid;
}
