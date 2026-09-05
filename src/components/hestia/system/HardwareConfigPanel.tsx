import { formatBytes, formatUptime, type HardwareConfig } from "@/lib/hestia/api";
import { Row } from "../shared/Row";
function formatDisk(d: HardwareConfig["disks"]["items"][number]) {
  const mount =
    d.mountpoint ??
    (d.mountedPartition ? `partição montada em ${d.mountedPartition.mountpoint}` : "sem mount");
  const fstype = d.fstype ?? (d.mountedPartition ? d.mountedPartition.fstype : "não disponível");
  return `${d.size ?? "não disponível"} · ${mount} · ${fstype ?? "não disponível"}`;
}

export function HardwareConfigPanel({ data }: { data: HardwareConfig }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-2">
        <Row k="hostname" v={data.hostname} />
        <Row k="sistema" v={data.platform} />
        <Row k="kernel" v={data.release} />
        <Row k="arquitetura" v={data.arch} />
        <Row k="uptime" v={formatUptime(data.uptime)} />
        <Row k="CPU" v={data.cpu.model} />
        <Row k="cores/threads" v={`${data.cpu.cores}/${data.cpu.threads}`} />
        <Row k="RAM" v={formatBytes(data.memory.total)} />
        <Row k="Héstia" v={`${data.hestia.host}:${data.hestia.port}`} />
        <Row k="modo" v={data.hestia.mode} />
      </div>
      <div>
        {data.disks.available ? (
          data.disks.items.map((d) => <Row key={d.name} k={d.name} v={formatDisk(d)} />)
        ) : (
          <Row k="discos" v={data.disks.error ?? "não disponível"} />
        )}
      </div>
    </div>
  );
}
