// src/pages/metrics/Calories.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Flame } from "lucide-react";

import { metrics } from "@/lib/api";
import { tokens } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";

// recharts
import {
  ResponsiveContainer,
  BarChart,
  Bar,
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

type Preset = 7 | 14 | 30;

interface CalorieEntry {
  date: string;
  calories_out: number | null;
  activity_calories: number | null;
  bmr_calories: number | null;
}

export default function CaloriesPage() {
  // ---------------- state ----------------
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [series, setSeries] = useState<
    Array<{
      date: string;
      caloriesOut: number;
      activityCalories: number;
      bmrCalories: number;
    }>
  >([]);

  const [totalCaloriesOut, setTotalCaloriesOut] = useState(0);
  const [avgCaloriesOut, setAvgCaloriesOut] = useState(0);
  const [totalActivityCalories, setTotalActivityCalories] = useState(0);

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
  async function loadCalories() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const data = await metrics.caloriesHistory(token, startYmd, endYmd);
      if (!data?.items?.length) {
        setSeries([]);
        setTotalCaloriesOut(0);
        setAvgCaloriesOut(0);
        setTotalActivityCalories(0);
        return;
      }

      // Filter out entries with null calories_out
      const filtered = data.items.filter(
        (it) => it.calories_out != null && it.calories_out > 0
      );

      // Convert to chart format
      const points = filtered.map((item) => ({
        date: item.date,
        caloriesOut: item.calories_out || 0,
        activityCalories: item.activity_calories || 0,
        bmrCalories: item.bmr_calories || 0,
      }));

      // Sort by date
      points.sort((a, b) => a.date.localeCompare(b.date));

      // Calculate statistics
      const totals = points.reduce(
        (acc, x) => {
          acc.totalOut += x.caloriesOut || 0;
          acc.totalActivity += x.activityCalories || 0;
          acc.count += 1;
          return acc;
        },
        { totalOut: 0, totalActivity: 0, count: 0 }
      );

      setSeries(points);
      setTotalCaloriesOut(Math.round(totals.totalOut));
      setAvgCaloriesOut(
        totals.count > 0 ? Math.round(totals.totalOut / totals.count) : 0
      );
      setTotalActivityCalories(Math.round(totals.totalActivity));

      // Persist each reading in background (silent fail)
      filtered.forEach((it) => {
        try {
          metrics.calories(token, it.date);
        } catch (e) {
          console.warn(`Failed to persist calories for ${it.date}:`, e);
        }
      });
    } catch (e: any) {
      setError(e?.message || "Failed to load calories");
      setSeries([]);
      setTotalCaloriesOut(0);
      setAvgCaloriesOut(0);
      setTotalActivityCalories(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCalories();
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
                Calories Analytics
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
              onClick={loadCalories}
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
          <StatCard
            title="Total Calories Burned"
            value={totalCaloriesOut.toLocaleString()}
            subtitle="kcal"
          />
          <StatCard
            title="Daily Average"
            value={avgCaloriesOut.toLocaleString()}
            subtitle="kcal per day"
          />
          <StatCard
            title="Total Activity Calories"
            value={totalActivityCalories.toLocaleString()}
            subtitle="kcal from exercise"
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
              <BarChart data={series}>
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
                  formatter={(value: any) => {
                    if (typeof value === "number") {
                      return [`${value.toLocaleString()} kcal`, ""];
                    }
                    return value;
                  }}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Legend />
                <Bar
                  dataKey="caloriesOut"
                  name="Calories Burned"
                  fill="#f97316"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="activityCalories"
                  name="Activity Calories"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
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
                    Calories Burned
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Activity Calories
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    BMR Calories
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
                        <Flame className="h-4 w-4 text-orange-500" />
                        {row.caloriesOut.toLocaleString()} kcal
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                      {row.activityCalories.toLocaleString()} kcal
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                      {row.bmrCalories.toLocaleString()} kcal
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
