import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { withingsTemperature } from "@/lib/api";

function fmtDateISO(d: number) {
  try {
    return new Date(d * 1000).toLocaleString();
  } catch {
    return "";
  }
}

function statusForTemp(temp: number | null | undefined) {
  if (temp == null)
    return { label: "No data", color: "text-zinc-400", bg: "bg-zinc-700" };
  if (temp >= 38)
    return { label: "High fever", color: "text-red-500", bg: "bg-red-500" };
  if (temp >= 37)
    return { label: "Mild fever", color: "text-amber-500", bg: "bg-amber-500" };
  return { label: "Normal", color: "text-emerald-500", bg: "bg-emerald-500" };
}

export default function TemperaturePage() {
  const { getAccessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<number | null>(null);
  const [latestTs, setLatestTs] = useState<number | null>(null);
  const [items, setItems] = useState<{ ts: number; celsius: number }[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      // Get data for last 30 days with proper date format (YYYY-MM-DD)
      const end = new Date().toISOString().split("T")[0];
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      console.log("Fetching temperature data:", { start, end });
      const res = await withingsTemperature(token, start, end);
      console.log("Temperature response:", res);

      if (res?.items && Array.isArray(res.items)) {
        // Filter out items with null body_c values and sort by timestamp
        const validItems = res.items
          .filter((item) => item.body_c !== null)
          .sort((a, b) => b.ts - a.ts); // Sort in descending order (newest first)

        const transformed = validItems.map((item) => ({
          ts: item.ts,
          celsius: item.body_c!,
        }));

        console.log("Transformed items:", transformed);
        setItems(transformed);

        // Set latest from the most recent valid measurement
        if (transformed.length > 0) {
          setLatest(transformed[0].celsius);
          setLatestTs(transformed[0].ts);
        } else {
          setLatest(null);
          setLatestTs(null);
        }
      } else {
        console.log("No temperature data found");
        setLatest(null);
        setLatestTs(null);
        setItems([]);
      }
    } catch (e: any) {
      console.error("Error loading temperature data:", e);
      setError(e?.message || "Failed to load temperature data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = useMemo(() => statusForTemp(latest), [latest]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 hover:bg-neutral-900 transition"
            aria-label="Back to dashboard"
          >
            <ChevronLeft className="h-5 w-5 text-neutral-100" />
          </Link>
          <h1 className="text-2xl font-bold">Body Temperature</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-900"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
            <div className="flex flex-col items-center">
              <div className="flex-shrink-0">
                <div
                  className={`${status.bg} w-44 h-44 rounded-full flex items-center justify-center`}
                >
                  <div className="text-center text-white">
                    <div className="text-3xl md:text-4xl font-bold">
                      {latest != null ? `${latest.toFixed(1)}°C` : "--"}
                    </div>
                    <div className="mt-1 text-sm opacity-90">
                      {status.label}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 w-full max-w-md mx-auto">
                {/* temperature scale */}
                <div className="w-full">
                  <div className="h-3 rounded-full overflow-hidden flex bg-neutral-800">
                    <div className="w-[50%] bg-emerald-500" />
                    <div className="w-[25%] bg-amber-500" />
                    <div className="w-[25%] bg-red-500" />
                  </div>
                  <div className="flex justify-between text-xs text-neutral-400 mt-2">
                    <span>35.0°C</span>
                    <span>37.0°C</span>
                    <span>38.0°C</span>
                    <span>41.0°C</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 text-center text-xs text-neutral-400">
              {latestTs ? (
                <>Last measurement: {fmtDateISO(latestTs)}</>
              ) : (
                <>No recent measurement</>
              )}
            </div>

            {/* historical table */}
            <div className="mt-8">
              <h3 className="text-base font-semibold text-neutral-100 mb-4 text-center">
                Measurement History
              </h3>
              <div className="overflow-hidden rounded-lg border border-neutral-800">
                <table className="min-w-full divide-y divide-neutral-800">
                  <thead className="bg-neutral-900/60">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400">
                        Date & Time
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-neutral-400">
                        Temperature
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 bg-neutral-950/20">
                    {items.map((it) => {
                      const status = statusForTemp(it.celsius);
                      return (
                        <tr key={it.ts} className="hover:bg-neutral-900/40">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-200">
                            {new Date(it.ts * 1000).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-100 text-center font-medium">
                            {it.celsius.toFixed(1)}°C
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.bg}/10 ${status.color}`}
                            >
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {items.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-6 text-center text-neutral-400"
                        >
                          No measurements available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 text-xs text-neutral-400">
              {error && <div className="text-red-500">{error}</div>}
            </div>
          </div>

          <aside className="md:col-span-1 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
            <h3 className="text-lg font-semibold mb-4 text-neutral-100">
              About Body Temperature
            </h3>
            <div className="text-sm text-neutral-200 leading-relaxed max-w-none">
              <p className="mb-3">
                Body temperature is a vital sign that indicates how well your
                body regulates heat. Normal body temperature varies throughout
                the day and can be influenced by activity, environment, and
                individual factors.
              </p>
              <p className="mb-3">
                A temperature above 38°C (100.4°F) usually indicates a fever,
                which is often a sign that your body is fighting an infection.
                While mild fevers aren't typically concerning, persistent high
                temperatures should be evaluated by a healthcare provider.
              </p>
            </div>

            <h3 className="text-sm font-semibold mt-6 mb-2 text-neutral-100">
              Temperature Ranges
            </h3>
            <ul className="text-sm text-neutral-300 space-y-2">
              <li>
                <strong className="font-medium">Normal</strong>: &lt; 37.0°C
              </li>
              <li>
                <strong className="font-medium">Mild fever</strong>: 37.0–37.9°C
              </li>
              <li>
                <strong className="font-medium">High fever</strong>: ≥ 38.0°C —
                consider seeking medical advice
              </li>
            </ul>

            <p className="mt-4 text-xs text-neutral-400">
              The measurement shown here is taken from your connected
              device/provider. If you have concerns about your readings, consult
              a healthcare professional.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
