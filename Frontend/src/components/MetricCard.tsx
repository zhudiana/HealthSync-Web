// src/components/MetricCard.tsx
type Props = {
  title: string;
  value?: string | number;
  sub?: string;
  loading?: boolean;
};
export default function MetricCard({ title, value, sub, loading }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">
        {loading ? "—" : value ?? "—"}
      </div>
      {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
