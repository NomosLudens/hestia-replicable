import { describe, it, expect } from "vitest";
import {
  parseDfOutput,
  filterRealVolumes,
  baseDiskName,
  discoverVolumes,
} from "./storageDiscovery.js";

const SAMPLE_DF = `Filesystem     Type  1024-blocks    Used Available Capacity Mounted on
tmpfs          tmpfs     8230588       0   8230588       0% /dev/shm
/dev/sda1      ext4    264212084 9643184  29205340      25% /
/dev/sdb1      ext4    976762584 500000  400000000      52% /mnt/hd
overlay        overlay  10000000  100000   9900000       1% /var/lib/docker/overlay2/abc123/merged
/dev/loop0     squashfs    50000   50000         0     100% /snap/core/1234
/dev/vda2      vfat       523248    5000    518248       1% /boot/efi`;

describe("parseDfOutput", () => {
  it("faz parse de todas as linhas, ignorando o cabeçalho", () => {
    const entries = parseDfOutput(SAMPLE_DF);
    expect(entries).toHaveLength(6);
    expect(entries[1]).toEqual({
      device: "/dev/sda1",
      fstype: "ext4",
      mountpoint: "/",
      totalBytes: 264212084 * 1024,
      usedBytes: 9643184 * 1024,
      freeBytes: 29205340 * 1024,
      percentUsed: 25,
    });
  });

  it("junta mountpoints com espaço em múltiplos tokens", () => {
    const withSpace = `Filesystem Type 1024-blocks Used Available Capacity Mounted on
/dev/sdc1 ext4 1000 100 800 10% /mnt/My Disk`;
    const entries = parseDfOutput(withSpace);
    expect(entries[0].mountpoint).toBe("/mnt/My Disk");
  });

  it("retorna [] para entrada vazia", () => {
    expect(parseDfOutput("Filesystem Type 1024-blocks Used Available Capacity Mounted on")).toEqual(
      [],
    );
  });
});

describe("filterRealVolumes", () => {
  it("remove pseudo-filesystems e ruído de snap/docker/boot", () => {
    const entries = parseDfOutput(SAMPLE_DF);
    const real = filterRealVolumes(entries);
    const mountpoints = real.map((e) => e.mountpoint);
    expect(mountpoints).toEqual(["/", "/mnt/hd"]);
  });
});

describe("baseDiskName", () => {
  it("extrai o disco base de partições sd*/vd*", () => {
    expect(baseDiskName("/dev/sda1")).toBe("sda");
    expect(baseDiskName("/dev/vdb")).toBe("vdb");
  });

  it("extrai o disco base de nvme (nome com 'p' antes da partição)", () => {
    expect(baseDiskName("/dev/nvme0n1p1")).toBe("nvme0n1");
    expect(baseDiskName("/dev/nvme0n1")).toBe("nvme0n1");
  });

  it("retorna null para devices sem padrão reconhecido (LVM/mapper)", () => {
    expect(baseDiskName("/dev/mapper/vg0-root")).toBeNull();
    expect(baseDiskName("overlay")).toBeNull();
  });
});

describe("discoverVolumes", () => {
  it("roda contra o df real e devolve items com kind ssd/hdd/unknown", async () => {
    const result = await discoverVolumes();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.checkedAt).toBeDefined();
    for (const item of result.items) {
      expect(["ssd", "hdd", "unknown"]).toContain(item.kind);
      expect(typeof item.mountpoint).toBe("string");
    }
  });
});
