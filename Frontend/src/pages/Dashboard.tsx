import { useEffect, useState, cloneElement } from "react";
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
  Loader2,
  ChevronRight,
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

// ---------- local stat card ----------
function StatCard({
  title,
  icon,
  value,
  unit,
  foot,
  pulse,
  to,
  loading, // NEW
}: {
  title: string;
  icon: JSX.Element;
  value: string | number | null;
  unit?: string | null;
  foot?: string | null;
  pulse?: boolean;
  to?: string;
  loading?: boolean; // NEW
}) {
  const content = (
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
          <div className="text-sm font-medium text-zinc-300">{title}</div>
          {pulse && (
            <span
              className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
              aria-hidden
            />
          )}
        </div>

        <div className="pt-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold text-white min-h-[2.25rem] flex items-center">
                {/* value / spinner */}
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                ) : (
                  <>
                    {value ?? "—"}
                    {unit ? (
                      <span className="ml-2 text-base font-normal text-zinc-400">
                        {unit}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              {/* foot */}
              {foot ? (
                <div className="mt-1 text-xs text-zinc-400">{foot}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-sky-950/50 flex items-center justify-center text-sky-400">
                {cloneElement(icon, { className: 'h-6 w-6' })}
              </div>
              {to && (
                <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              )}
            </div>
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
      {content}
    </Link>
  ) : (
    content
  );
}

export default function Dashboard() {
  const { getAccessToken, profile: ctxProfile, provider } = useAuth();
  const [profile, setProfile] = useState<any>(ctxProfile);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  // values
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
  const [hrUpdatedAt, setHrUpdatedAt] = useState<number | null>(null);
  const [maxHR, setMaxHR] = useState<number | null>(null);
  const [minHR, setMinHR] = useState<number | null>(null);
  const [ecgHR, setEcgHR] = useState<number | null>(null);
  const [ecgTime, setEcgTime] = useState<string | null>(null);

  const [dbDisplayName, setDbDisplayName] = useState<string | null>(null);

  // labels / dates
  const [stepsDate, setStepsDate] = useState<string | null>(null);
  const [distanceDate, setDistanceDate] = useState<string | null>(null);
  const [caloriesDate, setCaloriesDate] = useState<string | null>(null);
  const [heartRateDate, setHeartRateDate] = useState<string | null>(null);

  // NEW: loading state per metric
  const [loading, setLoading] = useState<
    Record<
      | "weight"
      | "distance"
      | "steps"
      | "sleep"
      | "calories"
      | "restingHR"
      | "hrv"
      | "spo2"
      | "temperature"
      | "avgHR"
      | "maxHR"
      | "minHR"
      | "ecg",
      boolean
    >
  >({
    weight: true,
    distance: true,
    steps: true,
    sleep: true,
    calories: true,
    restingHR: true,
    hrv: true,
    spo2: true,
    temperature: true,
    avgHR: true,
    maxHR: true,
    minHR: true,
    ecg: true,
  });

  const setLoad = (key: keyof typeof loading, val: boolean) =>
    setLoading((s) => ({ ...s, [key]: val }));

  // helpers
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
    iso ? (isToday(iso) ? "Today" : shortDay(iso)!) : fallback;

  // initial load
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!provider) {
          if (!mounted) return;
          setErr("No provider selected.");
          return;
        }

        // DB display name
        const authId = localStorage.getItem("authUserId");
        if (authId) {
          try {
            const u = await getUserByAuth(authId);
            if (mounted) setDbDisplayName(u?.display_name ?? null);
          } catch {
            if (mounted) setDbDisplayName(null);
          }
        }

        // token
        const access = await getAccessToken();
        if (!access) {
          if (!mounted) return;
          setErr("Not authenticated");
          return;
        }

        // profile
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
          if (provider === "withings")
            setProfile({ fullName: "Withings User" });
        }

        if (provider === "fitbit") {
          // Overview
          try {
            const ov = await metricsOverview(access);

            if (!mounted) return;

            setSteps(ov.steps ?? null);
            setStepsDate(ov.date ?? null);
            setLoad("steps", false);

            setCalories(ov.calories?.total ?? ov.caloriesOut ?? null);
            setCaloriesDate(ov.date ?? null);
            setLoad("calories", false);

            setDistance(ov.total_km ?? null);
            setDistanceDate(ov.date ?? null);
            setLoad("distance", false);
          } catch {
            setLoad("steps", false);
            setLoad("calories", false);
            setLoad("distance", false);
          }

          // Sleep
          try {
            let sleep = await fitbitMetrics.sleep(access);
            let totalHours = sleep?.hoursAsleep ?? null;
            if (!totalHours || totalHours === 0) {
              const y = new Date();
              y.setDate(y.getDate() - 1);
              const s2 = await fitbitMetrics.sleep(
                access,
                y.toISOString().slice(0, 10)
              );
              totalHours = s2?.hoursAsleep ?? null;
            }
            if (mounted) setSleepHours(totalHours);
          } finally {
            setLoad("sleep", false);
          }

          // HRV
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
          } finally {
            setLoad("hrv", false);
          }

          // Nightly SpO2
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
            if (mounted) {
              setSpo2(avg);
              // Fitbit nightly endpoint returns a single date; we reuse todayStr as label
              setSpo2UpdatedAt(Date.parse(todayStr) / 1000);
            }
          } finally {
            setLoad("spo2", false);
          }

          // Temperature variability
          try {
            const endStr = ymd();
            const t = await fitbitMetrics.temperature(access, endStr, endStr);
            if (mounted) {
              const last = t?.items?.[t.items.length - 1];
              setTempVar(last?.delta_c ?? null);
              setTempUpdatedAt(Date.parse(endStr) / 1000);
            }
          } finally {
            setLoad("temperature", false);
          }

          // Token info (optional)
          try {
            const i = await tokenInfo(access);
            if (mounted) setInfo(i);
          } catch {
            /* ignore */
          }

          // resting HR (from overview/fitbit profile not shown separately on fitbit path)
          setLoad("restingHR", false);
          setLoad("avgHR", false);
          setLoad("maxHR", false);
          setLoad("minHR", false);
          setLoad("weight", false);
          setLoad("ecg", false);
        } else {
          // WITHINGS
          const todayStr = ymd();

          // Overview + daily + latest weight in parallel
          try {
            const [w, d, latestW] = await Promise.all([
              withingsMetricsOverview(access),
              withingsMetricsDaily(access, todayStr),
              withingsWeightLatest(access),
            ]);
            if (!mounted) return;

            // weight
            setWeight(latestW.value ?? null);
            setLoad("weight", false);

            // resting HR
            setRestingHR(w.restingHeartRate ?? null);
            setLoad("restingHR", false);

            // steps / calories / distance (+ dates)
            setSteps(d.steps ?? null);
            setStepsDate(d.date ?? null);
            setLoad("steps", false);

            setCalories(d.calories ?? null);
            setCaloriesDate(d.date ?? null);
            setLoad("calories", false);

            setSleepHours(d.sleepHours ?? null);
            setDistance(d.distanceKm ?? null);
            setDistanceDate(d.date ?? null);
            setLoad("sleep", false);
            setLoad("distance", false);
          } catch {
            setLoad("weight", false);
            setLoad("restingHR", false);
            setLoad("steps", false);
            setLoad("calories", false);
            setLoad("sleep", false);
            setLoad("distance", false);
          }

          // Temperature (window & latest)
          withingsTemperature(access, todayStr, todayStr)
            .then((t) => {
              if (!mounted) return;
              const item = t?.latest;
              const skin = item?.skin_c ?? null;
              const body = item?.body_c ?? null;
              setTempVar(body ?? skin ?? null);
              setTempUpdatedAt(item?.ts ?? null);
            })
            .finally(() => setLoad("temperature", false));

          // ECG latest
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
            .finally(() => setLoad("ecg", false));

          // SpO2
          withingsSpO2(access)
            .then((s) => {
              if (!mounted) return;
              setSpo2(s?.latest?.percent ?? null);
              setSpo2UpdatedAt(s?.latest?.ts ?? null);
            })
            .finally(() => setLoad("spo2", false));

          // Heart rate daily (avg/min/max)
          (async () => {
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
            } finally {
              setLoad("avgHR", false);
              setLoad("maxHR", false);
              setLoad("minHR", false);
            }
          })();

          if (mounted) {
            setInfo(null);
            setHrv(null);
            setLoad("hrv", false);
          }
        }
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Failed to load data");
        // End all spinners on error
        setLoading(
          (m) =>
            Object.fromEntries(Object.keys(m).map((k) => [k, false])) as any
        );
      }
    })();

    return () => {
      mounted = false;
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

  // compute date labels for SpO2 & Temp
  const spo2DateIso = spo2UpdatedAt
    ? new Date(spo2UpdatedAt * 1000).toISOString().slice(0, 10)
    : null;
  const tempDateIso = tempUpdatedAt
    ? new Date(tempUpdatedAt * 1000).toISOString().slice(0, 10)
    : null;

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
            icon={<div className="bg-purple-950/50 text-purple-400"><Gauge className="h-4 w-4" /></div>}
            value={fmtKg(weight)}
            unit="kg"
            foot="Latest"
            to="/metrics/weight"
            loading={loading.weight}
          />

          <StatCard
            title="Distance"
            icon={<div className="bg-emerald-950/50 text-emerald-400"><Activity className="h-4 w-4" /></div>}
            value={distance != null ? Number(distance).toFixed(2) : "—"}
            unit="km"
            foot={labelFor(distanceDate)}
            to="/metrics/distance"
            loading={loading.distance}
          />

          <StatCard
            title="Steps"
            icon={<div className="bg-blue-950/50 text-blue-400"><TrendingUp className="h-4 w-4" /></div>}
            value={steps ?? "—"}
            unit={labelFor(stepsDate)}
            pulse
            to="/metrics/steps"
            loading={loading.steps}
          />

          {provider === "fitbit" ? (
            <>
              <StatCard
                title="Sleep (total)"
                icon={<div className="bg-indigo-950/50 text-indigo-400"><Watch className="h-4 w-4" /></div>}
                value={fmtHMFromHours(sleepHours)}
                to="/metrics/sleep"
                loading={loading.sleep}
              />
              <StatCard
                title="Calories"
                icon={<div className="bg-orange-950/50 text-orange-400"><Activity className="h-4 w-4" /></div>}
                value={calories ?? "—"}
                unit={labelFor(caloriesDate)}
                to="/metrics/calories"
                loading={loading.calories}
              />
            </>
          ) : null}

          {/* SpO2 with date in foot */}
          <StatCard
            title={
              provider === "withings"
                ? "Oxygen Saturation (SpO₂)"
                : "Blood Oxygen (SpO₂)"
            }
            icon={<div className="bg-cyan-950/50 text-cyan-400"><Droplets className="h-4 w-4" /></div>}
            value={fmtNumber(spo2, 1)}
            unit="%"
            foot={labelFor(spo2DateIso)}
            to="/metrics/spo2"
            loading={loading.spo2}
          />

          {/* Temperature with date in foot */}
          <StatCard
            title={tempLabel}
            icon={<div className="bg-rose-950/50 text-rose-400"><Thermometer className="h-4 w-4" /></div>}
            value={fmtNumber(tempVar, 1)}
            unit="°C"
            foot={labelFor(tempDateIso)}
            to="/metrics/temperature"
            loading={loading.temperature}
          />

          {provider === "withings" ? (
            <>
              <StatCard
                title="Average Heart Rate"
                icon={<div className="bg-red-950/50 text-red-400"><HeartPulse className="h-4 w-4" /></div>}
                value={avgHR != null ? Math.round(avgHR) : "—"}
                unit="bpm"
                foot={labelFor(heartRateDate ?? undefined)}
                to="/metrics/heart-rate"
                loading={loading.avgHR}
              />
              <StatCard
                title="Max Heart Rate"
                icon={<div className="bg-red-950/50 text-red-400"><HeartPulse className="h-4 w-4" /></div>}
                value={maxHR != null ? Math.round(maxHR) : "—"}
                unit="bpm"
                foot={labelFor(heartRateDate ?? undefined)}
                to="/metrics/heart-rate"
                loading={loading.maxHR}
              />
              <StatCard
                title="Min Heart Rate"
                icon={<div className="bg-red-950/50 text-red-400"><HeartPulse className="h-4 w-4" /></div>}
                value={minHR != null ? Math.round(minHR) : "—"}
                unit="bpm"
                foot={labelFor(heartRateDate ?? undefined)}
                to="/metrics/heart-rate"
                loading={loading.minHR}
              />
            </>
          ) : (
            <>
              <StatCard
                title="Resting Heart Rate (RHR)"
                icon={<div className="bg-red-950/50 text-red-400"><HeartPulse className="h-4 w-4" /></div>}
                value={restingHR ?? "—"}
                unit="bpm"
                to="/metrics/heart-rate"
                loading={loading.restingHR}
              />
              <StatCard
                title="Heart Rate Variability (HRV)"
                icon={<div className="bg-red-950/50 text-red-400"><HeartPulse className="h-4 w-4" /></div>}
                value={hrv ?? "—"}
                unit="ms"
                to="/metrics/hrv"
                loading={loading.hrv}
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
              loading={loading.ecg}
            />
          )}
        </section>
      </main>
    </div>
  );
}
