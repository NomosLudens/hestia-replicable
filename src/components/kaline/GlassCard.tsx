import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Contêiner-base para as fichas da Estação.
 * Padding responsivo: mais apertado no mobile (p-5) e mais respirado a partir de sm (p-6).
 * Consumidores podem sobrescrever com `className` (ex.: "py-4").
 */
export const GlassCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "kaline-glass lift-card press-scale",
        "p-5 sm:p-6",
        "min-w-0", // impede que filhos com texto longo estourem o grid
        className,
      )}
      {...props}
    />
  ),
);
GlassCard.displayName = "GlassCard";
