// src/components/MetricCard.tsx
type Props = {
  title: string;
  value?: React.ReactNode;
  sub?: string;
  note?: string; // NEW
  loading?: boolean;
  children?: React.ReactNode; // NEW (for charts)
};

export default function MetricCard({
  title,
  value,
  sub,
  note,
  loading,
  children,
}: Props) {
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">
        {loading ? "—" : value ?? "—"}{" "}
        {sub ? (
          <span className="text-base font-normal text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
      {children}
    </div>
  );
}
