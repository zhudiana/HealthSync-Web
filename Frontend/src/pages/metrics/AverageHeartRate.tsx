import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { RefreshCw, ChevronLeft, Loader2, Heart } from "lucide-react";
import HrThresholdDialog from "@/components/HeartRateThresholdDialog";
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
import {
  withingsHeartRateDaily,
  updateUserByAuth,
  getUserByAuth,
} from "@/lib/api";

const API_BASE_URL = import.meta.env.VITE_API_URL;

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
        <div className="flex items-center gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </div>
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
  const [autoRefresh, setAutoRefresh] = useState(true); // Auto-refresh enabled by default
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [thresholds, setThresholds] = useState<{
    low: number | null;
    high: number | null;
  }>({
    low: null,
    high: null,
  });

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

      // Create a Map to store unique data points by date
      const dataMap = new Map();

      // Pre-fetch today's data first to ensure it's fresh
      const todayStr = formatDate(new Date());
      try {
        const todayData = await withingsHeartRateDaily(accessToken, todayStr);
        if (todayData?.hr_average !== null) {
          dataMap.set(todayStr, {
            date: todayStr,
            avg_bpm: todayData.hr_average,
            min_bpm: todayData.hr_min,
            max_bpm: todayData.hr_max,
          });
        }
      } catch (e) {
        console.error("Failed to fetch today's heart rate:", e);
      }

      while (currentDate <= endDate) {
        const dateStr = formatDate(currentDate);

        // Skip if we already have data for this date
        if (dataMap.has(dateStr)) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }

        // Try to get cached data first
        let data;
        try {
          const cachedData = await fetch(
            `${API_BASE_URL}/withings/metrics/heart-rate/daily/cached/${dateStr}?access_token=${encodeURIComponent(
              accessToken
            )}`
          );

          if (cachedData.ok) {
            data = await cachedData.json();
          } else {
            // If no cached data (404) or other error, fall back to regular endpoint
            data = await withingsHeartRateDaily(accessToken, dateStr);
          }
        } catch (e) {
          // If cache attempt fails, fall back to regular endpoint
          data = await withingsHeartRateDaily(accessToken, dateStr);
        }

        if (data && data.hr_average !== null) {
          dataMap.set(dateStr, {
            date: dateStr,
            avg_bpm: data.hr_average,
            min_bpm: data.hr_min,
            max_bpm: data.hr_max,
          });
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Convert Map to array and sort by date
      const uniqueDailyData = Array.from(dataMap.values());
      uniqueDailyData.sort((a, b) => a.date.localeCompare(b.date));
      setSeries(uniqueDailyData);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load heart rate data");
    } finally {
      setLoading(false);
    }
  }

  // Initial load effect
  useEffect(() => {
    load();
  }, [range, dateFrom, dateTo]);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      load();
      setLastRefresh(new Date());
    }, 5 * 60 * 1000); // Refresh every 5 minutes

    return () => clearInterval(interval);
  }, [autoRefresh, range, dateFrom, dateTo]);

  // Load initial thresholds
  useEffect(() => {
    async function loadThresholds() {
      try {
        const authUserId = localStorage.getItem("authUserId");
        if (!authUserId) return;

        const user = await getUserByAuth(authUserId);
        if (
          user.hr_threshold_low !== undefined ||
          user.hr_threshold_high !== undefined
        ) {
          setThresholds({
            low: user.hr_threshold_low,
            high: user.hr_threshold_high,
          });
        }
      } catch (error) {
        console.error("Failed to load thresholds:", error);
      }
    }
    loadThresholds();
  }, []);

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
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border ${
                autoRefresh
                  ? "border-blue-700 bg-blue-900/20"
                  : "border-zinc-700"
              } hover:bg-zinc-800 text-zinc-200`}
              title={`Auto-refresh is ${autoRefresh ? "on" : "off"}`}
            >
              <RefreshCw
                className={`h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`}
              />
              {autoRefresh ? "Auto" : "Manual"}
            </button>

            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            >
              <Heart className="h-4 w-4" />
              Adjust Threshold
            </button>

            <button
              onClick={() => {
                load();
                setLastRefresh(new Date());
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>

            <HrThresholdDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              initialLow={thresholds.low}
              initialHigh={thresholds.high}
              onSave={async ({ low, high }) => {
                try {
                  const authUserId = localStorage.getItem("authUserId");
                  if (!authUserId) throw new Error("Not authenticated");

                  const response = await updateUserByAuth(authUserId, {
                    hr_threshold_low: low,
                    hr_threshold_high: high,
                  });

                  // Verify the response has the expected properties
                  if (
                    "hr_threshold_low" in response &&
                    "hr_threshold_high" in response
                  ) {
                    setThresholds({
                      low: response.hr_threshold_low as number | null,
                      high: response.hr_threshold_high as number | null,
                    });
                  } else {
                    console.warn(
                      "Response missing threshold values:",
                      response
                    );
                    // Fall back to the values we tried to save
                    setThresholds({ low, high });
                  }
                } catch (error) {
                  console.error("Failed to save thresholds:", error);
                  throw error; // Re-throw to let the dialog handle the error
                }
              }}
            />
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

            {/* Last refresh time */}
            <p className="text-sm text-zinc-500 mt-2">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </p>

            {/* Data table */}
            {series.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800">
                  <thead className="bg-zinc-900/60">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Date
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Avg&nbsp;(bpm)
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Min&nbsp;(bpm)
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Max&nbsp;(bpm)
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                    {series
                      .slice()
                      .reverse()
                      .map((p) => {
                        const avg = p.avg_bpm ?? null;
                        let status = "Normal";
                        let statusClass = "text-emerald-400";
                        if (avg !== null && avg > 100) {
                          status = "High";
                          statusClass = "text-red-400";
                        } else if (avg !== null && avg < 60) {
                          status = "Low";
                          statusClass = "text-yellow-400";
                        }

                        return (
                          <tr key={p.date} className="hover:bg-zinc-900/40">
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                              {formatDate(p.date)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100 text-right">
                              {fmt(p.avg_bpm)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100 text-right">
                              {fmt(p.min_bpm)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100 text-right">
                              {fmt(p.max_bpm)}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-3 text-sm ${statusClass}`}
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
          </>
        )}
      </main>
    </div>
  );
}
