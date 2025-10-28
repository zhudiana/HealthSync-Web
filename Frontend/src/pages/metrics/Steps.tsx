// src/pages/metrics/Steps.tsx
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { withingsStepsRange } from "@/lib/api";
import { tokens } from "@/lib/storage";

// 👉 add recharts
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
    <div className="rounded-2xl bg-neutral-900/60 px-5 py-6 shadow-lg ring-1 ring-black/5">
      <div className="text-neutral-400 text-sm">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-neutral-50">{value}</div>
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
    start.setDate(end.getDate() - preset); // include one more day for full range
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return {
      startYmd: fmt(start),
      endYmd: fmt(end),
      label: `Withings · ${fmt(start)} ⇒ ${fmt(end)}`,
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
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* header */}
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center rounded-xl bg-neutral-900/60 px-3 py-2 text-neutral-200 ring-1 ring-black/5 hover:bg-neutral-800"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
        <h1 className="ml-2 text-xl font-semibold text-neutral-50">
          Steps Analytics
        </h1>
        <div className="ml-3 text-sm text-neutral-400">{label}</div>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="rounded-xl bg-neutral-900/60 px-3 py-2 text-neutral-200 ring-1 ring-black/5"
            value={preset}
            onChange={(e) => setPreset(Number(e.target.value) as Preset)}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={loadSteps}
            className="inline-flex items-center rounded-xl bg-neutral-900/60 px-3 py-2 text-neutral-200 ring-1 ring-black/5 hover:bg-neutral-800 disabled:opacity-50"
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="Total steps" value={totalSteps} />
        <StatCard title="Daily average" value={dailyAverage} />
      </div>

      {/* chart */}
      <div className="mt-6 rounded-2xl bg-neutral-900/60 p-4 ring-1 ring-black/5">
        <div className="mb-2 text-sm font-medium text-neutral-300">
          Daily steps
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="gSteps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopOpacity={0.35} />
                  <stop offset="95%" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#a3a3a3", fontSize: 12 }}
                tickMargin={8}
              />
              <YAxis
                tick={{ fill: "#a3a3a3", fontSize: 12 }}
                tickMargin={6}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid rgba(0,0,0,0.3)",
                  borderRadius: "0.75rem",
                }}
                labelStyle={{ color: "#e5e5e5" }}
                itemStyle={{ color: "#e5e5e5" }}
              />
              <Area
                type="monotone"
                dataKey="steps"
                strokeOpacity={0.9}
                fillOpacity={1}
                fill="url(#gSteps)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* error */}
      {error && (
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
          Error: {error}
        </div>
      )}

      {/* simple series list (optional) */}
      <div className="mt-6 rounded-2xl bg-neutral-900/60 p-4 ring-1 ring-black/5">
        <div className="mb-2 text-sm font-medium text-neutral-300">
          Daily series
        </div>
        <div className="max-h-72 overflow-auto text-sm text-neutral-400">
          {series.length === 0 ? (
            <div className="py-6 text-neutral-500">
              {loading ? "Loading…" : "No data"}
            </div>
          ) : (
            <table className="w-full table-fixed">
              <thead className="text-neutral-500">
                <tr>
                  <th className="w-40 text-left font-normal">Date</th>
                  <th className="text-left font-normal">Steps</th>
                </tr>
              </thead>
              <tbody>
                {[...series]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((r) => (
                    <tr key={r.date} className="border-t border-neutral-800">
                      <td className="py-2">{r.date}</td>
                      <td className="py-2">{r.steps}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
