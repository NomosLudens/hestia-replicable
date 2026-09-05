import { describe, expect, it, vi } from "vitest";
import {
  cleanDesktopExec,
  getStationSoftwareInventory,
  parseDesktopFile,
  updateStationApplication,
} from "./softwareInventory.js";

describe("softwareInventory", () => {
  describe("parseDesktopFile & cleanDesktopExec", () => {
    it(".desktop Exec com %U, %f, %F extrai executável sem executar shell", () => {
      const exec1 = cleanDesktopExec("/usr/bin/google-chrome-stable %U --incognito");
      expect(exec1).toBe("/usr/bin/google-chrome-stable");

      const exec2 = cleanDesktopExec('"/usr/share/antigravity/antigravity" %F --new-window');
      expect(exec2).toBe("/usr/share/antigravity/antigravity");
    });

    it("ignora arquivos .desktop com Type!=Application ou NoDisplay=true", () => {
      const noDisplayContent = `
[Desktop Entry]
Name=Hidden App
Exec=/usr/bin/hidden
Type=Application
NoDisplay=true
`;
      expect(parseDesktopFile(noDisplayContent)).toBeNull();

      const typeLinkContent = `
[Desktop Entry]
Name=Some Link
URL=http://example.com
Type=Link
`;
      expect(parseDesktopFile(typeLinkContent)).toBeNull();
    });

    it("parseia corretamente aplicativo .desktop válido", () => {
      const content = `
[Desktop Entry]
Name=Antigravity
Comment=Experience liftoff
Exec=/usr/share/antigravity/antigravity %F
Icon=antigravity
Type=Application
Categories=TextEditor;Development;IDE;
`;
      const parsed = parseDesktopFile(content, "/usr/share/applications/antigravity.desktop");
      expect(parsed).toEqual({
        desktopEntry: "/usr/share/applications/antigravity.desktop",
        name: "Antigravity",
        rawExec: "/usr/share/antigravity/antigravity %F",
        executablePath: "/usr/share/antigravity/antigravity",
        icon: "antigravity",
        comment: "Experience liftoff",
        categories: ["TextEditor", "Development", "IDE"],
      });
    });
  });

  describe("getStationSoftwareInventory", () => {
    it("CLI sem desktop metadata NÃO vira aplicativo", async () => {
      // Setup mock filesystem with no desktop entry for 'git' or 'curl'
      const mockReadDir = vi.fn().mockReturnValue([]);
      const execFileImpl = vi.fn().mockImplementation(async (cmd) => {
        if (cmd === "dpkg") return { stdout: "1.0.0" };
        if (cmd === "dpkg-query") {
          return { stdout: "git\t2.39.0\ncurl\t7.88.0\n" };
        }
        throw new Error("unsupported");
      });

      const res = await getStationSoftwareInventory({
        readdirSyncImpl: mockReadDir,
        execFileImpl,
      });

      expect(res.ok).toBe(true);
      expect(res.applications.find((a) => a.name === "git")).toBeUndefined();
      expect(res.applications.find((a) => a.name === "curl")).toBeUndefined();
    });

    it("deduplica entradas .desktop duplicadas", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Sample App
Exec=/usr/bin/sample
Type=Application
`;
      const mockReadDir = vi.fn().mockImplementation((dir) => {
        if (dir === "/usr/share/applications") return ["sample.desktop"];
        if (dir === "/usr/local/share/applications") return ["sample.desktop"];
        return [];
      });

      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      const execFileImpl = vi.fn().mockImplementation(async (cmd) => {
        if (cmd === "dpkg") return { stdout: "1.0.0" };
        if (cmd === "dpkg-query") return { stdout: "sample\t1.0.0\n" };
        if (cmd === "apt-get") return { stdout: "" };
        throw new Error("cmd not found");
      });

      const res = await getStationSoftwareInventory({
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
      });

      expect(res.ok).toBe(true);
      const sampleApps = res.applications.filter((a) => a.executable === "/usr/bin/sample");
      expect(sampleApps.length).toBe(1);
    });

    it("classifica como source='manual' quando executável não possui ownership de pacotes", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Custom App
Exec=/opt/custom/bin/app
Type=Application
`;
      const mockReadDir = vi.fn().mockReturnValue(["custom.desktop"]);
      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      const execFileImpl = vi.fn().mockImplementation(async (cmd) => {
        if (cmd === "dpkg") return { stdout: "1.0.0" };
        if (cmd === "dpkg-query") return { stdout: "" };
        if (cmd === "apt-get") return { stdout: "" };
        throw new Error("cmd not found");
      });

      const res = await getStationSoftwareInventory({
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
      });

      expect(res.ok).toBe(true);
      const app = res.applications.find((a) => a.name === "Custom App");
      expect(app).toBeDefined();
      expect(app.source).toBe("manual");
      expect(app.managed).toBe(false);
      expect(app.updateStatus).toBe("unknown");
    });

    it("classifica como source='apt' com updateStatus='up_to_date' quando installed == candidate", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Antigravity
Exec=/usr/share/antigravity/antigravity
Type=Application
`;
      const mockReadDir = vi.fn().mockReturnValue(["antigravity.desktop"]);
      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      const execFileImpl = vi.fn().mockImplementation(async (cmd, args) => {
        if (cmd === "dpkg" && args?.[0] === "--version") return { stdout: "1.0.0" };
        if (cmd === "dpkg" && args?.[0] === "-S") {
          return { stdout: "antigravity: /usr/share/antigravity/antigravity\n" };
        }
        if (cmd === "dpkg-query") return { stdout: "antigravity\t1.23.2-1776332190\n" };
        if (cmd === "apt-get") return { stdout: "" };
        throw new Error("cmd not found");
      });

      const res = await getStationSoftwareInventory({
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
      });

      expect(res.ok).toBe(true);
      const app = res.applications.find((a) => a.name === "Antigravity");
      expect(app).toBeDefined();
      expect(app.source).toBe("apt");
      expect(app.packageId).toBe("antigravity");
      expect(app.installedVersion).toBe("1.23.2-1776332190");
      expect(app.availableVersion).toBe("1.23.2-1776332190");
      expect(app.updateStatus).toBe("up_to_date");
    });

    it("classifica como updateStatus='update_available' quando candidate != installed", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Chrome
Exec=/usr/bin/google-chrome-stable
Type=Application
`;
      const mockReadDir = vi.fn().mockReturnValue(["google-chrome.desktop"]);
      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      const execFileImpl = vi.fn().mockImplementation(async (cmd, args) => {
        if (cmd === "dpkg" && args?.[0] === "--version") return { stdout: "1.0.0" };
        if (cmd === "dpkg" && args?.[0] === "-S") {
          return { stdout: "google-chrome-stable: /usr/bin/google-chrome-stable\n" };
        }
        if (cmd === "dpkg-query") return { stdout: "google-chrome-stable\t120.0.0\n" };
        if (cmd === "apt-get") {
          return { stdout: "Inst google-chrome-stable [120.0.0] (121.0.0 main)\n" };
        }
        throw new Error("cmd not found");
      });

      const res = await getStationSoftwareInventory({
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
      });

      expect(res.ok).toBe(true);
      const app = res.applications.find((a) => a.name === "Chrome");
      expect(app).toBeDefined();
      expect(app.source).toBe("apt");
      expect(app.installedVersion).toBe("120.0.0");
      expect(app.availableVersion).toBe("121.0.0");
      expect(app.updateStatus).toBe("update_available");
    });

    it("ausência ou falha de um provider não aborta os demais", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Test App
Exec=/usr/bin/testapp
Type=Application
`;
      const mockReadDir = vi.fn().mockReturnValue(["testapp.desktop"]);
      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      const execFileImpl = vi.fn().mockImplementation(async (cmd) => {
        if (cmd === "dpkg") throw new Error("dpkg not installed");
        if (cmd === "flatpak") throw new Error("flatpak not installed");
        if (cmd === "snap") throw new Error("snap not installed");
        throw new Error("unknown");
      });

      const res = await getStationSoftwareInventory({
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
      });

      expect(res.ok).toBe(true);
      expect(res.providers.apt).toBe(false);
      expect(res.providers.flatpak).toBe(false);
      expect(res.providers.snap).toBe(false);
      expect(res.applications.length).toBe(1);
      expect(res.applications[0].source).toBe("manual");
    });
  });

  describe("updateStationApplication", () => {
    it("rejeita appId inexistente ou app sem atualização", async () => {
      const mockReadDir = vi.fn().mockReturnValue([]);
      const execFileImpl = vi.fn().mockImplementation(async (cmd) => {
        if (cmd === "dpkg") return { stdout: "1.0.0" };
        if (cmd === "dpkg-query") return { stdout: "" };
        throw new Error("cmd not found");
      });

      const resNotFound = await updateStationApplication("apt:nonexistent", {
        readdirSyncImpl: mockReadDir,
        execFileImpl,
      });
      expect(resNotFound.ok).toBe(false);
      expect(resNotFound.code).toBe("APP_NOT_FOUND");
    });

    it("executa atualização controlada para aplicativo gerenciável com update_available", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Antigravity
Exec=/usr/share/antigravity/antigravity
Type=Application
`;
      const mockReadDir = vi.fn().mockReturnValue(["antigravity.desktop"]);
      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      let step = "before_update";
      const execFileImpl = vi.fn().mockImplementation(async (cmd, args) => {
        if (cmd === "dpkg" && args?.[0] === "--version") return { stdout: "1.0.0" };
        if (cmd === "dpkg" && args?.[0] === "-S") {
          return { stdout: "antigravity: /usr/share/antigravity/antigravity\n" };
        }
        if (cmd === "dpkg-query") {
          const ver = step === "before_update" ? "1.23.2-1776332190" : "1.24.0";
          return { stdout: `antigravity\t${ver}\n` };
        }
        if (cmd === "apt-get" && args?.[0] === "-s") {
          return { stdout: "Inst antigravity [1.23.2-1776332190] (1.24.0 main)\n" };
        }
        if (cmd === "apt-get" && args?.[0] === "install") {
          expect(args).toEqual(["install", "-y", "--only-upgrade", "antigravity"]);
          step = "after_update";
          return { stdout: "Reading package lists... Done\n" };
        }
        throw new Error("cmd not found");
      });

      const res = await updateStationApplication("apt:antigravity", {
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
        sudoPassword: "transient_secret_123",
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("updated");
      expect(res.appId).toBe("apt:antigravity");
      expect(res.installedVersion).toBe("1.24.0");
    });

    it("nunca vaza a senha efêmera em mensagens de erro", async () => {
      const desktopContent = `
[Desktop Entry]
Name=Chrome
Exec=/usr/bin/google-chrome-stable
Type=Application
`;
      const mockReadDir = vi.fn().mockReturnValue(["chrome.desktop"]);
      const mockReadFile = vi.fn().mockReturnValue(desktopContent);
      const mockExists = vi.fn().mockReturnValue(true);

      const secret = "super_secret_sudo_password";
      const execFileImpl = vi.fn().mockImplementation(async (cmd, args) => {
        if (cmd === "dpkg" && args?.[0] === "--version") return { stdout: "1.0.0" };
        if (cmd === "dpkg" && args?.[0] === "-S") {
          return { stdout: "google-chrome-stable: /usr/bin/google-chrome-stable\n" };
        }
        if (cmd === "dpkg-query") return { stdout: "google-chrome-stable\t120.0.0\n" };
        if (cmd === "apt-get" && args?.[0] === "-s") {
          return { stdout: "Inst google-chrome-stable [120.0.0] (121.0.0 main)\n" };
        }
        if (cmd === "apt-get" && args?.[0] === "install") {
          throw new Error(`apt-get failed with secret ${secret}`);
        }
        throw new Error("cmd not found");
      });

      const res = await updateStationApplication("apt:google-chrome-stable", {
        readdirSyncImpl: mockReadDir,
        readFileSyncImpl: mockReadFile,
        existsSyncImpl: mockExists,
        execFileImpl,
        sudoPassword: secret,
      });

      expect(res.ok).toBe(false);
      expect(res.code).toBe("UPDATE_EXEC_FAILED");
      expect(res.error).not.toContain(secret);
    });
  });
});
