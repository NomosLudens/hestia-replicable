export function hasLegacyConsoleStationConfig(text) {
  return /^HESTIA_STATION_(?:BASE_URL|TOKEN)=/m.test(String(text));
}

export function classifyConsoleStationState(state) {
  if (state === "available" || state === "not_configured") return "ok";
  if (state === "unavailable") return "warning";
  return "error";
}
