import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { RefreshCw, ChevronLeft, Scale, TrendingUp, Ruler } from "lucide-react";
import Header from "@/components/Header";
import { tokens } from "@/lib/storage";
import {
  withingsWeightLatest,
  withingsWeightHistory,
  withingsWeightHistoryCached,
} from "@/lib/api";

// --------------------- helpers ---------------------
const KG_IN_LB = 2.2046226218;
const kgToLb = (kg: number) => kg * KG_IN_LB;

function fmt(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toFixed(digits);
}

function formatDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// --------------------- types ---------------------
interface WeightPoint {
  date: string; // YYYY-MM-DD
  weight_kg: number; // in kg
  bmi?: number | null;
  fat_pct?: number | null;
}

// --------------------- main ---------------------
export default function Weights() {
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<WeightPoint[]>([]);
  const [latest, setLatest] = useState<WeightPoint | null>(null);

  // compute date range
  const { dateFrom, dateTo } = useMemo(() => {
    const to = new Date();
    const from = new Date();
    if (range === "7d") from.setDate(to.getDate() - 6);
    if (range === "30d") from.setDate(to.getDate() - 29);
    if (range === "90d") from.setDate(to.getDate() - 89);
    return {
      dateFrom: formatDate(from),
      dateTo: formatDate(to),
    };
  }, [range]);

  // fetch data
  async function load() {
    setLoading(true);
    setError(null);
    // inside load()
    try {
      const accessToken = tokens.getAccess("withings");
      if (!accessToken)
        throw new Error("No Withings session found. Please connect Withings.");

      // --- try cache first ---
      const cached = await withingsWeightHistoryCached(
        accessToken,
        dateFrom,
        dateTo
      );

      // choose data source: cached (if present) else live
      const hist =
        cached && Array.isArray(cached.items) && cached.items.length > 0
          ? cached
          : await withingsWeightHistory(accessToken, dateFrom, dateTo);

      const daily: WeightPoint[] = (hist.items || [])
        .map((it) => {
          if (!it.ts || it.weight_kg == null) return null;
          return {
            date: new Date(it.ts * 1000).toISOString().slice(0, 10),
            weight_kg: it.weight_kg,
          };
        })
        .filter((x): x is WeightPoint => x !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      setSeries(daily);

      // latest datapoint as before
      const latestRow = await withingsWeightLatest(accessToken);
      if (latestRow && latestRow.value != null && latestRow.latest_date) {
        setLatest({
          date: latestRow.latest_date,
          weight_kg: latestRow.value,
          bmi: null,
          fat_pct: null,
        });
      } else {
        setLatest(null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load weight data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // derive UI values
  const displaySeries = useMemo(() => {
    return series.map((p) => ({
      ...p,
      value: unit === "kg" ? p.weight_kg : kgToLb(p.weight_kg),
    }));
  }, [series, unit]);

  const latestDisplay = useMemo(() => {
    if (!latest) return null;
    const w = unit === "kg" ? latest.weight_kg : kgToLb(latest.weight_kg);
    return { ...latest, value: w };
  }, [latest, unit]);

  const prevOfLatest = useMemo(() => {
    if (!series?.length || !latest) return null;
    const prev = series
      .filter((p) => p.date < latest.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) return null;
    const prevVal = unit === "kg" ? prev.weight_kg : kgToLb(prev.weight_kg);
    return { ...prev, value: prevVal };
  }, [series, latest, unit]);

  const delta = useMemo(() => {
    if (!latestDisplay || !prevOfLatest) return null;
    const d = latestDisplay.value - prevOfLatest.value;
    return d;
  }, [latestDisplay, prevOfLatest]);

  // --------------------- UI ---------------------
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
                Weight Analytics
              </h2>
              <p className="text-zinc-400">
                Withings · {dateFrom} → {dateTo}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as "7d" | "30d" | "90d")}
              className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
              aria-label="Select date range"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>

            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "kg" | "lb")}
              className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
              aria-label="Select weight unit"
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
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

        {/* status */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-400">Latest weight</div>
            <div className="text-2xl font-semibold">
              {latestDisplay ? (
                <>
                  {fmt(latestDisplay.value, 1)} {unit}
                </>
              ) : (
                "–"
              )}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {latestDisplay?.date ? (
                <>as of {formatDate(latestDisplay.date)}</>
              ) : (
                <>no recent record</>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-400">Change vs prev</div>
            <div
              className={`text-2xl font-semibold ${
                delta && delta > 0
                  ? "text-red-400"
                  : delta && delta < 0
                  ? "text-emerald-400"
                  : ""
              }`}
            >
              {delta === null || delta === undefined
                ? "–"
                : `${fmt(delta, 1)} ${unit}`}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {prevOfLatest?.date ? (
                <>since {formatDate(prevOfLatest.date)}</>
              ) : (
                <>no previous record</>
              )}
            </div>
          </div>
        </div>

        {/* Chart */}
        {error ? (
          <div className="p-4 border border-red-500/40 text-red-400 rounded-lg">
            Error: {error}
          </div>
        ) : (
          <div className="h-80 w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-zinc-400">
                <RefreshCw className="h-6 w-6 animate-spin" />
                <span>Loading data...</span>
              </div>
            ) : !displaySeries.length ? (
              <div className="grid place-items-center h-full text-zinc-400">
                No data for this range.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displaySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" stroke="#a1a1aa" />
                  <YAxis stroke="#a1a1aa" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: "#fafafa" }}
                    formatter={(value: any) => [
                      `${
                        typeof value === "number" ? value.toFixed(1) : value
                      } ${unit}`,
                      "Weight",
                    ]}
                    labelFormatter={(l) => `Date: ${l}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#22c55e"
                    fill="url(#wGradient)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <defs>
                    <linearGradient id="wGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop
                        offset="95%"
                        stopColor="#22c55e"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Table */}
        {!error && displaySeries.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Weight ({unit})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                {displaySeries
                  .slice()
                  .reverse()
                  .map((row) => (
                    <tr key={row.date} className="hover:bg-zinc-900/40">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                        {formatDate(row.date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                        {fmt(row.value, 1)} {unit}
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

// --------------------- charts ---------------------
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function WeightSparkline({
  data,
  unit,
  loading,
}: {
  data: Array<WeightPoint & { value: number }>;
  unit: "kg" | "lb";
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-neutral-400">
        Loading chart…
      </div>
    );
  }
  if (!data?.length) {
    return (
      <div className="flex h-64 items-center justify-center text-neutral-400">
        No points to show
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
        >
          <defs>
            <linearGradient id="wGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(120,120,120,0.2)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => d.slice(5)}
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            axisLine={{ stroke: "#404040" }}
            tickLine={{ stroke: "#404040" }}
          />
          <YAxis
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            axisLine={{ stroke: "#404040" }}
            tickLine={{ stroke: "#404040" }}
            width={48}
            domain={["dataMin - 2", "dataMax + 2"]}
          />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #262626",
              borderRadius: 12,
              color: "#e5e5e5",
            }}
            formatter={(value: any) => [
              `${typeof value === "number" ? value.toFixed(1) : value} ${unit}`,
              "Weight",
            ]}
            labelFormatter={(l) => `Date: ${l}`}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#22c55e"
            fill="url(#wGradient)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
