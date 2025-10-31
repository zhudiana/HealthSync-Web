// src/pages/metrics/Temperature.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { withingsTemperature, withingsTemperatureDaily } from "@/lib/api";

// ---- helpers ----
function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDateISO(tsSec: number) {
  try {
    return new Date(tsSec * 1000).toLocaleString();
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

type Preset = 7 | 14 | 30;

export default function TemperaturePage() {
  const { getAccessToken } = useAuth();
  const [preset, setPreset] = useState<Preset>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latest, setLatest] = useState<number | null>(null);
  const [latestTs, setLatestTs] = useState<number | null>(null);
  const [items, setItems] = useState<{ ts: number; celsius: number }[]>([]);

  // Date range in LOCAL time
  const { startYmd, endYmd, label } = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (preset - 1));
    return {
      startYmd: ymdLocal(start),
      endYmd: ymdLocal(end),
      label: `Last ${preset} days · ${ymdLocal(start)} → ${ymdLocal(end)}`,
    };
  }, [preset]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      // Build the list of local dates in range
      const days: string[] = [];
      for (
        let d = new Date(startYmd + "T00:00:00");
        d <= new Date(endYmd + "T00:00:00");

      ) {
        days.push(ymdLocal(d));
        const n = new Date(d);
        n.setDate(d.getDate() + 1);
        d = n;
      }

      // 1) CACHE FIRST: fetch each day from cache in parallel
      const cacheResults = await Promise.all(
        days.map(async (day) => {
          try {
            // 404 -> null (your helper already returns null on 404)
            const resp = await withingsTemperatureDaily(token, day);
            return { day, data: resp }; // data: { date, items } | null
          } catch (e) {
            // treat any non-404 failure as missing so we still fall back
            return { day, data: null };
          }
        })
      );

      // Flatten cached items
      const byTs = new Map<number, number>(); // ts -> celsius
      const missingDays = new Set<string>();

      for (const { day, data } of cacheResults) {
        if (data?.items?.length) {
          for (const it of data.items) {
            if (it.body_c != null) byTs.set(it.ts, it.body_c);
          }
        } else {
          missingDays.add(day);
        }
      }

      // 2) If TODAY is missing, fetch LIVE for today (narrow hit)
      const today = ymdLocal(new Date());
      if (missingDays.has(today)) {
        try {
          const liveToday = await withingsTemperature(token, today, today);
          if (liveToday?.items?.length) {
            for (const it of liveToday.items) {
              if (it.body_c != null) byTs.set(it.ts, it.body_c);
            }
            missingDays.delete(today);
          }
        } catch {
          // ignore; if live fails, we leave today missing
        }
      }

      // 3) If other days are still missing, fetch the range once and merge only those days
      if (missingDays.size > 0) {
        try {
          const range = await withingsTemperature(token, startYmd, endYmd);
          if (range?.items?.length) {
            for (const it of range.items) {
              if (it.body_c == null) continue;
              const ymd = ymdLocal(new Date(it.ts * 1000));
              if (missingDays.has(ymd)) {
                byTs.set(it.ts, it.body_c);
              }
            }
          }
        } catch {
          // ignore; we still show whatever cache had
        }
      }

      // 4) Build UI array, keep only those in local range, newest first
      const merged = Array.from(byTs.entries())
        .map(([ts, celsius]) => ({ ts, celsius }))
        .filter(({ ts }) => {
          const ymd = ymdLocal(new Date(ts * 1000));
          return ymd >= startYmd && ymd <= endYmd;
        })
        .sort((a, b) => b.ts - a.ts);

      setItems(merged);
      if (merged.length) {
        setLatest(merged[0].celsius);
        setLatestTs(merged[0].ts);
      } else {
        setLatest(null);
        setLatestTs(null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load temperature data");
      setItems([]);
      setLatest(null);
      setLatestTs(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, startYmd, endYmd]);

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
          <div>
            <h1 className="text-2xl font-bold">Body Temperature</h1>
            <p className="text-neutral-400">{label}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              className="rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1 text-sm"
              value={preset}
              onChange={(e) => setPreset(Number(e.target.value) as Preset)}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
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
                    {items.length > 0 ? (
                      items.map((it) => {
                        const st = statusForTemp(it.celsius);
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
                              {it.celsius.toFixed(1)}°C
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${st.bg}/10 ${st.color}`}
                              >
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
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

              {error && (
                <div className="mt-6 text-xs text-red-500">{error}</div>
              )}
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
                A temperature above 38°C (100.4°F) usually indicates a fever.
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
                <strong className="font-medium">High fever</strong>: ≥ 38.0°C
              </li>
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}
