export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="kaline-eyebrow">{eyebrow}</p>
        <h2 className="kaline-serif text-2xl text-[color:var(--kaline-text)]">{title}</h2>
      </div>
      {action}
    </div>
  );
}
