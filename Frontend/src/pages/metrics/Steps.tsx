// src/pages/metrics/Steps.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { withingsStepsRange } from "@/lib/api";
import { tokens } from "@/lib/storage";

// recharts
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// --- tiny UI helpers ---
function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

type Preset = 7 | 14 | 30;

export default function StepsPage() {
  // ---------------- state ----------------
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [series, setSeries] = useState<Array<{ date: string; steps: number }>>(
    []
  );
  const [totalSteps, setTotalSteps] = useState(0);
  const [dailyAverage, setDailyAverage] = useState(0);

  // ---------------- access token ----------------
  const accessToken =
    tokens.getAccess?.("withings") || tokens.getAccess?.("fitbit") || "";

  // ---------------- date range ----------------
  const { startYmd, endYmd, label } = useMemo(() => {
    const end = new Date(); // today
    const start = new Date();
    // include the last 'preset' days (like Weights page style)
    // e.g., preset=14 -> last 14 days inclusive
    start.setDate(end.getDate() - (preset - 1));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return {
      startYmd: fmt(start),
      endYmd: fmt(end),
      label: `Withings · ${fmt(start)} → ${fmt(end)}`,
    };
  }, [preset]);

  // ---------------- loader ----------------
  async function loadSteps() {
    if (!accessToken) {
      setError("Missing access token");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await withingsStepsRange(accessToken, startYmd, endYmd);
      const s = rows.map((r) => ({
        date: r.date,
        steps: typeof r.steps === "number" ? r.steps : 0,
      }));

      const totals = s.reduce(
        (acc, x) => {
          acc.sum += x.steps || 0;
          if ((x.steps ?? 0) > 0) acc.daysWithData += 1;
          return acc;
        },
        { sum: 0, daysWithData: 0 }
      );

      setSeries(s);
      setTotalSteps(totals.sum);
      setDailyAverage(
        totals.daysWithData > 0
          ? Math.round(totals.sum / totals.daysWithData)
          : 0
      );
    } catch (e: any) {
      setError(e?.message || "Failed to load steps");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, startYmd, endYmd]);

  // ---------------- UI ----------------
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
        {/* Top bar with Back — mirrors Weights.tsx */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              aria-label="Back to dashboard"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 hover:bg-zinc-900 transition"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Steps Analytics
              </h2>
              <p className="text-zinc-400">{label}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
              value={preset}
              onChange={(e) => setPreset(Number(e.target.value) as Preset)}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>

            <button
              onClick={loadSteps}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Stats grid — same cards as Weights.tsx */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard title="Total steps" value={totalSteps.toLocaleString()} />
          <StatCard
            title="Daily average"
            value={dailyAverage.toLocaleString()}
          />
        </div>

        {/* Chart — same visual language as Weights.tsx */}
        <div className="h-80 w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-zinc-400">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span>Loading data...</span>
            </div>
          ) : !series.length ? (
            <div className="grid place-items-center h-full text-zinc-400">
              No data for this range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" stroke="#a1a1aa" />
                <YAxis stroke="#a1a1aa" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: "#fafafa" }}
                  formatter={(value: any) => [
                    `${
                      typeof value === "number" ? value.toLocaleString() : value
                    } steps`,
                    "Steps",
                  ]}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="steps"
                  stroke="#3b82f6"
                  fill="url(#stepsGradient)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <defs>
                  <linearGradient
                    id="stepsGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Series table — same table style as Weights.tsx */}
        {series.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Steps
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                {[...series]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((row) => (
                    <tr key={row.date} className="hover:bg-zinc-900/40">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                        {row.steps.toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
