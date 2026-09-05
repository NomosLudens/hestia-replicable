import { promises as fs, constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ALLOWED_FOLDERS = ["codice/epub", "codice/pdf", "codice/txt"];
const ALLOWED_EXTENSIONS = {
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

const CACHE_TTL_MS = 5000;
const MAX_BOOKS = 5000;
const MAX_DEPTH = 5;

// Cache em memória associado à raiz
let cache = {
  storageRoot: null,
  generatedAt: null, // ISO String da indexação real
  generatedAtTime: 0, // timestamp de controle do TTL
  result: null,
};

export function isCodiceLibraryUnavailableError(error) {
  const codes = [
    "EACCES",
    "EPERM",
    "EIO",
    "ENOENT",
    "EMFILE",
    "ENFILE",
    "ESTALE",
    "ENODEV",
    "ECODICELIBRARY",
  ];
  const code = error?.code || error?.message;
  return codes.includes(code);
}

export async function getAvailableCodiceFolders(storageRoot) {
  const folders = [];

  // EPUB é obrigatório
  try {
    const epubPath = path.join(storageRoot, "codice/epub");
    await fs.access(epubPath, constants.R_OK);
    folders.push("codice/epub");
  } catch (err) {
    const error = new Error("CODICE_LIBRARY_UNAVAILABLE");
    error.code = "ECODICELIBRARY";
    throw error;
  }

  // PDF é obrigatório
  try {
    const pdfPath = path.join(storageRoot, "codice/pdf");
    await fs.access(pdfPath, constants.R_OK);
    folders.push("codice/pdf");
  } catch (err) {
    const error = new Error("CODICE_LIBRARY_UNAVAILABLE");
    error.code = "ECODICELIBRARY";
    throw error;
  }

  // TXT é opcional
  try {
    const txtPath = path.join(storageRoot, "codice/txt");
    await fs.access(txtPath, constants.R_OK);
    folders.push("codice/txt");
  } catch {
    // Silenciosamente ignorado se ausente ou ilegível
  }

  return folders;
}

export async function assertCodiceLibraryAvailable(storageRoot) {
  await getAvailableCodiceFolders(storageRoot);
}

export async function getCodiceHealth(storagePathBase) {
  const folders = await getAvailableCodiceFolders(storagePathBase);
  const formats = folders.map((f) => path.basename(f));

  return {
    ok: true,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    libraryAvailable: true,
    formats,
  };
}

async function indexLibrary(storagePathBase) {
  const normRoot = path.resolve(storagePathBase);
  const now = Date.now();
  if (cache.storageRoot === normRoot && now - cache.generatedAtTime < CACHE_TTL_MS) {
    return {
      books: cache.result.books,
      truncated: cache.result.truncated,
      generatedAt: cache.generatedAt,
    };
  }

  const availableFolders = await getAvailableCodiceFolders(storagePathBase);

  const books = [];
  let truncated = false;

  for (const folder of availableFolders) {
    if (books.length >= MAX_BOOKS) {
      truncated = true;
      break;
    }
    const rootPath = path.join(storagePathBase, folder);

    // Recursão controlada (profundidade máxima de 5)
    const scan = async (dir, depth) => {
      if (depth > MAX_DEPTH) return;
      if (books.length >= MAX_BOOKS) {
        truncated = true;
        return;
      }

      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === "ENOENT") {
          return;
        }
        throw err;
      }

      for (const entry of entries) {
        if (books.length >= MAX_BOOKS) {
          truncated = true;
          return;
        }

        // Ignorar dotfiles e diretórios ocultos
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(dir, entry.name);

        // Ignorar symlinks
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
          await scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!ALLOWED_EXTENSIONS[ext]) continue;

          try {
            // Executa lstat para verificar se é symlink/arquivo regular e obter tamanho
            const stat = await fs.lstat(fullPath);
            if (stat.isSymbolicLink() || !stat.isFile()) continue;

            const relPath = path.relative(storagePathBase, fullPath);
            const bookId = crypto.createHash("sha256").update(relPath).digest("base64url");

            books.push({
              id: bookId,
              name: entry.name,
              title: path.parse(entry.name).name,
              author: null,
              format: ext.slice(1),
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
              url: `/api/codice/books/${bookId}`,
              _fullPath: fullPath,
              _relPath: relPath,
            });
          } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
          }
        }
      }
    };

    await scan(rootPath, 0);
  }

  const generatedAtIso = new Date(now).toISOString();
  cache = {
    storageRoot: normRoot,
    generatedAt: generatedAtIso,
    generatedAtTime: now,
    result: {
      books,
      truncated,
    },
  };
  return {
    books,
    truncated,
    generatedAt: generatedAtIso,
  };
}

export async function getCodiceLibrary(storagePathBase) {
  await assertCodiceLibraryAvailable(storagePathBase);
  try {
    const { books, truncated, generatedAt } = await indexLibrary(storagePathBase);
    const sortedBooks = [...books].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));

    // Limpa campos internos antes de devolver
    const publicBooks = sortedBooks.map(({ _fullPath, _relPath, ...rest }) => rest);

    return {
      schemaVersion: 1,
      generatedAt,
      truncated,
      limit: MAX_BOOKS,
      books: publicBooks,
    };
  } catch (err) {
    const error = new Error(`Erro na biblioteca do Códice: ${err.code || "EUNKNOWN"}`);
    error.code = err.code || "EUNKNOWN";
    throw error;
  }
}

export async function resolveCodiceBook(storagePathBase, bookId) {
  try {
    // 1. Localizar pelo índice
    const { books } = await indexLibrary(storagePathBase);
    const book = books.find((b) => b.id === bookId);
    if (!book) return null;

    // 2. lstat
    const resolvedPath = path.resolve(storagePathBase, book._relPath);
    let stat;
    try {
      stat = await fs.lstat(resolvedPath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }

    // 3. Rejeitar symlink
    if (stat.isSymbolicLink()) return null;

    // 4. realpath
    let realPath;
    try {
      realPath = await fs.realpath(resolvedPath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }

    // 5. Confirmar contenção com path.relative
    const isContained = ALLOWED_FOLDERS.some((folder) => {
      const rootFolder = path.resolve(storagePathBase, folder);
      const relative = path.relative(rootFolder, realPath);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!isContained) return null;

    // 6. Confirmar arquivo regular (pelo realpath)
    const realStat = await fs.lstat(realPath);
    if (!realStat.isFile() || realStat.isSymbolicLink()) return null;

    // 7. Confirmar extensão permitida
    const ext = path.extname(realPath).toLowerCase();
    const mimeType = ALLOWED_EXTENSIONS[ext];
    if (!mimeType) return null;

    return {
      fullPath: realPath,
      mimeType,
      stat: realStat, // stat fresco vindo do disco
      filename: book.name,
    };
  } catch (err) {
    const error = new Error(`Erro ao resolver livro: ${err.code || "EUNKNOWN"}`);
    error.code = err.code || "EUNKNOWN";
    throw error;
  }
}

export async function openVerifiedCodiceBook(resolved) {
  const fileHandle = await fs.open(resolved.fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const openedStat = await fileHandle.stat();

    if (
      !openedStat.isFile() ||
      openedStat.dev !== resolved.stat.dev ||
      openedStat.ino !== resolved.stat.ino
    ) {
      throw Object.assign(new Error("CODICE_BOOK_UNAVAILABLE"), { code: "ECODICEBOOKUNAVAILABLE" });
    }

    return {
      fileHandle,
      stat: openedStat,
    };
  } catch (error) {
    await fileHandle.close().catch(() => {});
    throw error;
  }
}

function encodeRFC5987ValueChars(value) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function getBookHeaders(resolved) {
  const size = resolved.stat.size;
  const mtimeMs = resolved.stat.mtime.getTime();
  // ETag fraco derivado de size + mtimeMs
  const etag = `W/"${size}-${mtimeMs}"`;

  // Content-Disposition: inline, basename sanitizado (sem CR/LF/NUL/controls)
  const cleanFilename = resolved.filename.replace(/[\r\n\0\x00-\x1F\x7F]/g, "");

  // filename ASCII puro: remove não-ASCII e escapa aspas
  const asciiFilename = cleanFilename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, '\\"');

  // filename*=UTF-8'': codificado via RFC 5987
  const utf8Filename = encodeRFC5987ValueChars(cleanFilename);

  const contentDisposition = `inline; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`;

  return {
    "Content-Type": resolved.mimeType,
    "Content-Length": String(size),
    "Last-Modified": resolved.stat.mtime.toUTCString(),
    ETag: etag,
    "Content-Disposition": contentDisposition,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export function clearCodiceCache() {
  cache = {
    storageRoot: null,
    generatedAt: null,
    generatedAtTime: 0,
    result: null,
  };
}
