import { useEffect, useState, useRef } from "react";
import {
  fetchProfile,
  tokenInfo,
  metricsOverview,
  metrics as fitbitMetrics,
  withingsMetricsOverview,
  withingsMetricsDaily,
  withingsSpO2,
  withingsTemperature,
  withingsHeartRateDaily,
  withingsWeightLatest,
  withingsECG,
} from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Header from "@/components/Header";
import MetricCard from "@/components/MetricCard";

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
  const [hrUpdatedAt, setHrUpdatedAt] = useState<number | null>(null);
  const [maxHR, setMaxHR] = useState<number | null>(null);
  const [minHR, setMinHR] = useState<number | null>(null);

  const [ecgHR, setEcgHR] = useState<number | null>(null);
  const [ecgTime, setEcgTime] = useState<string | null>(null);

  // Single-flight guard for /withings/metrics/daily
  const dailyInFlightRef = useRef<Promise<any> | null>(null);

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

  // Single-flight helper for Withings daily call
  async function fetchWithingsDailyOnce() {
    if (!dailyInFlightRef.current) {
      dailyInFlightRef.current = withingsMetricsDaily()
        .then((d) => {
          if (!d) return null;
          setSteps(d.steps ?? null);
          setCalories(d.calories ?? null);
          setSleepHours(d.sleepHours ?? null);
          setDistance(d.distanceKm ?? null);
          return d;
        })
        .catch((e) => {
          console.error("[Dash] daily error:", e);
          return null;
        })
        .finally(() => {
          // brief cooldown to avoid Withings “same arguments in <10s”
          setTimeout(() => {
            dailyInFlightRef.current = null;
          }, 12_000);
        });
    }
    await dailyInFlightRef.current;
  }

  // ---------- initial load ----------

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!provider) {
          if (mounted) setErr("No provider selected.");
          return;
        }

        // We still need an access token for Fitbit profile + metrics.
        // For Withings, API calls are JWT-only on your server now.
        const access = await getAccessToken();
        if (!access && provider === "fitbit") {
          if (mounted) setErr("Not authenticated");
          return;
        }

        // --- Load profile (provider-aware) ---
        try {
          if (provider === "fitbit") {
            const profResp = await fetchProfile(access as string, "fitbit");
            if (mounted) setProfile(profResp?.user ?? null);
          } else {
            const profResp = await fetchProfile(access as string, "withings");
            if (mounted) setProfile(profResp ?? { fullName: "Withings User" });
          }
        } catch {
          if (!mounted) return;
          if (provider === "withings") {
            setProfile({ fullName: "Withings User" });
          } else {
            throw new Error("Failed to load profile");
          }
        }

        // --- Metrics ---
        if (provider === "fitbit") {
          const ov = await metricsOverview(access as string);
          if (!mounted) return;

          setSteps(ov.steps ?? null);
          setCalories(ov.calories?.total ?? ov.caloriesOut ?? null);
          setRestingHR(ov.restingHeartRate ?? null);
          setWeight(ov.weight ?? null);
          setDistance(ov.total_km ?? null);

          // Sleep today; fallback to yesterday if needed
          let sleep = await fitbitMetrics.sleep(access as string);
          let totalHours = sleep?.hoursAsleep ?? null;
          if (!totalHours || totalHours === 0) {
            const s2 = await fitbitMetrics.sleep(
              access as string,
              ymdYesterday()
            );
            totalHours = s2?.hoursAsleep ?? null;
          }
          if (mounted) setSleepHours(totalHours);

          // HRV (daily RMSSD ms)
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
            const h = await fitbitMetrics.hrv(access as string, start, end);
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
            let s = await fitbitMetrics.spo2Nightly(access as string, todayStr);
            let avg = s?.average ?? null;
            if (avg == null) {
              s = await fitbitMetrics.spo2Nightly(
                access as string,
                ymdYesterday()
              );
              avg = s?.average ?? null;
            }
            if (mounted) setSpo2(avg);
          } catch {
            if (mounted) setSpo2(null);
          }

          // Skin temperature variability
          try {
            const endStr = ymd();
            const t = await fitbitMetrics.temperature(
              access as string,
              endStr,
              endStr
            );
            if (mounted) {
              const last = t?.items?.[t.items.length - 1];
              setTempVar(last?.delta_c ?? null);
            }
          } catch {
            if (mounted) setTempVar(null);
          }

          // Token info (optional)
          try {
            const i = await tokenInfo(access as string);
            if (mounted) setInfo(i);
          } catch {
            /* ignore */
          }
        } else {
          // WITHINGS (JWT-only to backend)
          try {
            const w = await withingsMetricsOverview();
            const latestW = await withingsWeightLatest();
            if (mounted) {
              setWeight(latestW.value ?? w.weightKg ?? null);
            }

            // Daily snapshot (single-flight)
            await fetchWithingsDailyOnce();

            // ECG (latest for today)
            const todayStr = ymd();
            withingsECG(todayStr, todayStr, "Europe/Rome", 1)
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

            // SpO₂ (latest)
            withingsSpO2()
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

            // Body temperature (today)
            withingsTemperature(todayStr, todayStr)
              .then((t) => {
                if (!mounted) return;
                const item = t?.latest;
                const body = item?.body_c ?? null;
                // (keep skin_c support if your API returns it)
                const skin = (item as any)?.skin_c ?? null;
                setTempVar(body ?? skin ?? null);
                setTempUpdatedAt(item?.ts ?? null);
              })
              .catch(() => {
                if (mounted) {
                  setTempVar(null);
                  setTempUpdatedAt(null);
                }
              });

            // Heart rate daily (avg/min/max). Fallback to yesterday if empty.
            try {
              let daily = await withingsHeartRateDaily(todayStr);
              if (
                daily?.hr_average == null &&
                daily?.hr_max == null &&
                daily?.hr_min == null
              ) {
                daily = await withingsHeartRateDaily(ymdYesterday());
              }
              if (mounted) {
                setAvgHR(daily?.hr_average ?? null);
                setMaxHR(daily?.hr_max ?? null);
                setMinHR(daily?.hr_min ?? null);
                setHrUpdatedAt(daily?.updatedAt ?? null);
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
        if (mounted) setErr(e?.message ?? "Failed to load data");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [provider]);

  // ---------- render ----------
  if (err) {
    return (
      <>
        <Header />
        <div className="min-h-[calc(100vh-56px)] grid place-items-center px-4">
          <div className="max-w-lg w-full p-6 rounded-xl border border-white/10">
            <p className="mb-4">Error: {err}</p>
          </div>
        </div>
      </>
    );
  }

  const greetName =
    profile?.displayName ||
    profile?.fullName?.trim() ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    "User";

  const tempLabel =
    provider === "withings" ? "Body Temperature" : "Skin Temperature Variation";

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
        <section className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
            Dashboard
          </h2>
          <p className="text-muted-foreground">
            Welcome back, {greetName}. Here’s a snapshot of your health today.
          </p>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Weight" value={fmtKg(weight)} sub="kg" />

          <MetricCard
            title="Distance"
            value={distance != null ? Number(distance).toFixed(2) : "—"}
            sub="km"
          />

          <MetricCard title="Steps" value={steps ?? "—"} sub="today" />

          {provider === "fitbit" ? (
            <>
              <MetricCard
                title="Sleep (total)"
                value={fmtHMFromHours(sleepHours)}
                sub=""
              />
              <MetricCard
                title="Calories"
                value={calories ?? "—"}
                sub="today"
              />
            </>
          ) : null}

          {provider === "withings" ? (
            <MetricCard
              title="Oxygen Saturation (SpO₂)"
              value={fmtNumber(spo2, 1)}
              sub={spo2UpdatedAt ? `% • ${fmtTimeHM(spo2UpdatedAt)}` : "%"}
            />
          ) : (
            <MetricCard
              title="Blood Oxygen (SpO₂)"
              value={fmtNumber(spo2, 1)}
              sub="%"
            />
          )}

          <MetricCard
            title={tempLabel}
            value={fmtNumber(tempVar, 1)}
            sub={tempUpdatedAt ? `°C • ${fmtTimeHM(tempUpdatedAt)}` : "°C"}
          />

          {provider === "withings" ? (
            <>
              <MetricCard
                title="Average Heart Rate"
                value={avgHR != null ? Math.round(avgHR) : "—"}
                sub={hrUpdatedAt ? `bpm • ${fmtTimeHM(hrUpdatedAt)}` : "bpm"}
              />
              <MetricCard
                title="Max Heart Rate (Today)"
                value={maxHR != null ? Math.round(maxHR) : "—"}
                sub="bpm"
              />
              <MetricCard
                title="Min Heart Rate (Today)"
                value={minHR != null ? Math.round(minHR) : "—"}
                sub="bpm"
              />
            </>
          ) : (
            <>
              <MetricCard
                title="Resting Heart Rate (RHR)"
                value={restingHR ?? "—"}
                sub="bpm"
              />
              <MetricCard
                title="Heart Rate Variability (HRV)"
                value={hrv ?? "—"}
                sub="ms"
              />
            </>
          )}

          {provider === "withings" && (
            <MetricCard
              title="ECG (Latest)"
              value={ecgHR != null ? Math.round(ecgHR) : "—"}
              sub={
                ecgTime
                  ? `bpm • ${new Date(ecgTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "bpm"
              }
            />
          )}
        </section>
      </main>
    </>
  );
}
