import { cn } from "@/lib/utils";

export function KalineMark({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-3xl",
    xl: "text-6xl md:text-7xl",
  } as const;
  const glow = size === "lg" || size === "xl" ? "copper-glow" : "";
  return (
    <span
      aria-label="K∧LINE."
      className={cn("kaline-wordmark inline-flex items-baseline", sizes[size], glow, className)}
    >
      K<span className="mx-[0.06em] text-[color:var(--kaline-gold)] font-medium">∧</span>
      LINE
      <span className="text-[color:var(--kaline-copper)]">.</span>
    </span>
  );
}
