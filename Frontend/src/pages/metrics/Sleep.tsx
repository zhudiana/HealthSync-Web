import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw, ChevronDown } from "lucide-react";
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
  const [dropdownOpen, setDropdownOpen] = useState(false);

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
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-slate-800 transition"
            >
              <ChevronLeft className="w-5 h-5 text-slate-400" />
            </Link>
            <div>
              <h1 className="text-4xl font-bold text-white">Sleep</h1>
              <p className="text-sm text-slate-400 mt-1">{label}</p>
            </div>
          </div>

          {/* Date Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition border border-slate-700"
            >
              Last {preset} days
              <ChevronDown className="w-4 h-4" />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-40 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10">
                {[7, 14, 30].map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setPreset(p as Preset);
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm transition ${
                      preset === p
                        ? "bg-blue-600 text-white"
                        : "text-slate-300 hover:bg-slate-700"
                    } ${p === 7 ? "rounded-t-lg" : ""} ${
                      p === 30 ? "rounded-b-lg" : ""
                    }`}
                  >
                    Last {p} days
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <p className="mt-2 text-slate-400">Loading sleep data...</p>
          </div>
        )}

        {/* Stats Cards */}
        {!loading && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {/* Latest */}
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <p className="text-sm text-slate-400 mb-2">Latest</p>
                <p className="text-4xl font-bold text-white">
                  {fmt(latest, 1)}
                </p>
                <p className="text-xs text-slate-500 mt-2">hours</p>
              </div>

              {/* Average */}
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <p className="text-sm text-slate-400 mb-2">Average</p>
                <p className="text-4xl font-bold text-white">{fmt(avg, 1)}</p>
                <p className="text-xs text-slate-500 mt-2">hours</p>
              </div>

              {/* Range */}
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <p className="text-sm text-slate-400 mb-2">Range</p>
                <p className="text-4xl font-bold text-white">
                  {fmt(minMax.min, 1)} – {fmt(minMax.max, 1)}
                </p>
                <p className="text-xs text-slate-500 mt-2">hours</p>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  Sleep Over Time
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="date"
                      stroke="#94a3b8"
                      style={{ fontSize: "12px" }}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      style={{ fontSize: "12px" }}
                      label={{
                        value: "Hours",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#94a3b8",
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #475569",
                        borderRadius: "6px",
                        color: "#e2e8f0",
                      }}
                      formatter={(value: any) => [fmt(value, 1), "hours"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="hoursAsleep"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "#3b82f6" }}
                      name="Total Sleep"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Data Table */}
            {items.length > 0 && (
              <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-900 border-b border-slate-700">
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                          Total Sleep
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                          Main Sleep
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {items.map((it, i) => (
                        <tr
                          key={i}
                          className="hover:bg-slate-700/50 transition"
                        >
                          <td className="px-6 py-3 text-sm font-medium text-slate-200">
                            {it.date}
                          </td>
                          <td className="px-6 py-3 text-sm text-slate-400">
                            {fmt(it.hoursAsleep, 2)} h
                          </td>
                          <td className="px-6 py-3 text-sm text-slate-400">
                            {fmt(it.hoursAsleepMain, 2)} h
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
