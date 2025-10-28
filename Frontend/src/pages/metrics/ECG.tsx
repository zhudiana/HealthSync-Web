import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useAuth } from "@/context/AuthContext";
import { withingsECG } from "@/lib/api";

type RangeOpt = 7 | 14 | 30;

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(isoString: string) {
  return new Date(isoString).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function classifyHeartRate(hr: number) {
  if (hr >= 100) return { label: "High", color: "text-amber-500" };
  if (hr >= 60) return { label: "Normal", color: "text-emerald-500" };
  return { label: "Low", color: "text-blue-500" };
}

export default function ECGPage() {
  const { getAccessToken } = useAuth();
  const [range, setRange] = useState<RangeOpt>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<{
    items: Array<{
      date: string;
      time_iso: string;
      heart_rate: number;
      afib: boolean;
    }>;
  } | null>(null);

  const [fromISO, toISO] = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (range - 1));
    return [fmtDate(from), fmtDate(to)];
  }, [range]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const data = await withingsECG(token, fromISO, toISO);

      // Transform the data to match our expected format
      const transformedData = {
        items: data.items
          .map((item) => ({
            date: fmtDate(new Date(item.time_iso)),
            time_iso: item.time_iso,
            heart_rate: item.heart_rate,
            afib: Boolean(item.afib),
          }))
          .sort((a, b) => b.time_iso.localeCompare(a.time_iso)), // Most recent first
      };

      setMeasurements(transformedData);
    } catch (e: any) {
      console.error("Error loading ECG data:", e);
      setError(e?.message || "Failed to load ECG data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromISO, toISO]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!measurements?.items?.length) return null;

    const hrs = measurements.items.map((m) => m.heart_rate);
    const avgHR = hrs.reduce((a, b) => a + b, 0) / hrs.length;
    const minHR = Math.min(...hrs);
    const maxHR = Math.max(...hrs);
    const afibCount = measurements.items.filter((m) => m.afib).length;

    return {
      count: measurements.items.length,
      avgHR: Math.round(avgHR),
      minHR,
      maxHR,
      afibCount,
    };
  }, [measurements]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
        {/* Header */}
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
              <h2 className="text-2xl font-bold tracking-tight">ECG History</h2>
              <p className="text-zinc-400">
                Withings · {fromISO} → {toISO}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(Number(e.target.value) as RangeOpt)}
              className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
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

        {/* Stats Grid */}
        {stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">Measurements</div>
                <div className="text-2xl font-semibold">{stats.count}</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">Average HR</div>
                <div className="text-2xl font-semibold">{stats.avgHR} bpm</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">Range</div>
                <div className="text-2xl font-semibold">
                  {stats.minHR} - {stats.maxHR} bpm
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">AFib Detected</div>
                <div className="text-2xl font-semibold">{stats.afibCount}</div>
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={measurements.items}
                    margin={{ top: 10, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(255, 255, 255, 0.1)"
                    />
                    <XAxis
                      dataKey="time_iso"
                      tickFormatter={(time) =>
                        new Date(time).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })
                      }
                      stroke="#525252"
                      tick={{ fill: "#737373", fontSize: 12 }}
                    />
                    <YAxis
                      stroke="#525252"
                      tick={{ fill: "#737373", fontSize: 12 }}
                      domain={["dataMin - 5", "dataMax + 5"]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #27272a",
                        borderRadius: "0.5rem",
                        fontSize: "12px",
                      }}
                      labelFormatter={(time) => new Date(time).toLocaleString()}
                      formatter={(value: number) => [
                        `${Math.round(value)} bpm`,
                        "Heart Rate",
                      ]}
                    />
                    {/* Reference lines for heart rate zones */}
                    <ReferenceLine
                      y={60}
                      stroke="#3b82f6"
                      strokeDasharray="3 3"
                    />
                    <ReferenceLine
                      y={100}
                      stroke="#f59e0b"
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="heart_rate"
                      name="Heart Rate"
                      stroke="#2196f3"
                      strokeWidth={2}
                      dot={(props: any) => {
                        const afib = props.payload.afib;
                        return afib ? (
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={4}
                            fill="#ef4444"
                            stroke="#991b1b"
                            strokeWidth={2}
                          />
                        ) : (
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={3}
                            fill="#2196f3"
                          />
                        );
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex items-center justify-center gap-6 text-sm text-zinc-400">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-8 border-t-2 border-dashed border-blue-500" />
                  <span>Low HR (&lt;60 bpm)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-8 border-t-2 border-dashed border-amber-500" />
                  <span>High HR (&gt;100 bpm)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <span>AFib Detected</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
          {error ? (
            <div className="p-4 text-red-400">{error}</div>
          ) : loading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span>Loading data...</span>
            </div>
          ) : !measurements?.items?.length ? (
            <div className="h-64 flex items-center justify-center text-zinc-400">
              No ECG measurements found in this period.
            </div>
          ) : (
            <div className="overflow-hidden">
              <table className="min-w-full divide-y divide-zinc-800">
                <thead className="bg-zinc-900/60">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Date & Time
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Heart Rate
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      AFib
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/20">
                  {measurements.items.map((item) => {
                    const hrStatus = classifyHeartRate(item.heart_rate);
                    return (
                      <tr key={item.time_iso} className="hover:bg-zinc-900/40">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                          {formatDateTime(item.time_iso)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-center text-zinc-100">
                          {Math.round(item.heart_rate)} bpm
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-center">
                          <span className={`font-medium ${hrStatus.color}`}>
                            {hrStatus.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-center">
                          {item.afib ? (
                            <span className="text-red-400">Detected</span>
                          ) : (
                            <span className="text-zinc-500">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
