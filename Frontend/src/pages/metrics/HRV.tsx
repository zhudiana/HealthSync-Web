import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { metrics, fitbitHRVHistoryCached } from "@/lib/api";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// ---- helpers ----
function fmt(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toFixed(digits);
}

// Local YYYY-MM-DD (no UTC conversion)
function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Preset = 7 | 14 | 30;

export default function HRVPage() {
  const { getAccessToken } = useAuth();
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latest, setLatest] = useState<number | null>(null);
  const [items, setItems] = useState<{ date: string; rmssd_ms: number }[]>([]);

  // Date range in LOCAL time
  const { startYmd, endYmd, label } = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (preset - 1));
    return {
      startYmd: ymdLocal(start),
      endYmd: ymdLocal(end),
      label: `Last ${preset} days · ${ymdLocal(start)} → ${ymdLocal(end)}`,
    };
  }, [preset]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      // --- Try cache first ---
      let data = null;
      try {
        const cached = await fitbitHRVHistoryCached(token, startYmd, endYmd);
        if (cached?.items) {
          data = cached;
          console.log("Using cached Fitbit HRV data");
        }
      } catch (cacheErr) {
        // Cache miss or error, fall back to live API
        console.log("Cache miss, fetching from live API:", cacheErr);
        data = await metrics.hrv(token, startYmd, endYmd);
      }

      if (!data?.items?.length) {
        setItems([]);
        setLatest(null);
        return;
      }

      // Filter out entries with null rmssd_ms
      const filtered = data.items.filter(
        (it) => it.date && it.rmssd_ms != null
      );

      // Sort by date (newest first for latest)
      const sorted = filtered.sort((a, b) => b.date.localeCompare(a.date));

      setItems(filtered.sort((a, b) => a.date.localeCompare(b.date)));
      setLatest(sorted.length > 0 ? sorted[0].rmssd_ms : null);

      // Persist each HRV reading in background (only if not from cache)
      if (!(data as any).fromCache) {
        filtered.forEach((it) => {
          metrics.hrvToday(token, it.date).catch((e) => {
            console.warn(`Failed to persist HRV for ${it.date}:`, e);
          });
        });
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load HRV data");
      setItems([]);
      setLatest(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, startYmd, endYmd]);

  const stats = useMemo(() => {
    if (!items.length) return null;
    const values = items.map((it) => it.rmssd_ms).filter((v) => v != null);
    if (!values.length) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    return { avg, max, min };
  }, [items]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
        {/* Top bar with Back */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              aria-label="Back to dashboard"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 hover:bg-zinc-900 transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Heart Rate Variability
              </h2>
              <p className="text-zinc-400">Fitbit · {label}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={preset}
              onChange={(e) => setPreset(Number(e.target.value) as Preset)}
              className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
              aria-label="Select date range"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>

            <button
              onClick={load}
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

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-400">Latest HRV</div>
            <div className="text-2xl font-semibold">
              {latest != null ? `${fmt(latest, 0)} ms` : "–"}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Root Mean Square of Successive Differences
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-400">Daily average</div>
            <div className="text-2xl font-semibold">
              {stats ? `${fmt(stats.avg, 0)} ms` : "–"}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {items.length} days of data
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-400">Range</div>
            <div className="text-2xl font-semibold">
              {stats ? `${fmt(stats.min, 0)} - ${fmt(stats.max, 0)} ms` : "–"}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Min - Max values</div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-80 w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-zinc-400">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span>Loading data...</span>
            </div>
          ) : !items.length ? (
            <div className="grid place-items-center h-full text-zinc-400">
              No data for this range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={items}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" stroke="#a1a1aa" />
                <YAxis
                  stroke="#a1a1aa"
                  label={{
                    value: "RMSSD (ms)",
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: "#fafafa" }}
                  formatter={(value: any) => [
                    `${
                      typeof value === "number" ? value.toFixed(0) : value
                    } ms`,
                    "HRV (RMSSD)",
                  ]}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="rmssd_ms"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Table */}
        {!error && items.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    HRV (RMSSD)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                {items
                  .slice()
                  .reverse()
                  .map((row) => (
                    <tr key={row.date} className="hover:bg-zinc-900/40">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100 font-medium">
                        {fmt(row.rmssd_ms, 0)} ms
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
