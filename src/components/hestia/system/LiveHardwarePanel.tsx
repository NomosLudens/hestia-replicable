import { formatBytes, type HardwareStatus } from "@/lib/hestia/api";
import { Row } from "../shared/Row";
export function LiveHardwarePanel({ data }: { data: HardwareStatus }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Row
        k="CPU load"
        v={`${data.cpu.loadRatio1m ?? "não disponível"} · ${data.cpu.usagePercent ?? "não disponível"}%`}
      />
      <Row
        k="RAM"
        v={`${data.memory.usedPercent}% · ${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`}
      />
      <Row
        k="swap"
        v={data.swap.usedPercent == null ? "não disponível" : `${data.swap.usedPercent}%`}
      />
      <Row
        k="temperatura"
        v={data.temperature.available ? `${data.temperature.maxC?.toFixed(1)}°C` : "não disponível"}
      />
      <Row k="serviços" v={`${data.services.active}/${data.services.total} ativos`} />
    </div>
  );
}
