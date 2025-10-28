import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  HeartPulse,
  Thermometer,
  Watch,
  Gauge,
  Droplets,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Header from "@/components/Header";
import {
  fetchProfile,
  tokenInfo,
  metricsOverview,
  withingsMetricsOverview,
  withingsMetricsDaily,
  withingsSpO2,
  withingsTemperature,
  withingsHeartRateDaily,
  metrics as fitbitMetrics,
  withingsWeightLatest,
  withingsECG,
  getUserByAuth,
} from "@/lib/api";

// ---------- local stat card (no shadcn version) ----------
function StatCard({
  title,
  icon,
  value,
  unit,
  foot,
  pulse,
  to, // optional link target
}: {
  title: string;
  icon: JSX.Element;
  value: string | number | null;
  unit?: string | null;
  foot?: string | null;
  pulse?: boolean;
  to?: string;
}) {
  const CardInner = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group"
    >
      <div
        className={[
          "rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm",
          to
            ? "transition ring-0 outline-none focus-within:ring-2 focus-within:ring-emerald-400/60 hover:border-zinc-700 hover:bg-zinc-900/80 cursor-pointer"
            : "",
        ].join(" ")}
      >
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-2 text-zinc-300">
            {icon}
            <div className="text-sm font-medium text-zinc-300">{title}</div>
          </div>
          {pulse && (
            <span
              className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="pt-0">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold text-white">
                {value ?? "—"}
                {unit ? (
                  <span className="ml-2 text-base font-normal text-zinc-400">
                    {unit}
                  </span>
                ) : null}
              </div>
              {foot ? (
                <div className="mt-1 text-xs text-zinc-400">{foot}</div>
              ) : null}
            </div>
            {to && (
              <span
                className="text-xs text-zinc-500 opacity-0 group-hover:opacity-100 transition"
                aria-hidden="true"
              >
                View details →
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );

  return to ? (
    <Link
      to={to}
      aria-label={`View detailed ${title} analytics`}
      className="block focus:outline-none"
    >
      {CardInner}
    </Link>
  ) : (
    CardInner
  );
}

export default function Dashboard() {
  const { getAccessToken, profile: ctxProfile, provider } = useAuth();
  const [profile, setProfile] = useState<any>(ctxProfile);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const [steps, setSteps] = useState<number | null>(null);
  const [restingHR, setRestingHR] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [calories, setCalories] = useState<number | null>(null);
  const [spo2, setSpo2] = useState<number | null>(null);
  const [spo2UpdatedAt, setSpo2UpdatedAt] = useState<number | null>(null);
  const [hrv, setHrv] = useState<number | null>(null);
  const [tempVar, setTempVar] = useState<number | null>(null);
  const [tempUpdatedAt, setTempUpdatedAt] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [avgHR, setAvgHR] = useState<number | null>(null);
  const [hrUpdatedAt, setHrUpdatedAt] = useState<number | null>(null); // epoch seconds
  const [maxHR, setMaxHR] = useState<number | null>(null);
  const [minHR, setMinHR] = useState<number | null>(null);
  const [ecgHR, setEcgHR] = useState<number | null>(null);
  const [ecgTime, setEcgTime] = useState<string | null>(null);

  const [dbDisplayName, setDbDisplayName] = useState<string | null>(null);

  // Dates for labels
  const [stepsDate, setStepsDate] = useState<string | null>(null);
  const [distanceDate, setDistanceDate] = useState<string | null>(null);
  const [caloriesDate, setCaloriesDate] = useState<string | null>(null);
  const [heartRateDate, setHeartRateDate] = useState<string | null>(null);

  // ---------- helpers ----------
  const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
  const ymdYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return ymd(d);
  };

  const fmtNumber = (n: number | null | undefined, dp = 1) =>
    n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(dp);

  const fmtKg = (n?: number | null) =>
    n == null || Number.isNaN(n)
      ? "—"
      : new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(Math.round(n * 10) / 10);

  const fmtHMFromHours = (h?: number | null) => {
    if (h == null || Number.isNaN(h)) return "—";
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${hh}h ${mm}m`;
  };

  const fmtTimeHM = (epochSec?: number | null) =>
    epochSec == null
      ? null
      : new Date(epochSec * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

  // NEW: date label helpers
  const isToday = (iso?: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    const t = new Date();
    return (
      d.getFullYear() === t.getFullYear() &&
      d.getMonth() === t.getMonth() &&
      d.getDate() === t.getDate()
    );
  };
  const shortDay = (iso?: string | null) =>
    !iso
      ? null
      : new Date(iso).toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
        });
  const labelFor = (iso?: string | null, fallback: string = "—") =>
    iso ? (isToday(iso) ? "today" : shortDay(iso)!) : fallback;

  // ---------- initial load ----------
  useEffect(() => {
    let mounted = true;
    const ac = new AbortController();

    (async () => {
      try {
        if (!provider) {
          if (!mounted) return;
          setErr("No provider selected.");
          return;
        }

        // 1) Load display name from DB
        const authId = localStorage.getItem("authUserId");
        if (authId) {
          try {
            const u = await getUserByAuth(authId);
            if (mounted) setDbDisplayName(u?.display_name ?? null);
          } catch {
            if (mounted) setDbDisplayName(null);
          }
        }

        // 2) Get access token
        const access = await getAccessToken();
        if (!access) {
          if (!mounted) return;
          setErr("Not authenticated");
          return;
        }

        // 3) Provider profile
        try {
          const profResp = await fetchProfile(access, provider);
          const p = provider === "fitbit" ? profResp?.user : profResp;
          if (mounted) {
            setProfile(
              p ?? {
                fullName: provider === "withings" ? "Withings User" : "User",
              }
            );
          }
        } catch {
          if (!mounted) return;
          if (provider === "withings") {
            setProfile({ fullName: "Withings User" });
          } else {
            throw new Error("Failed to load profile");
          }
        }

        // 4) Metrics
        if (provider === "fitbit") {
          const ov = await metricsOverview(access);
          if (!mounted) return;

          setSteps(ov.steps ?? null);
          setStepsDate(ov.date ?? null);

          setCalories(ov.calories?.total ?? ov.caloriesOut ?? null);
          setCaloriesDate(ov.date ?? null);

          setDistance(ov.total_km ?? null);
          setDistanceDate(ov.date ?? null);

          // Sleep today; fallback to yesterday
          let sleep = await fitbitMetrics.sleep(access);
          let totalHours = sleep?.hoursAsleep ?? null;

          if (!totalHours || totalHours === 0) {
            const y = new Date();
            y.setDate(y.getDate() - 1);
            const ymdStr = y.toISOString().slice(0, 10);
            const s2 = await fitbitMetrics.sleep(access, ymdStr);
            totalHours = s2?.hoursAsleep ?? null;
          }
          if (!mounted) return;
          setSleepHours(totalHours);

          // HRV (latest in a 2-day window)
          try {
            const today = new Date();
            const start = ymd(
              new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 1
              )
            );
            const end = ymd(today);
            const h = await fitbitMetrics.hrv(access, start, end);
            if (mounted) {
              const latest = [...(h?.items ?? [])]
                .filter((it) => typeof it.rmssd_ms === "number")
                .sort((a, b) => (a.date < b.date ? -1 : 1))
                .pop();
              setHrv(latest?.rmssd_ms ?? null);
            }
          } catch {
            if (mounted) setHrv(null);
          }

          // Nightly SpO₂
          try {
            const todayStr = ymd();
            let s = await fitbitMetrics.spo2Nightly(access, todayStr);
            let avg = s?.average ?? null;

            if (avg == null) {
              const y = new Date();
              y.setDate(y.getDate() - 1);
              s = await fitbitMetrics.spo2Nightly(access, ymd(y));
              avg = s?.average ?? null;
            }
            if (mounted) setSpo2(avg);
          } catch {
            if (mounted) setSpo2(null);
          }

          // Skin temperature variability
          try {
            const endStr = ymd();
            const t = await fitbitMetrics.temperature(access, endStr, endStr);
            if (mounted) {
              const last = t?.items?.[t.items.length - 1];
              setTempVar(last?.delta_c ?? null);
            }
          } catch {
            if (mounted) setTempVar(null);
          }

          // Token info (optional)
          try {
            const i = await tokenInfo(access);
            if (mounted) setInfo(i);
          } catch {
            /* ignore */
          }
        } else {
          // WITHINGS
          try {
            const todayStr = ymd();
            const [w, d, latestW] = await Promise.all([
              withingsMetricsOverview(access),
              withingsMetricsDaily(access, todayStr),
              withingsWeightLatest(access),
            ]);

            if (!mounted) return;

            // Set weight from latest measurement
            setWeight(latestW.value ?? null);
            setRestingHR(w.restingHeartRate ?? null);

            // Get today's metrics if available, otherwise use latest
            setSteps(d.steps ?? null);
            setStepsDate(d.date ?? null);

            setCalories(d.calories ?? null);
            setCaloriesDate(d.date ?? null);

            setSleepHours(d.sleepHours ?? null);

            setDistance(d.distanceKm ?? null);
            setDistanceDate(d.date ?? null);

            // Temperature (latest)
            withingsTemperature(access, undefined, undefined)
              .then((t) => {
                if (!mounted) return;
                if (t?.latest?.body_c) {
                  setTempVar(t.latest.body_c);
                } else {
                  setTempVar(null);
                }
              })
              .catch(() => {
                if (mounted) setTempVar(null);
              });

            // ECG (latest) - fetch without date restriction
            withingsECG(access, undefined, undefined, "Europe/Rome", 1)
              .then((e) => {
                if (!mounted) return;
                if (e?.latest) {
                  setEcgHR(e.latest.heart_rate ?? null);
                  setEcgTime(e.latest.time_iso ?? null);
                } else {
                  setEcgHR(null);
                  setEcgTime(null);
                }
              })
              .catch(() => {
                if (mounted) {
                  setEcgHR(null);
                  setEcgTime(null);
                }
              });

            // SpO2
            withingsSpO2(access)
              .then((s) => {
                if (!mounted) return;
                setSpo2(s?.latest?.percent ?? null);
                setSpo2UpdatedAt(s?.latest?.ts ?? null);
              })
              .catch(() => {
                if (mounted) {
                  setSpo2(null);
                  setSpo2UpdatedAt(null);
                }
              });

            // Temperature
            withingsTemperature(access, todayStr, todayStr)
              .then((t) => {
                if (!mounted) return;
                const item = t?.latest;
                const skin = item?.skin_c ?? null;
                const body = item?.body_c ?? null;
                setTempVar(body ?? skin ?? null);
                setTempUpdatedAt(item?.ts ?? null);
              })
              .catch(() => {
                if (mounted) {
                  setTempVar(null);
                  setTempUpdatedAt(null);
                }
              });

            // Heart rate daily (avg/min/max)
            try {
              let daily = await withingsHeartRateDaily(access, todayStr);
              let dateUsed = todayStr;
              if (
                daily?.hr_average == null &&
                daily?.hr_max == null &&
                daily?.hr_min == null
              ) {
                dateUsed = ymdYesterday();
                daily = await withingsHeartRateDaily(access, dateUsed);
              }
              if (mounted) {
                setAvgHR(daily?.hr_average ?? null);
                setMaxHR(daily?.hr_max ?? null);
                setMinHR(daily?.hr_min ?? null);
                setHrUpdatedAt(daily?.updatedAt ?? null);
                setHeartRateDate(dateUsed);
              }
            } catch {
              if (mounted) {
                setAvgHR(null);
                setMaxHR(null);
                setMinHR(null);
                setHrUpdatedAt(null);
              }
            }
          } catch {
            if (!mounted) return;
            setWeight(null);
            setRestingHR(null);
            setSteps(null);
            setCalories(null);
            setSleepHours(null);
            setSpo2(null);
            setTempVar(null);
          }

          if (mounted) {
            setInfo(null);
            setHrv(null);
          }
        }
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Failed to load data");
      }
    })();

    return () => {
      mounted = false;
      ac.abort();
    };
  }, [provider, getAccessToken]);

  // ---------- render ----------
  const greetName =
    dbDisplayName?.trim() ||
    profile?.displayName ||
    profile?.fullName?.trim() ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    (provider === "withings" ? "Withings User" : "User");

  const tempLabel =
    provider === "withings" ? "Body Temperature" : "Skin Temperature Variation";

  if (err) {
    return (
      <>
        <Header />
        <div className="min-h-[calc(100vh-56px)] grid place-items-center px-4">
          <div className="max-w-lg w-full p-6 rounded-xl border border-white/10 text-red-300">
            <p className="mb-4">Error: {err}</p>
            <button
              onClick={() => location.reload()}
              className="inline-flex items-center rounded-md border border-zinc-700 bg-transparent px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
        <section className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-zinc-400">
            Welcome back, {greetName}. Here’s a snapshot of your health today.
          </p>
        </section>

        {/* Metric grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            title="Weight"
            icon={<Gauge className="h-4 w-4" />}
            value={fmtKg(weight)}
            unit="kg"
            foot="Latest"
            to="/metrics/weight"
          />

          <StatCard
            title="Distance"
            icon={<Activity className="h-4 w-4" />}
            value={distance != null ? Number(distance).toFixed(2) : "—"}
            unit="km"
            foot={labelFor(distanceDate)} // show date or "today" here
            to="/metrics/distance"
          />

          <StatCard
            title="Steps"
            icon={<TrendingUp className="h-4 w-4" />}
            value={steps ?? "—"}
            unit={labelFor(stepsDate)} // today or e.g. "27 Oct"
            pulse
            to="/metrics/steps"
          />

          {provider === "fitbit" ? (
            <>
              <StatCard
                title="Sleep (total)"
                icon={<Watch className="h-4 w-4" />}
                value={fmtHMFromHours(sleepHours)}
                to="/metrics/sleep"
              />
              <StatCard
                title="Calories"
                icon={<Activity className="h-4 w-4" />}
                value={calories ?? "—"}
                unit={labelFor(caloriesDate)} // today or date
                to="/metrics/calories"
              />
            </>
          ) : null}

          {provider === "withings" ? (
            <StatCard
              title="Oxygen Saturation (SpO₂)"
              icon={<Droplets className="h-4 w-4" />}
              value={fmtNumber(spo2, 1)}
              unit={spo2UpdatedAt ? `% • ${fmtTimeHM(spo2UpdatedAt)}` : "%"}
              to="/metrics/spo2"
            />
          ) : (
            <StatCard
              title="Blood Oxygen (SpO₂)"
              icon={<Droplets className="h-4 w-4" />}
              value={fmtNumber(spo2, 1)}
              unit="%"
              to="/metrics/spo2"
            />
          )}

          <StatCard
            title={tempLabel}
            icon={<Thermometer className="h-4 w-4" />}
            value={fmtNumber(tempVar, 1)}
            unit={tempUpdatedAt ? `°C • ${fmtTimeHM(tempUpdatedAt)}` : "°C"}
            to="/metrics/temperature"
          />

          {provider === "withings" ? (
            <>
              <StatCard
                title="Average Heart Rate"
                icon={<HeartPulse className="h-4 w-4" />}
                value={avgHR != null ? Math.round(avgHR) : "—"}
                unit="bpm"
                foot={
                  !heartRateDate
                    ? undefined
                    : isToday(heartRateDate)
                    ? "Today"
                    : shortDay(heartRateDate)
                }
                to="/metrics/heart-rate"
              />
              <StatCard
                title="Max Heart Rate"
                icon={<HeartPulse className="h-4 w-4" />}
                value={maxHR != null ? Math.round(maxHR) : "—"}
                unit="bpm"
                foot={
                  !heartRateDate
                    ? undefined
                    : isToday(heartRateDate)
                    ? "Today"
                    : shortDay(heartRateDate)
                }
                to="/metrics/heart-rate"
              />
              <StatCard
                title="Min Heart Rate"
                icon={<HeartPulse className="h-4 w-4" />}
                value={minHR != null ? Math.round(minHR) : "—"}
                unit="bpm"
                foot={
                  !heartRateDate
                    ? undefined
                    : isToday(heartRateDate)
                    ? "Today"
                    : shortDay(heartRateDate)
                }
                to="/metrics/heart-rate"
              />
            </>
          ) : (
            <>
              <StatCard
                title="Resting Heart Rate (RHR)"
                icon={<HeartPulse className="h-4 w-4" />}
                value={restingHR ?? "—"}
                unit="bpm"
                to="/metrics/heart-rate"
              />
              <StatCard
                title="Heart Rate Variability (HRV)"
                icon={<HeartPulse className="h-4 w-4" />}
                value={hrv ?? "—"}
                unit="ms"
                to="/metrics/hrv"
              />
            </>
          )}

          {provider === "withings" && (
            <StatCard
              title="ECG (Latest)"
              icon={<HeartPulse className="h-4 w-4" />}
              value={ecgHR != null ? Math.round(ecgHR) : "—"}
              unit={
                ecgTime
                  ? `bpm • ${new Date(ecgTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "bpm"
              }
              to="/metrics/ecg"
            />
          )}
        </section>
      </main>
    </div>
  );
}
