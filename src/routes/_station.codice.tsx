import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { hestiaApi, hestiaLegacyApi, formatBytes } from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";
import {
  FileUp,
  Search,
  Download,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_station/codice")({
  head: () => ({
    meta: [
      { title: "Héstia Console — Códice" },
      { name: "description", content: "Conversão de leis .docx para .epub via LibreOffice." },
    ],
  }),
  component: CodicePage,
});

function CodicePage() {
  const { state, retry, refreshing } = useApi(hestiaLegacyApi.codiceLibrary);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setErrorMsg("Apenas arquivos no formato do Word (.docx) são aceitos para conversão.");
      setSuccessMsg(null);
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await hestiaLegacyApi.codiceImport(file, file.name);
      if (res.status === "unavailable") {
        setErrorMsg(`Falha na importação: ${res.message}`);
      } else if (res.status === "ok") {
        if (res.data.success) {
          setSuccessMsg(`Lei "${file.name}" convertida e importada com sucesso!`);
          retry(); // Recarrega a biblioteca
        } else {
          setErrorMsg(`Falha na importação: ${res.data.filename || "erro desconhecido"}`);
        }
      } else {
        setErrorMsg("Falha na importação: estado desconhecido");
      }
    } catch (err) {
      setErrorMsg(`Erro de conexão: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const books = state.status === "ok" ? state.data.books : [];
  const filteredBooks = books.filter(
    (book) =>
      book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      book.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="kaline-eyebrow">/codice</p>
          <h1 className="kaline-serif text-3xl md:text-4xl text-[color:var(--kaline-text)]">
            Biblioteca do Códice
          </h1>
        </div>
        <div className="flex gap-2">
          {state.status === "ok" && (
            <button
              onClick={retry}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kaline-border-copper)] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper)]/10 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
              Recarregar
            </button>
          )}
        </div>
      </header>

      {/* Área de Upload / Conversão */}
      <section className="grid gap-6 md:grid-cols-[1fr_350px]">
        {/* Zona de Drop */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={cn(
            "relative flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all duration-300 min-h-[220px]",
            dragActive
              ? "border-[color:var(--kaline-amber)] bg-[color:var(--kaline-amber)]/[0.04]"
              : "border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)]/50 hover:bg-[color:var(--kaline-surface)]",
          )}
        >
          <input
            type="file"
            id="docx-upload"
            accept=".docx"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={handleFileInput}
            disabled={uploading}
          />

          <div className="text-center space-y-3 pointer-events-none">
            <div className="mx-auto w-12 h-12 rounded-full bg-[color:var(--kaline-copper)]/10 flex items-center justify-center">
              <FileUp
                className={cn(
                  "h-6 w-6 text-[color:var(--kaline-copper)]",
                  uploading && "animate-bounce",
                )}
              />
            </div>
            <div>
              <p className="text-sm text-[color:var(--kaline-text)] font-medium">
                {uploading
                  ? "Processando conversão via LibreOffice..."
                  : "Arraste leis em .docx aqui"}
              </p>
              <p className="text-xs text-[color:var(--kaline-muted)] mt-1">
                Ou clique para navegar no seu computador
              </p>
            </div>
          </div>

          {uploading && (
            <div className="absolute inset-0 bg-[color:var(--kaline-obsidian)]/80 rounded-2xl flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="h-8 w-8 text-[color:var(--kaline-copper)] animate-spin" />
              <p className="text-sm font-medium text-[color:var(--kaline-text)]">Gerando EPUB...</p>
              <p className="text-xs text-[color:var(--kaline-muted)]">
                Isso pode levar alguns segundos dependendo do tamanho da lei.
              </p>
            </div>
          )}
        </div>

        {/* Feedback de Status */}
        <div className="rounded-2xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-5 flex flex-col justify-center space-y-4">
          <p className="kaline-eyebrow">Conversor Headless</p>

          {errorMsg && (
            <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-red-400 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Erro</span>
              </div>
              <p className="text-xs leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {successMsg && (
            <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4 text-emerald-400 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Sucesso</span>
              </div>
              <p className="text-xs leading-relaxed">{successMsg}</p>
            </div>
          )}

          {!errorMsg && !successMsg && (
            <div className="text-xs text-[color:var(--kaline-muted)] space-y-2">
              <p>
                O Héstia Console recebe o arquivo do Word e executa o processador em modo oculto no
                servidor local.
              </p>
              <p>
                Os metadados como título e índice são otimizados de acordo com os padrões da
                Biblioteca do Códice.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Lista de Leis */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="kaline-eyebrow">Leis na Biblioteca ({filteredBooks.length})</p>
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[color:var(--kaline-muted)]" />
            <input
              type="text"
              placeholder="Pesquisar leis..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[color:var(--kaline-surface)] border border-[color:var(--kaline-border-copper)] rounded-full pl-9 pr-4 py-2 text-sm text-[color:var(--kaline-text)] placeholder-[color:var(--kaline-muted)] focus:outline-none focus:border-[color:var(--kaline-copper)]"
            />
          </div>
        </div>

        {state.status === "loading" && (
          <p className="text-[color:var(--kaline-muted)] text-center py-8">
            Carregando catálogo...
          </p>
        )}

        {state.status === "unavailable" && (
          <UnavailableNote
            message={state.message}
            details={state.details}
            onRetry={retry}
            refreshing={refreshing}
          />
        )}

        {state.status === "ok" && (
          <>
            {filteredBooks.length === 0 ? (
              <div className="rounded-2xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)]/20 p-12 text-center">
                <FileText className="h-12 w-12 text-[color:var(--kaline-muted)] mx-auto opacity-30" />
                <p className="text-[color:var(--kaline-muted)] mt-4">
                  Nenhuma lei encontrada na biblioteca.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredBooks.map((book) => {
                  const downloadUrl = hestiaApi.absoluteUrl(book.url);
                  return (
                    <div
                      key={book.id}
                      className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-4 flex flex-col justify-between hover:border-[color:var(--kaline-copper)] transition-colors duration-200"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-flex items-center rounded bg-[color:var(--kaline-copper)]/10 px-2 py-0.5 text-[10px] font-medium text-[color:var(--kaline-copper)] uppercase">
                            {book.format}
                          </span>
                          <span className="text-[11px] text-[color:var(--kaline-muted)] font-mono">
                            {formatBytes(book.size)}
                          </span>
                        </div>
                        <h3 className="font-medium text-[color:var(--kaline-text)] text-sm line-clamp-2 leading-tight">
                          {book.title}
                        </h3>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[color:var(--kaline-border-copper)]/30 flex items-center justify-between">
                        <span className="text-[10px] text-[color:var(--kaline-muted)]">
                          {new Date(book.modifiedAt).toLocaleDateString("pt-BR")}
                        </span>
                        <a
                          href={downloadUrl}
                          download
                          className="inline-flex items-center gap-1.5 text-xs text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-text)] transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Baixar</span>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
