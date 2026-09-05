import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";

// Executa comandos em modo promessa manualmente para contornar problemas de mock com util.promisify.custom
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Sanitiza o nome do arquivo para evitar injeção de comando e nomes problemáticos
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9.\-_]/g, "_") // Remove caracteres especiais
    .replace(/_{2,}/g, "_"); // Remove underlines seguidos
}

export async function convertDocxToEpub(docxBuffer, originalFilename, storageRoot) {
  const epubDir = path.join(storageRoot, "codice/epub");

  // Garante que o diretório codice/epub existe
  await fs.mkdir(epubDir, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codice-import-"));
  const sanitizedName = sanitizeFilename(originalFilename);
  const baseName = path.parse(sanitizedName).name;

  const tempDocxPath = path.join(tempDir, `${baseName}.docx`);
  const expectedEpubPath = path.join(tempDir, `${baseName}.epub`);
  const targetEpubPath = path.join(epubDir, `${baseName}.epub`);

  try {
    // 1. Grava o buffer docx temporário
    await fs.writeFile(tempDocxPath, docxBuffer);

    // 2. Executa a conversão via LibreOffice
    // Usamos caminhos absolutos e aspas para segurança adicional
    const cmd = `soffice --headless --convert-to epub --outdir "${tempDir}" "${tempDocxPath}"`;

    try {
      await execAsync(cmd);
    } catch (err) {
      throw new Error(`Falha ao executar o LibreOffice: ${err.message}`);
    }

    // 3. Verifica se o epub foi gerado
    try {
      await fs.access(expectedEpubPath);
    } catch {
      throw new Error("LibreOffice concluiu, mas o arquivo EPUB correspondente não foi gerado.");
    }

    // 4. Move o arquivo final para o destino
    await fs.rename(expectedEpubPath, targetEpubPath);

    return {
      success: true,
      filename: `${baseName}.epub`,
      path: targetEpubPath,
    };
  } finally {
    // Limpa a pasta temporária
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
