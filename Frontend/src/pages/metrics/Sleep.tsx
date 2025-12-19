import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { metrics } from "@/lib/api";
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

export default function SleepPage() {
  const { getAccessToken } = useAuth();
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latest, setLatest] = useState<number | null>(null);
  const [items, setItems] = useState<
    { date: string; hoursAsleep: number | null; hoursAsleepMain: number | null }[]
  >([]);

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

      // Fetch sleep data for date range
      const data = await metrics.sleepHistory(token, startYmd, endYmd);
      if (!data?.items?.length) {
        setItems([]);
        setLatest(null);
        return;
      }

      // Filter out entries with null hoursAsleep
      const filtered = data.items.filter((it) => it.hoursAsleep != null);

      // Sort by date (newest first for latest)
      const sorted = filtered.sort((a, b) => b.date.localeCompare(a.date));

      setItems(filtered.sort((a, b) => a.date.localeCompare(b.date)));
      setLatest(sorted.length > 0 ? sorted[0].hoursAsleep : null);

      // Persist each sleep reading in background (silent fail)
      filtered.forEach((it) => {
        try {
          metrics.sleepToday(token, it.date);
        } catch (e) {
          console.warn(`Failed to persist sleep for ${it.date}:`, e);
        }
      });
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
    const values = items.map((it) => it.hoursAsleep).filter((v) => v != null) as number[];
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/50 transition"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Sleep</h1>
            <p className="text-sm text-slate-600">{label}</p>
          </div>
        </div>

        {/* Preset Buttons */}
        <div className="flex gap-2 mb-6">
          {[7, 14, 30].map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p as Preset)}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                preset === p
                  ? "bg-blue-500 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {p}d
            </button>
          ))}
          <button
            onClick={() => load()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <p className="mt-2 text-slate-600">Loading sleep data...</p>
          </div>
        )}

        {/* Stats Cards */}
        {!loading && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {/* Latest */}
              <div className="bg-white rounded-lg p-6 shadow-sm">
                <p className="text-sm text-slate-600 mb-2">Latest</p>
                <p className="text-3xl font-bold text-slate-900">
                  {fmt(latest, 1)}
                </p>
                <p className="text-xs text-slate-500 mt-2">hours</p>
              </div>

              {/* Average */}
              <div className="bg-white rounded-lg p-6 shadow-sm">
                <p className="text-sm text-slate-600 mb-2">Average</p>
                <p className="text-3xl font-bold text-slate-900">
                  {fmt(avg, 1)}
                </p>
                <p className="text-xs text-slate-500 mt-2">hours</p>
              </div>

              {/* Range */}
              <div className="bg-white rounded-lg p-6 shadow-sm">
                <p className="text-sm text-slate-600 mb-2">Range</p>
                <p className="text-3xl font-bold text-slate-900">
                  {fmt(minMax.min, 1)} – {fmt(minMax.max, 1)}
                </p>
                <p className="text-xs text-slate-500 mt-2">hours</p>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="bg-white rounded-lg p-6 shadow-sm mb-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">
                  Sleep Over Time
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      stroke="#999"
                      style={{ fontSize: "12px" }}
                    />
                    <YAxis
                      stroke="#999"
                      style={{ fontSize: "12px" }}
                      label={{ value: "Hours", angle: -90, position: "insideLeft" }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                      }}
                      formatter={(value: any) => [fmt(value, 1), "hours"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="hoursAsleep"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      name="Total Sleep"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Data Table */}
            {items.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                          Total Sleep
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">
                          Main Sleep
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {items.map((it, i) => (
                        <tr
                          key={i}
                          className="hover:bg-slate-50 transition"
                        >
                          <td className="px-6 py-3 text-sm font-medium text-slate-900">
                            {it.date}
                          </td>
                          <td className="px-6 py-3 text-sm text-slate-700">
                            {fmt(it.hoursAsleep, 2)} h
                          </td>
                          <td className="px-6 py-3 text-sm text-slate-700">
                            {fmt(it.hoursAsleepMain, 2)} h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Info Section */}
            <div className="mt-6 bg-blue-50 rounded-lg p-6 border border-blue-200">
              <h3 className="font-semibold text-blue-900 mb-2">About Sleep</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>
                  <strong>Total Sleep:</strong> Total minutes/hours asleep including all sleep sessions
                </li>
                <li>
                  <strong>Main Sleep:</strong> The primary/main sleep session duration (usually nighttime sleep)
                </li>
                <li>
                  <strong>Good Sleep Goal:</strong> Most adults need 7-9 hours of quality sleep per night
                </li>
                <li>
                  <strong>Sleep Quality:</strong> Pay attention to consistency and main sleep duration for best recovery
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
