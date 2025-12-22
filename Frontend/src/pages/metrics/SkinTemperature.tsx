// src/pages/metrics/SkinTemperature.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Thermometer } from "lucide-react";
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

export default function SkinTemperaturePage() {
  // ---------------- state ----------------
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [series, setSeries] = useState<
    Array<{ date: string; delta_c: number }>
  >([]);
  const [latest, setLatest] = useState<number | null>(null);
  const [avg, setAvg] = useState<number | null>(null);
  const [minMax, setMinMax] = useState<{
    min: number | null;
    max: number | null;
  }>({ min: null, max: null });

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
  async function loadTemperature() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const data = await metrics.temperatureHistory(token, startYmd, endYmd);
      if (!data?.items?.length) {
        setSeries([]);
        setLatest(null);
        setAvg(null);
        setMinMax({ min: null, max: null });
        return;
      }

      // Filter out entries with null delta_c
      const filtered = data.items.filter(
        (it) => it.delta_c != null && typeof it.delta_c === "number"
      ) as Array<{
        date: string;
        delta_c: number;
      }>;

      console.log("Loaded temperature history:", {
        start: data.start,
        end: data.end,
        itemCount: data.items.length,
        filteredCount: filtered.length,
      });

      // Sort by date
      filtered.sort((a, b) => a.date.localeCompare(b.date));

      // Calculate statistics
      const temps = filtered.map((it) => it.delta_c);
      const tempAvg =
        temps.length > 0 ? temps.reduce((a, b) => a + b) / temps.length : null;
      const tempMin = temps.length > 0 ? Math.min(...temps) : null;
      const tempMax = temps.length > 0 ? Math.max(...temps) : null;

      // Get latest (most recent)
      const latestTemp =
        filtered.length > 0 ? filtered[filtered.length - 1].delta_c : null;

      setSeries(filtered);
      setLatest(latestTemp);
      setAvg(tempAvg);
      setMinMax({ min: tempMin, max: tempMax });

      // Persist each reading in background (silent fail)
      filtered.forEach((it) => {
        metrics.temperatureToday(token, it.date).catch((e) => {
          console.warn(`Failed to persist temperature for ${it.date}:`, e);
        });
      });
    } catch (e: any) {
      setError(e?.message || "Failed to load temperature data");
      setSeries([]);
      setLatest(null);
      setAvg(null);
      setMinMax({ min: null, max: null });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemperature();
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
                Skin Temperature (Fitbit)
              </h2>
              <p className="text-zinc-400">
                Last {preset} days · {label}
              </p>
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
              onClick={loadTemperature}
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
          <StatCard title="Latest" value={fmt(latest, 1)} subtitle="°C delta" />
          <StatCard title="Average" value={fmt(avg, 1)} subtitle="°C delta" />
          <StatCard
            title="Range"
            value={`${fmt(minMax.min, 1)} to ${fmt(minMax.max, 1)}`}
            subtitle="°C delta"
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
                    value: "°C Delta",
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
                      return [`${value.toFixed(2)}°C`, "Temperature Delta"];
                    }
                    return value;
                  }}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="delta_c"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#f97316" }}
                  name="Temperature Delta"
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
                    Temperature Delta
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                {series.map((row) => {
                  const delta = row.delta_c;
                  let status = "Normal";
                  let statusColor = "text-emerald-400";

                  if (delta > 0.5)
                    (status = "Elevated"), (statusColor = "text-orange-400");
                  if (delta > 1)
                    (status = "High"), (statusColor = "text-red-400");
                  if (delta < -0.5)
                    (status = "Low"), (statusColor = "text-blue-400");

                  return (
                    <tr key={row.date} className="hover:bg-zinc-900/40">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                        <div className="flex items-center gap-2">
                          <Thermometer className="h-4 w-4 text-orange-500" />
                          {fmt(delta, 2)}°C
                        </div>
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-sm font-medium ${statusColor}`}
                      >
                        {status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
