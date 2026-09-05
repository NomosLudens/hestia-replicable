const MINIMUM = [22, 13, 0];

export function parseNodeVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

export function supportsHestiaNode(value) {
  const current = parseNodeVersion(value);
  if (!current) return false;
  for (let index = 0; index < MINIMUM.length; index += 1) {
    if (current[index] > MINIMUM[index]) return true;
    if (current[index] < MINIMUM[index]) return false;
  }
  return true;
}

if (!supportsHestiaNode(process.version)) {
  console.error(`Node.js >=22.13.0 é necessário (detectado ${process.version}).`);
  process.exitCode = 1;
}
