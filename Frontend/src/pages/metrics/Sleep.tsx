import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { metrics, fitbitSleepHistoryCached } from "@/lib/api";
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
function fmt(n: number | null | undefined, digits = 1) {
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

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {subtitle && <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>}
    </div>
  );
}

type Preset = 7 | 14 | 30;

export default function SleepPage() {
  const { getAccessToken } = useAuth();
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latest, setLatest] = useState<number | null>(null);
  const [items, setItems] = useState<
    {
      date: string;
      hoursAsleep: number | null;
      hoursAsleepMain: number | null;
    }[]
  >([]);

  // Date range in LOCAL time
  const { startYmd, endYmd, label } = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (preset - 1));
    return {
      startYmd: ymdLocal(start),
      endYmd: ymdLocal(end),
      label: `${ymdLocal(start)} → ${ymdLocal(end)}`,
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
        const cached = await fitbitSleepHistoryCached(token, startYmd, endYmd);
        if (cached?.items) {
          data = cached;
          console.log("Using cached Fitbit sleep data");
        }
      } catch (cacheErr) {
        // Cache miss or error, fall back to live API
        console.log("Cache miss, fetching from live API:", cacheErr);
        data = await metrics.sleepHistory(token, startYmd, endYmd);
      }

      if (!data?.items?.length) {
        setItems([]);
        setLatest(null);
        return;
      }

      // Convert cached format to expected format
      const converted = data.items.map((it: any) => ({
        date: it.date,
        hoursAsleep: it.hours !== undefined ? it.hours : it.hoursAsleep,
        hoursAsleepMain: it.hoursAsleepMain || null,
      }));

      // Filter out entries with null hoursAsleep
      const filtered = converted.filter((it) => it.hoursAsleep != null);

      // Sort by date (newest first for latest)
      const sorted = filtered.sort((a, b) => b.date.localeCompare(a.date));

      setItems(filtered.sort((a, b) => a.date.localeCompare(b.date)));
      setLatest(sorted.length > 0 ? sorted[0].hoursAsleep : null);

      // Persist each sleep reading in background (only if not from cache)
      if (!(data as any).fromCache) {
        filtered.forEach((it) => {
          metrics.sleepToday(token, it.date).catch((e) => {
            console.warn(`Failed to persist sleep for ${it.date}:`, e);
          });
        });
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load sleep data");
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

  const avg = useMemo(() => {
    if (items.length === 0) return null;
    const sum = items.reduce((acc, it) => acc + (it.hoursAsleep || 0), 0);
    return sum / items.length;
  }, [items]);

  const minMax = useMemo(() => {
    if (items.length === 0) return { min: null, max: null };
    const values = items
      .map((it) => it.hoursAsleep)
      .filter((v) => v != null) as number[];
    if (values.length === 0) return { min: null, max: null };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [items]);

  const chartData = useMemo(() => {
    return items.map((it) => ({
      date: it.date,
      hoursAsleep: it.hoursAsleep,
      hoursAsleepMain: it.hoursAsleepMain,
    }));
  }, [items]);

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center rounded-lg hover:bg-zinc-900 transition p-2"
              >
                <ArrowLeft className="w-4 h-4 text-zinc-400" />
              </Link>
              <h1 className="text-2xl font-semibold text-zinc-100">Sleep</h1>
            </div>
            <p className="text-xs text-zinc-500 mt-2">{label}</p>
          </div>

          {/* Date Filter */}
          <select
            value={preset}
            onChange={(e) => setPreset(Number(e.target.value) as Preset)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:border-zinc-700 transition cursor-pointer"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-400" />
            <p className="mt-2 text-sm text-zinc-500">Loading sleep data...</p>
          </div>
        )}

        {/* Stats Cards */}
        {!loading && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard
                title="Latest"
                value={`${fmt(latest, 1)} h`}
                subtitle="hours"
              />
              <StatCard
                title="Average"
                value={`${fmt(avg, 1)} h`}
                subtitle="hours"
              />
              <StatCard
                title="Range"
                value={`${fmt(minMax.min, 1)} – ${fmt(minMax.max, 1)} h`}
                subtitle="hours"
              />
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-6">
                <h2 className="text-sm font-medium text-zinc-100 mb-4">
                  Sleep Over Time
                </h2>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                    <XAxis
                      dataKey="date"
                      stroke="#71717a"
                      style={{ fontSize: "11px" }}
                    />
                    <YAxis
                      stroke="#71717a"
                      style={{ fontSize: "11px" }}
                      label={{
                        value: "Hours",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#71717a",
                        fontSize: 11,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #3f3f46",
                        borderRadius: "6px",
                        color: "#e4e4e7",
                      }}
                      formatter={(value: any) => [fmt(value, 1), "hours"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="hoursAsleep"
                      stroke="#a1a1aa"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#a1a1aa" }}
                      name="Total Sleep"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Data Table */}
            {items.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/80">
                        <th className="px-4 py-3 text-left font-medium text-zinc-400">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-zinc-400">
                          Total Sleep
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-zinc-400">
                          Main Sleep
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {items.map((it, i) => (
                        <tr key={i} className="hover:bg-zinc-800/50 transition">
                          <td className="px-4 py-3 font-medium text-zinc-300">
                            {it.date}
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            {fmt(it.hoursAsleep, 1)} h
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            {fmt(it.hoursAsleepMain, 1)} h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
