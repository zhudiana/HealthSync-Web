// src/pages/metrics/BreathingRate.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Wind } from "lucide-react";
import { metrics } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// recharts
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

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

// --- local YYYY-MM-DD (no UTC conversion) ---
function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmt(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toFixed(digits);
}

type Preset = 7 | 14 | 30;

interface BreathingRateEntry {
  date: string;
  full_day_avg: number | null;
  deep_sleep_avg: number | null;
  light_sleep_avg: number | null;
  rem_sleep_avg: number | null;
}

export default function BreathingRatePage() {
  // ---------------- state ----------------
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [series, setSeries] = useState<
    Array<{
      date: string;
      full_day_avg: number;
      deep_sleep_avg: number;
      light_sleep_avg: number;
      rem_sleep_avg: number;
    }>
  >([]);

  const [stats, setStats] = useState<{
    latestFull: number | null;
    avgFull: number | null;
    latestDeep: number | null;
    avgDeep: number | null;
  }>({
    latestFull: null,
    avgFull: null,
    latestDeep: null,
    avgDeep: null,
  });

  // ---------------- access token ----------------
  const { getAccessToken } = useAuth();

  // ---------------- date range ----------------
  const { startYmd, endYmd, label } = useMemo(() => {
    const end = new Date(); // local today
    const start = new Date();
    start.setDate(end.getDate() - (preset - 1));
    return {
      startYmd: ymdLocal(start),
      endYmd: ymdLocal(end),
      label: `${ymdLocal(start)} → ${ymdLocal(end)}`,
    };
  }, [preset]);

  // ---------------- loader ----------------
  async function loadBreathingRate() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const data = await metrics.respiratoryRate(token, startYmd, endYmd);
      if (!data?.items?.length) {
        setSeries([]);
        setStats({
          latestFull: null,
          avgFull: null,
          latestDeep: null,
          avgDeep: null,
        });
        return;
      }

      // Filter out entries with null full_day_avg
      const filtered = data.items.filter(
        (it) => it.full_day_avg != null && typeof it.full_day_avg === "number"
      ) as Array<{
        date: string;
        full_day_avg: number;
        deep_sleep_avg: number | null;
        light_sleep_avg: number | null;
        rem_sleep_avg: number | null;
      }>;

      // Convert to chart format with defaults
      const points = filtered.map((item) => ({
        date: item.date,
        full_day_avg: item.full_day_avg,
        deep_sleep_avg: item.deep_sleep_avg || 0,
        light_sleep_avg: item.light_sleep_avg || 0,
        rem_sleep_avg: item.rem_sleep_avg || 0,
      }));

      // Sort by date
      points.sort((a, b) => a.date.localeCompare(b.date));

      // Calculate statistics
      const fullDayAvgs = filtered.map((it) => it.full_day_avg);
      const deepAvgs = filtered
        .map((it) => it.deep_sleep_avg)
        .filter((v) => v != null) as number[];

      const avgFull =
        fullDayAvgs.length > 0
          ? fullDayAvgs.reduce((a, b) => a + b) / fullDayAvgs.length
          : null;
      const avgDeep =
        deepAvgs.length > 0
          ? deepAvgs.reduce((a, b) => a + b) / deepAvgs.length
          : null;

      const latestFull =
        filtered.length > 0 ? filtered[filtered.length - 1].full_day_avg : null;
      const latestDeep =
        filtered.length > 0
          ? filtered[filtered.length - 1].deep_sleep_avg
          : null;

      setSeries(points);
      setStats({
        latestFull,
        avgFull,
        latestDeep,
        avgDeep,
      });

      // Persist each reading in background (silent fail)
      filtered.forEach((it) => {
        metrics.respiratoryRateToday(token, it.date).catch((e) => {
          console.warn(`Failed to persist respiratory rate for ${it.date}:`, e);
        });
      });
    } catch (e: any) {
      setError(e?.message || "Failed to load breathing rate data");
      setSeries([]);
      setStats({
        latestFull: null,
        avgFull: null,
        latestDeep: null,
        avgDeep: null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBreathingRate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, startYmd, endYmd]);

  // ---------------- UI ----------------
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
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Breathing Rate
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
              onClick={loadBreathingRate}
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
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            title="Latest Full Day Avg"
            value={fmt(stats.latestFull, 1)}
            subtitle="breaths/min"
          />
          <StatCard
            title="Average (Full Day)"
            value={fmt(stats.avgFull, 1)}
            subtitle="breaths/min"
          />
        </div>

        {/* Chart */}
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
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" stroke="#a1a1aa" />
                <YAxis
                  stroke="#a1a1aa"
                  label={{
                    value: "Breaths/Min",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#a1a1aa",
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: "#fafafa" }}
                  formatter={(value: any) => {
                    if (typeof value === "number") {
                      return [`${value.toFixed(1)} breaths/min`, ""];
                    }
                    return value;
                  }}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="full_day_avg"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#3b82f6" }}
                  name="Full Day Avg"
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="deep_sleep_avg"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#8b5cf6" }}
                  name="Deep Sleep Avg"
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="light_sleep_avg"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#06b6d4" }}
                  name="Light Sleep Avg"
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Series table */}
        {series.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Full Day Avg
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Deep Sleep Avg
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Light Sleep Avg
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    REM Sleep Avg
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                {series.map((row) => (
                  <tr key={row.date} className="hover:bg-zinc-900/40">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                      {row.date}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                      <div className="flex items-center gap-2">
                        <Wind className="h-4 w-4 text-blue-500" />
                        {fmt(row.full_day_avg, 1)} breaths/min
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                      {fmt(row.deep_sleep_avg, 1)} breaths/min
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                      {fmt(row.light_sleep_avg, 1)} breaths/min
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                      {fmt(row.rem_sleep_avg, 1)} breaths/min
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Info Section */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
          <h3 className="font-semibold text-zinc-200 mb-3">
            About Breathing Rate
          </h3>
          <ul className="text-sm text-zinc-400 space-y-2">
            <li>
              <strong>Full Day Average:</strong> Your average breathing rate
              throughout the entire day, measured in breaths per minute.
            </li>
            <li>
              <strong>Sleep Stage Averages:</strong> Breathing rates vary during
              different sleep stages (deep sleep, light sleep, REM sleep).
            </li>
            <li>
              <strong>Normal Range:</strong> A typical resting breathing rate
              for adults is 12-20 breaths per minute.
            </li>
            <li>
              <strong>Health Indicator:</strong> Changes in breathing rate can
              indicate stress, fitness level, and overall respiratory health.
            </li>
            <li>
              <strong>Sleep Insight:</strong> Different sleep stages naturally
              have different breathing patterns - REM sleep typically has more
              variable breathing rates.
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
