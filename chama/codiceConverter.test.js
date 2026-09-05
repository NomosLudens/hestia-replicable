import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";

vi.mock("node:child_process", () => {
  const m = {
    exec: vi.fn(),
  };
  return {
    ...m,
    default: m,
  };
});

describe("codiceConverter", () => {
  let tempDir;
  let convertDocxToEpub;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-converter-test-"));
    const mod = await import("./codiceConverter.js");
    convertDocxToEpub = mod.convertDocxToEpub;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  it("converte docx para epub com sucesso", async () => {
    // Mock do child_process.exec para fingir a conversão do LibreOffice
    exec.mockImplementation((cmd, callback) => {
      // O LibreOffice deveria ler o .docx e criar o .epub na pasta temporária.
      // O cmd contém: soffice --headless --convert-to epub --outdir "/tmp/..." "/tmp/...docx"
      const match = cmd.match(/--outdir "([^"]+)" "([^"]+)"/);
      if (match) {
        const outdir = match[1];
        const docxPath = match[2];
        const baseName = path.parse(docxPath).name;
        const epubPath = path.join(outdir, `${baseName}.epub`);

        // Escreve um arquivo de epub "falso" para simular a saída
        fs.writeFile(epubPath, "dummy epub output")
          .then(() => {
            callback(null, { stdout: "convert success", stderr: "" });
          })
          .catch((err) => {
            callback(err);
          });
      } else {
        callback(new Error("Comando inválido"));
      }
    });

    const docxBuffer = Buffer.from("dummy docx input");
    const result = await convertDocxToEpub(docxBuffer, "Lei_Test.docx", tempDir);

    expect(result.success).toBe(true);
    expect(result.filename).toBe("Lei_Test.epub");

    // O arquivo .epub deve estar no destino correto (codice/epub/)
    const finalEpubPath = path.join(tempDir, "codice/epub/Lei_Test.epub");
    await expect(fs.access(finalEpubPath)).resolves.not.toThrow();

    const finalContent = await fs.readFile(finalEpubPath, "utf8");
    expect(finalContent).toBe("dummy epub output");
  });

  it("lança erro se o LibreOffice falhar", async () => {
    exec.mockImplementation((cmd, callback) => {
      callback(new Error("soffice error"));
    });

    const docxBuffer = Buffer.from("dummy docx input");
    await expect(convertDocxToEpub(docxBuffer, "Lei_Fail.docx", tempDir)).rejects.toThrow(
      "Falha ao executar o LibreOffice",
    );
  });

  it("lança erro se o LibreOffice terminar mas não gerar o epub", async () => {
    exec.mockImplementation((cmd, callback) => {
      // Finaliza sem criar o arquivo
      callback(null, { stdout: "convert success", stderr: "" });
    });

    const docxBuffer = Buffer.from("dummy docx input");
    await expect(convertDocxToEpub(docxBuffer, "Lei_Missing.docx", tempDir)).rejects.toThrow(
      "LibreOffice concluiu, mas o arquivo EPUB correspondente não foi gerado.",
    );
  });
});
