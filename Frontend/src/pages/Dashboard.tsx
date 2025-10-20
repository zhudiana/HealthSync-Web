import { useEffect, useState } from "react";
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
} from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Header from "@/components/Header";
import MetricCard from "@/components/MetricCard";
import { getUserByAuth, updateUserByAuth } from "@/lib/api";

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

  const [appUser, setAppUser] = useState<{
    display_name: string | null;
    email: string | null;
    auth_user_id?: string;
  } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

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

        const access = await getAccessToken();
        if (!access) {
          if (!mounted) return;
          setErr("Not authenticated");
          return;
        }

        // --- Load profile (provider-aware) ---
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

        // --- Metrics ---
        if (provider === "fitbit") {
          const ov = await metricsOverview(access);
          if (!mounted) return;

          setSteps(ov.steps ?? null);
          setCalories(ov.calories?.total ?? ov.caloriesOut ?? null);
          setRestingHR(ov.restingHeartRate ?? null);
          setWeight(ov.weight ?? null);
          setDistance(ov.total_km ?? null);

          // Sleep today; if empty, fallback to yesterday
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

          // HRV (daily RMSSD ms) – latest in a 2-day window
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
            const [w, d] = await Promise.all([
              withingsMetricsOverview(access),
              withingsMetricsDaily(access),
            ]);

            const latestW = await withingsWeightLatest(access);
            if (!mounted) return;

            setWeight(latestW.value ?? w.weightKg ?? null);
            setRestingHR(w.restingHeartRate ?? null);
            setSteps(d.steps ?? null);
            setCalories(d.calories ?? null);
            setSleepHours(d.sleepHours ?? null);
            setDistance(d.distanceKm ?? null);

            // ---- ECG ----
            const todayStr = ymd();
            withingsECG(access, todayStr, todayStr, "Europe/Rome", 1)
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

            // ---- SpO₂ ----
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

            // ---- Temperature ----
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

            // ---- Heart Rate ----
            try {
              let daily = await withingsHeartRateDaily(access, todayStr);
              if (
                daily?.hr_average == null &&
                daily?.hr_max == null &&
                daily?.hr_min == null
              ) {
                daily = await withingsHeartRateDaily(access, ymdYesterday());
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
