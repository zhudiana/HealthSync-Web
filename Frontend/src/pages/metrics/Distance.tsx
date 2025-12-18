import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ChevronLeft } from "lucide-react";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { tokens } from "@/lib/storage";
import { stepsSeries, withingsDistanceDaily, fitbitDistanceHistory } from "@/lib/api";

// --------------------- helpers ---------------------
function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return n.toFixed(digits);
}

function formatDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// --------------------- types ---------------------
interface DistancePoint {
  date: string;
  distance_km: number;
}

// --------------------- main ---------------------
export default function Distance() {
  const [range, setRange] = useState<"7d" | "14d" | "30d">("14d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<DistancePoint[]>([]);
  const [provider, setProvider] = useState<"fitbit" | "withings" | null>(null);

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

  // fetch data (auto-detects provider)
  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Detect logged-in provider
      const detectedProvider = tokens.getAccess("fitbit")
        ? "fitbit"
        : "withings";
      setProvider(detectedProvider);
      const accessToken = tokens.getAccess(detectedProvider);

      if (!accessToken) {
        throw new Error(
          `No ${detectedProvider} session found. Please connect ${detectedProvider}.`
        );
      }

      const points: DistancePoint[] = [];

      if (detectedProvider === "withings") {
        // --- Withings: fetch with cache fallback ---
        const todayStr = formatDate(new Date());

        // Always get fresh data for today
        const todayData = await stepsSeries(
          accessToken,
          "withings",
          todayStr,
          todayStr
        );
        if (todayData?.[0]) {
          points.push({
            date: todayStr,
            distance_km: todayData[0].distance_km || 0,
          });
        }

        // Try to get cached data for previous days
        let currentDate = new Date(dateFrom);
        const endDate = new Date(dateTo);

        while (currentDate <= endDate) {
          const dateStr = formatDate(currentDate);
          // Skip today since we already have fresh data for it
          if (dateStr === todayStr) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
          }

          try {
            const data = await withingsDistanceDaily(accessToken, dateStr);
            if (data && data.distance_km !== null) {
              points.push({
                date: dateStr,
                distance_km: data.distance_km,
              });
            }
          } catch (e) {
            console.warn(`Failed to get cached data for ${dateStr}:`, e);
            // If cached data not available, we'll fall back to the API
            try {
              const apiData = await stepsSeries(
                accessToken,
                "withings",
                dateStr,
                dateStr
              );
              if (apiData?.[0]) {
                points.push({
                  date: dateStr,
                  distance_km: apiData[0].distance_km || 0,
                });
              }
            } catch (e) {
              console.warn(`Failed to fetch API data for ${dateStr}:`, e);
            }
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        // --- Fitbit: fetch history for date range ---
        const hist = await fitbitDistanceHistory(
          accessToken,
          dateFrom,
          dateTo
        );

        hist.items.forEach((it: any) => {
          if (it.date && it.distance_km != null) {
            points.push({
              date: it.date,
              distance_km: it.distance_km,
            });
          }
        });
      }

      // Sort by date
      const normalized = points
        .filter(
          (p): p is DistancePoint =>
            p.date !== undefined &&
            p.distance_km !== undefined &&
            !Number.isNaN(p.distance_km)
        )
        .sort((a, b) => a.date.localeCompare(b.date));

      setSeries(normalized);
    } catch (e: any) {
      console.error("Error loading distance data:", e);
      setError(e?.message || "Failed to load distance data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [range, dateFrom, dateTo]);

  const stats = useMemo(() => {
    if (!series.length) return null;
    const total = series.reduce((sum, p) => sum + p.distance_km, 0);
    const avg = total / series.length;
    const max = Math.max(...series.map((p) => p.distance_km));
    const min = Math.min(...series.map((p) => p.distance_km));
    return { total, avg, max, min };
  }, [series]);

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
              <h2 className="text-2xl font-bold tracking-tight">Distance</h2>
              <p className="text-zinc-400">
                {provider
                  ? provider.charAt(0).toUpperCase() + provider.slice(1)
                  : "Loading"}{" "}
                · {dateFrom} → {dateTo}
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
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">Total distance</div>
                <div className="text-2xl font-semibold">
                  {stats ? `${fmt(stats.total)} km` : "–"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  over {series.length} days
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">Daily average</div>
                <div className="text-2xl font-semibold">
                  {stats ? `${fmt(stats.avg)} km` : "–"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  min: {stats ? `${fmt(stats.min)}` : "–"} · max:{" "}
                  {stats ? `${fmt(stats.max)}` : "–"} km
                </div>
              </div>
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
                  <BarChart
                    data={series}
                    margin={{ left: 0, right: 8, top: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="date" stroke="#a1a1aa" />
                    <YAxis stroke="#a1a1aa" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #3f3f46",
                        borderRadius: 8,
                      }}
                      formatter={(value: any) => [
                        `${
                          typeof value === "number" ? value.toFixed(1) : value
                        } km`,
                        "Distance",
                      ]}
                    />
                    <Bar
                      dataKey="distance_km"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Table */}
            {series.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800">
                  <thead className="bg-zinc-900/60">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Distance (km)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                    {series
                      .slice()
                      .reverse()
                      .map((row) => (
                        <tr key={row.date} className="hover:bg-zinc-900/40">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                            {formatDate(row.date)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-100">
                            {fmt(row.distance_km)} km
                          </td>
                        </tr>
                      ))}
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
