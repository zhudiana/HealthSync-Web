import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { RefreshCw, ChevronLeft } from "lucide-react";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { tokens } from "@/lib/storage";
import { withingsHeartRateDaily } from "@/lib/api";

// --------------------- helpers ---------------------
function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toFixed(0);
}

function formatDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// --------------------- components ---------------------
function HeartRateChart({
  data,
  loading,
}: {
  data: HeartRatePoint[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center text-neutral-400">
        Loading chart…
      </div>
    );
  }
  if (!data?.length) {
    return (
      <div className="flex h-96 items-center justify-center text-neutral-400">
        No points to show
      </div>
    );
  }

  return (
    <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
        >
          <defs>
            <linearGradient id="maxGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="avgGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="minGradient" x1="0" y1="0" x2="0" y2="1">
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
          />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #262626",
              borderRadius: 12,
              color: "#e5e5e5",
            }}
            formatter={(value: any, name: string) => [
              `${typeof value === "number" ? value.toFixed(0) : value} bpm`,
              name,
            ]}
            labelFormatter={(l) => `Date: ${l}`}
          />
          <Area
            name="Maximum BPM"
            type="monotone"
            dataKey="max_bpm"
            stroke="#ef4444"
            fill="url(#maxGradient)"
            strokeWidth={2}
            dot={{ fill: "#fff", stroke: "#ef4444", r: 2 }}
            activeDot={{ fill: "#fff", stroke: "#ef4444", r: 4 }}
          />
          <Area
            name="Average BPM"
            type="monotone"
            dataKey="avg_bpm"
            stroke="#3b82f6"
            fill="url(#avgGradient)"
            strokeWidth={2}
            dot={{ fill: "#fff", stroke: "#3b82f6", r: 2 }}
            activeDot={{ fill: "#fff", stroke: "#3b82f6", r: 4 }}
          />
          <Area
            name="Minimum BPM"
            type="monotone"
            dataKey="min_bpm"
            stroke="#22c55e"
            fill="url(#minGradient)"
            strokeWidth={2}
            dot={{ fill: "#fff", stroke: "#22c55e", r: 2 }}
            activeDot={{ fill: "#fff", stroke: "#22c55e", r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// --------------------- types ---------------------
interface HeartRatePoint {
  date: string; // YYYY-MM-DD
  avg_bpm: number; // matches with hr_average from API
  min_bpm?: number | null; // matches with hr_min from API
  max_bpm?: number | null; // matches with hr_max from API
}

// --------------------- main ---------------------
export default function AverageHeartRate() {
  const [range, setRange] = useState<"7d" | "14d" | "30d">("7d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<HeartRatePoint[]>([]);

  // compute date range
  const { dateFrom, dateTo } = useMemo(() => {
    const to = new Date();
    const from = new Date();
    if (range === "7d") from.setDate(to.getDate() - 6);
    if (range === "14d") from.setDate(to.getDate() - 13);
    if (range === "30d") from.setDate(to.getDate() - 29);
    return {
      dateFrom: formatDate(from),
      dateTo: formatDate(to),
    };
  }, [range]);

  // fetch data
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const accessToken = tokens.getAccess("withings");
      if (!accessToken)
        throw new Error("No Withings session found. Please connect Withings.");

      // Fetch daily heart rate data for each day in the range
      const dailyData: HeartRatePoint[] = [];
      let currentDate = new Date(dateFrom);
      const endDate = new Date(dateTo);

      while (currentDate <= endDate) {
        const dateStr = formatDate(currentDate);
        const data = await withingsHeartRateDaily(accessToken, dateStr);

        if (data && data.hr_average !== null) {
          dailyData.push({
            date: dateStr,
            avg_bpm: data.hr_average,
            min_bpm: data.hr_min,
            max_bpm: data.hr_max,
          });
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Sort by date
      dailyData.sort((a, b) => a.date.localeCompare(b.date));
      setSeries(dailyData);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load heart rate data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [range, dateFrom, dateTo]);

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
                Average Heart Rate
              </h2>
              <p className="text-zinc-400">
                Withings · {dateFrom} → {dateTo}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as "7d" | "14d" | "30d")}
              className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
              aria-label="Select date range"
            >
              <option value="7d">Last 7 days</option>
              <option value="14d">Last 14 days</option>
              <option value="30d">Last 30 days</option>
            </select>

            <button
              onClick={() => load()}
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
        {error ? (
          <div className="mb-4 rounded-lg border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : (
          <>
            {/* Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-xl p-6"
            >
              <HeartRateChart data={series} loading={loading} />
            </motion.div>

            {/* Data table */}
            {series.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-xl p-6"
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="py-2 px-4 text-left text-zinc-400 font-medium">
                          Date
                        </th>
                        <th className="py-2 px-4 text-right text-zinc-400 font-medium">
                          Average BPM
                        </th>
                        <th className="py-2 px-4 text-right text-zinc-400 font-medium">
                          Min BPM
                        </th>
                        <th className="py-2 px-4 text-right text-zinc-400 font-medium">
                          Max BPM
                        </th>
                        <th className="py-2 px-4 text-left text-zinc-400 font-medium">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {series.map((point) => {
                        const avgValue = point.avg_bpm;
                        let status = "Normal";
                        let statusColor = "text-green-400";

                        if (avgValue > 100) {
                          status = "High";
                          statusColor = "text-red-400";
                        } else if (avgValue < 60) {
                          status = "Low";
                          statusColor = "text-yellow-400";
                        }

                        return (
                          <tr key={point.date} className="hover:bg-zinc-900/50">
                            <td className="py-2 px-4">{point.date}</td>
                            <td className="py-2 px-4 text-right">
                              {fmt(point.avg_bpm)}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {fmt(point.min_bpm)}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {fmt(point.max_bpm)}
                            </td>
                            <td className={`py-2 px-4 ${statusColor}`}>
                              {status}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
