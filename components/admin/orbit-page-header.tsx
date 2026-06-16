export function OrbitPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8 border-b border-border pb-5">
      {eyebrow && (
        <p className="mb-2 font-bold text-xs text-success uppercase tracking-eyebrow">
          {eyebrow}
        </p>
      )}
      <h1 className="font-black text-2xl tracking-normal">{title}</h1>
      {description && (
        <p className="mt-1.5 text-muted-foreground text-sm">{description}</p>
      )}
    </div>
  );
}
