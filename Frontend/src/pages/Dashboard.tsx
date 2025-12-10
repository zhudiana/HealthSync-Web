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
  Wind,
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
          <div className="flex items-center gap-2 text-zinc-300">
            {icon}
            <div className="text-sm font-medium text-zinc-300">{title}</div>
          </div>
          {pulse && (
            <span
              className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
              aria-hidden
            />
          )}
        </div>

        <div className="pt-0">
          <div className="flex items-end justify-between gap-4">
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
            {to && (
              <span
                className="text-xs text-zinc-500 opacity-0 group-hover:opacity-100 transition"
                aria-hidden
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
  const [respiratoryRate, setRespiratoryRate] = useState<number | null>(null);
  const [currentHR, setCurrentHR] = useState<number | null>(null);
  const [currentHRAge, setCurrentHRAge] = useState<number | null>(null);

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
      | "ecg"
      | "respiratoryRate"
      | "currentHR",
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
    respiratoryRate: true,
    currentHR: true,
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

            // Set weight from overview endpoint
            setWeight(ov.weight ?? null);
            setLoad("weight", false);
          } catch {
            setLoad("steps", false);
            setLoad("calories", false);
            setLoad("distance", false);
          }

          // Persist latest weight to database
          try {
            // Fetch today's weight and save it to DB
            const todayStr = ymd();
            await fitbitMetrics.weight(access, todayStr);
          } catch {
            // Silent fail - weight persistence is best-effort
          }

          // Persist latest distance to database
          try {
            // Fetch today's distance and save it to DB
            const todayStr = ymd();
            await fitbitMetrics.distance(access, todayStr);
          } catch {
            // Silent fail - distance persistence is best-effort
          }

          // Persist latest steps to database
          try {
            // Fetch today's steps and save it to DB
            const todayStr = ymd();
            await fitbitMetrics.steps(access, todayStr);
          } catch {
            // Silent fail - steps persistence is best-effort
          }

          // Persist latest calories to database
          try {
            // Fetch today's calories and save it to DB
            const todayStr = ymd();
            await fitbitMetrics.calories(access, todayStr);
          } catch {
            // Silent fail - calories persistence is best-effort
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

          // Persist latest sleep to database
          try {
            // Fetch today's sleep and save it to DB
            const todayStr = ymd();
            await fitbitMetrics.sleepToday(access, todayStr);
          } catch {
            // Silent fail - sleep persistence is best-effort
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

          // Persist latest SpO2 to database
          try {
            // Fetch today's SpO2 and save it to DB
            const todayStr = ymd();
            await fitbitMetrics.spo2NightlyToday(access, todayStr);
          } catch {
            // Silent fail - SpO2 persistence is best-effort
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

          // Persist latest temperature to database
          try {
            // Fetch today's temperature and save it to DB
            const todayStr = ymd();
            const tempResult = await fitbitMetrics.temperatureToday(
              access,
              todayStr
            );
            console.log("Temperature data:", tempResult);
          } catch (err) {
            // Silent fail - temperature persistence is best-effort
            console.error("Temperature persistence error:", err);
          }

          // Resting Heart Rate
          try {
            const hr = await fitbitMetrics.restingHR(access);
            if (mounted) {
              setRestingHR(hr.restingHeartRate ?? null);
            }
          } finally {
            setLoad("restingHR", false);
          }

          // Respiratory Rate
          try {
            const todayStr = ymd();
            const resp = await fitbitMetrics.respiratoryRate(
              access,
              todayStr,
              todayStr
            );
            if (mounted) {
              // Get the latest reading from the items array
              const latestReading = resp?.items?.[resp.items.length - 1];
              setRespiratoryRate(latestReading?.full_day_avg ?? null);
            }
          } finally {
            setLoad("respiratoryRate", false);
          }

          // Current/Latest Heart Rate
          try {
            const hr = await fitbitMetrics.latestHeartRate(access);
            if (mounted) {
              setCurrentHR(hr.bpm ?? null);
              setCurrentHRAge(hr.age_seconds ?? null);
            }
          } finally {
            setLoad("currentHR", false);
          }

          // Token info (optional)
          try {
            const i = await tokenInfo(access);
            if (mounted) setInfo(i);
          } catch {
            /* ignore */
          }

          setLoad("avgHR", false);
          setLoad("maxHR", false);
          setLoad("minHR", false);
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

          // Try to get ECG data with progressive fallback
          const endDate = ymd();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const startDate = ymd(thirtyDaysAgo);

          // First try with 30 days window
          withingsECG(access, startDate, endDate, "Europe/Rome", 1)
            .then(async (e) => {
              if (!mounted) return;

              if (e?.latest) {
                setEcgHR(e.latest.heart_rate ?? null);
                setEcgTime(e.latest.time_iso ?? null);
              } else {
                // If no data in last 30 days, try getting the latest reading without date constraints

                const latestData = await withingsECG(
                  access,
                  undefined,
                  undefined,
                  "Europe/Rome",
                  1
                );

                if (latestData?.latest) {
                  setEcgHR(latestData.latest.heart_rate ?? null);
                  setEcgTime(latestData.latest.time_iso ?? null);
                } else {
                  setEcgHR(null);
                  setEcgTime(null);
                }
              }
            })
            .catch((error) => {
              console.error("Error fetching ECG:", error);
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
            icon={<Gauge className="h-4 w-4" />}
            value={fmtKg(weight)}
            unit="kg"
            foot="Latest"
            to="/metrics/weight"
            loading={loading.weight}
          />

          <StatCard
            title="Distance"
            icon={<Activity className="h-4 w-4" />}
            value={distance != null ? Number(distance).toFixed(2) : "—"}
            unit="km"
            foot={labelFor(distanceDate)}
            to="/metrics/distance"
            loading={loading.distance}
          />

          <StatCard
            title="Steps"
            icon={<TrendingUp className="h-4 w-4" />}
            value={steps ?? "—"}
            unit={labelFor(stepsDate)}
            pulse
            to="/metrics/steps"
            loading={loading.steps}
          />

          {provider === "fitbit" ? (
            <>
              <StatCard
                title="Current Heart Rate"
                icon={<HeartPulse className="h-4 w-4" />}
                value={currentHR ?? "—"}
                unit="bpm"
                pulse
                to="/metrics/heart-rate"
                loading={loading.currentHR}
              />
              <StatCard
                title="Sleep (total)"
                icon={<Watch className="h-4 w-4" />}
                value={fmtHMFromHours(sleepHours)}
                to="/metrics/sleep"
                loading={loading.sleep}
              />
              <StatCard
                title="Calories"
                icon={<Activity className="h-4 w-4" />}
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
            icon={<Droplets className="h-4 w-4" />}
            value={fmtNumber(spo2, 1)}
            unit="%"
            foot={labelFor(spo2DateIso)}
            to="/metrics/spo2"
            loading={loading.spo2}
          />

          {/* Temperature with date in foot */}
          <StatCard
            title={tempLabel}
            icon={<Thermometer className="h-4 w-4" />}
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
                icon={<HeartPulse className="h-4 w-4" />}
                value={avgHR != null ? Math.round(avgHR) : "—"}
                unit="bpm"
                foot={labelFor(heartRateDate ?? undefined)}
                to="/metrics/heart-rate"
                loading={loading.avgHR}
              />
              <StatCard
                title="Max Heart Rate"
                icon={<HeartPulse className="h-4 w-4" />}
                value={maxHR != null ? Math.round(maxHR) : "—"}
                unit="bpm"
                foot={labelFor(heartRateDate ?? undefined)}
                to="/metrics/heart-rate"
                loading={loading.maxHR}
              />
              <StatCard
                title="Min Heart Rate"
                icon={<HeartPulse className="h-4 w-4" />}
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
                icon={<HeartPulse className="h-4 w-4" />}
                value={restingHR ?? "—"}
                unit="bpm"
                to="/metrics/heart-rate"
                loading={loading.restingHR}
              />
              <StatCard
                title="Heart Rate Variability (HRV)"
                icon={<HeartPulse className="h-4 w-4" />}
                value={hrv ?? "—"}
                unit="ms"
                to="/metrics/hrv"
                loading={loading.hrv}
              />
            </>
          )}

          {provider === "withings" ? (
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
          ) : (
            <StatCard
              title="Breathing Rate"
              icon={<Wind className="h-4 w-4" />}
              value={
                respiratoryRate != null
                  ? Number(respiratoryRate).toFixed(1)
                  : "—"
              }
              unit="breaths/min"
              foot="Daily Average"
              loading={loading.respiratoryRate}
            />
          )}
        </section>
      </main>
    </div>
  );
}
