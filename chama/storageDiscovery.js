// Chama Local — descoberta read-only de volumes montados via `df -PTk`.
// Nunca aceita path vindo de fora: só lista o que o SO já tem montado.
// `kind` (ssd/hdd) é heurística best-effort via /sys/block/<disco>/queue/rotational
// — em VM/containers/LVM isso costuma faltar, e aí cai para "unknown" (nunca inventa).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const pExecFile = promisify(execFile);

// Pseudo-filesystems que não representam um disco de verdade.
const IGNORED_FSTYPES = new Set([
  "tmpfs",
  "devtmpfs",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
  "overlay",
  "squashfs",
  "autofs",
  "mqueue",
  "debugfs",
  "tracefs",
  "configfs",
  "devpts",
  "securityfs",
  "pstore",
  "bpf",
  "binfmt_misc",
  "rpc_pipefs",
  "fusectl",
  "hugetlbfs",
  "efivarfs",
  "nsfs",
]);

// Mountpoints que tecnicamente não são pseudo-fs mas são ruído (snap, docker, boot).
const IGNORED_MOUNT_PREFIXES = ["/snap/", "/var/lib/docker/", "/boot", "/run", "/dev"];

export function parseDfOutput(stdout) {
  const lines = stdout.trim().split("\n").slice(1); // pula linha de cabeçalho
  return lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) return null;
      const [device, fstype, totalK, usedK, availK, capacity, ...mountParts] = parts;
      const mountpoint = mountParts.join(" ");
      const totalKNum = Number(totalK);
      return {
        device,
        fstype,
        mountpoint,
        totalBytes: totalKNum * 1024,
        usedBytes: Number(usedK) * 1024,
        freeBytes: Number(availK) * 1024,
        percentUsed: Number(capacity.replace("%", "")) || 0,
      };
    })
    .filter(Boolean);
}

export function filterRealVolumes(entries) {
  return entries.filter((e) => {
    if (IGNORED_FSTYPES.has(e.fstype)) return false;
    if (IGNORED_MOUNT_PREFIXES.some((p) => e.mountpoint === p || e.mountpoint.startsWith(p)))
      return false;
    return true;
  });
}

// /dev/sda1 -> sda, /dev/nvme0n1p1 -> nvme0n1, /dev/vda -> vda; sem match (LVM/mapper) -> null.
export function baseDiskName(device) {
  const nvme = device.match(/^\/dev\/(nvme\d+n\d+)p?\d*$/);
  if (nvme) return nvme[1];
  const classic = device.match(/^\/dev\/((?:sd|vd|hd)[a-z]+)\d*$/);
  return classic ? classic[1] : null;
}

async function detectRotational(device) {
  const base = baseDiskName(device);
  if (!base) return null;
  try {
    const raw = await readFile(`/sys/block/${base}/queue/rotational`, "utf8");
    return raw.trim() === "1";
  } catch {
    return null;
  }
}

export async function discoverVolumes() {
  try {
    const { stdout } = await pExecFile("df", ["-PTk"], { timeout: 3000 });
    const real = filterRealVolumes(parseDfOutput(stdout));
    const items = await Promise.all(
      real.map(async (v) => {
        const rotational = await detectRotational(v.device);
        const kind = rotational === null ? "unknown" : rotational ? "hdd" : "ssd";
        return { ...v, kind };
      }),
    );
    return { items, checkedAt: new Date().toISOString() };
  } catch {
    return { items: [], error: "df indisponível", checkedAt: new Date().toISOString() };
  }
}
