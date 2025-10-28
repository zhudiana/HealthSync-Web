import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { withingsSpO2 } from "@/lib/api";

function fmtDateISO(d: number) {
  try {
    return new Date(d * 1000).toLocaleString();
  } catch {
    return "";
  }
}

function statusForPercent(p: number | null | undefined) {
  if (p == null)
    return { label: "No data", color: "text-zinc-400", bg: "bg-zinc-700" };
  if (p >= 95)
    return { label: "Normal", color: "text-emerald-600", bg: "bg-emerald-500" };
  if (p >= 90)
    return {
      label: "Below average",
      color: "text-amber-600",
      bg: "bg-amber-500",
    };
  return { label: "Low", color: "text-red-500", bg: "bg-red-500" };
}

export default function Spo2Page() {
  const { getAccessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<number | null>(null);
  const [latestTs, setLatestTs] = useState<number | null>(null);
  const [items, setItems] = useState<{ ts: number; percent: number }[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const res = await withingsSpO2(token);
      if (res?.items && Array.isArray(res.items)) {
        const sorted = res.items.slice().sort((a, b) => a.ts - b.ts);
        setItems(sorted);
        const last = sorted[sorted.length - 1];
        if (last) {
          setLatest(last.percent);
          setLatestTs(last.ts);
        } else {
          setLatest(null);
          setLatestTs(null);
        }
      } else if (res?.latest?.percent != null) {
        setLatest(res.latest.percent);
        setLatestTs(res.latest.ts);
        setItems(
          res.latest ? [{ ts: res.latest.ts, percent: res.latest.percent }] : []
        );
      } else {
        setLatest(null);
        setLatestTs(null);
        setItems([]);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load SpO2 data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = useMemo(() => statusForPercent(latest), [latest]);

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
          <h1 className="text-2xl font-bold">Oxygen Saturation (SpO2)</h1>
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
                      {latest != null ? `${Math.round(latest)}%` : "--"}
                    </div>
                    <div className="mt-1 text-sm opacity-90">
                      {status.label}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 w-full max-w-md mx-auto">
                {/* scale bar */}
                <div className="w-full">
                  <div className="h-3 rounded-full overflow-hidden flex bg-neutral-800">
                    <div className="w-[10%] bg-amber-600" />
                    <div className="w-[10%] bg-amber-500" />
                    <div className="w-[30%] bg-emerald-500" />
                    <div className="w-[50%] bg-emerald-600" />
                  </div>
                  <div className="flex justify-between text-xs text-neutral-400 mt-2">
                    <span>&lt; 85%</span>
                    <span>90%</span>
                    <span>95%</span>
                    <span>100%</span>
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
                        SpO2
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 bg-neutral-950/20">
                    {items
                      .slice()
                      .reverse()
                      .map((it) => {
                        const status = statusForPercent(it.percent);
                        return (
                          <tr key={it.ts} className="hover:bg-neutral-900/40">
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-200">
                              {new Date(it.ts * 1000).toLocaleString(
                                undefined,
                                {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-100 text-center font-medium">
                              {Math.round(it.percent)}%
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
                          colSpan={2}
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
          </div>

          <aside className="md:col-span-1 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
            <h3 className="text-lg font-semibold mb-4 text-neutral-100">
              About SpO2
            </h3>
            <div className="text-sm text-neutral-200 leading-relaxed max-w-none">
              <p className="mb-3">
                Oxygen saturation (SpO2) measures the percentage of hemoglobin
                in your blood that is saturated with oxygen. A healthy SpO2
                value for most people at sea level is typically 95% or higher.
                Readings can vary with activity, altitude, and the measurement
                method.
              </p>
              <p className="mb-3">
                Low values (below ~90%) may indicate hypoxemia and can be a sign
                of respiratory or cardiac issues. Occasional brief dips can be
                normal (e.g., during sleep), but persistent low values should be
                discussed with a healthcare professional.
              </p>
            </div>

            <h3 className="text-sm font-semibold mt-6 mb-2 text-neutral-100">
              Interpretation Guide
            </h3>
            <ul className="text-sm text-neutral-300 space-y-2">
              <li>
                <strong className="font-medium">Normal</strong>: SpO2 ≥ 95%
              </li>
              <li>
                <strong className="font-medium">Below average</strong>: 90–94%
              </li>
              <li>
                <strong className="font-medium">Low</strong>: &lt; 90% —
                consider seeking medical advice
              </li>
            </ul>

            <p className="mt-4 text-xs text-neutral-400">
              The measurement shown here is taken from your connected
              device/provider. If you have concerns about your readings, consult
              a clinician.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
