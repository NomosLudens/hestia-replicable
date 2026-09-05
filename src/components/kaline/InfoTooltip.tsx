import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Tooltip leve, sem dependência de lib externa.
 *
 * Abre por hover (mouse) OU por click/focus (touch/teclado). Fecha com ESC
 * ou click fora. Posiciona-se com `position` (top|bottom|left|right).
 *
 * Não roda em SSR hydration mismatch: renderiza portal-less (mesma árvore)
 * e usa estado local puro.
 */
export function InfoTooltip({
  children,
  content,
  position = "top",
  ariaLabel,
}: {
  /** Gatilho (texto curto, ícone, badge). O tooltip envolve este nó. */
  children: ReactNode;
  /** Conteúdo do tooltip. Aceita JSX, headings, listas curtas. */
  content: ReactNode;
  /** Lado preferido. Padrão "top". */
  position?: "top" | "bottom" | "left" | "right";
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const positionClass =
    position === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : position === "bottom"
        ? "top-full mt-2 left-1/2 -translate-x-1/2"
        : position === "left"
          ? "right-full mr-2 top-1/2 -translate-y-1/2"
          : "left-full ml-2 top-1/2 -translate-y-1/2";

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={ariaLabel ?? "informações"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center outline-none focus-visible:ring-1 focus-visible:ring-sky-400 rounded"
      >
        {children}
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 ${positionClass} w-[min(380px,90vw)] max-w-[90vw] rounded-md border border-sky-500/40 bg-zinc-950/95 px-3 py-2 text-[11.5px] leading-relaxed font-normal text-zinc-100 shadow-xl backdrop-blur-sm text-left whitespace-normal`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/** Badge ⓘ inline (info), para usar dentro de InfoTooltip. */
export function InfoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-zinc-500/50 bg-zinc-800/60 text-[9px] text-zinc-400 ${className}`}
    >
      i
    </span>
  );
}
