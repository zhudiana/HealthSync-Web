import { useEffect, useState } from "react";
import {
  fetchProfile,
  tokenInfo,
  metricsOverview,
  withingsMetricsOverview,
  withingsMetricsDaily,
  withingsSpO2, // NEW
  withingsTemperature, // NEW
  withingsHeartRate,
  withingsHeartRateDaily, // NEW
  withingsHeartRateIntraday,
  metrics as fitbitMetrics,
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
  const [spo2, setSpo2] = useState<number | null>(null); // NEW
  const [hrv, setHrv] = useState<number | null>(null); // NEW
  const [tempVar, setTempVar] = useState<number | null>(null); // NEW
  const [distance, setDistance] = useState<number | null>(null);
  const [avgHR, setAvgHR] = useState<number | null>(null); // NEW
  const [hrUpdatedAt, setHrUpdatedAt] = useState<number | null>(null); // NEW (epoch seconds)
  const [nowHR, setNowHR] = useState<number | null>(null); // NEW (intraday latest)

  // NEW states
  // const [vo2max, setVo2max] = useState<number | null>(null); // NEW
  // const [respRate, setRespRate] = useState<number | null>(null); // NEW
  // const [azm, setAzm] = useState<number | null>(null); // NEW

  useEffect(() => {
    (async () => {
      try {
        if (!provider) {
          setErr("No provider selected.");
          return;
        }

        const access = await getAccessToken();
        if (!access) {
          setErr("Not authenticated");
          return;
        }

        // --- Load profile (provider-aware) ---
        try {
          const profResp = await fetchProfile(access, provider);
          const p = provider === "fitbit" ? profResp?.user : profResp;
          setProfile(
            p ?? {
              fullName: provider === "withings" ? "Withings User" : "User",
            }
          );
        } catch {
          // For Withings, don't fail hard if profile endpoint errors; use placeholder
          if (provider === "withings") {
            setProfile({ fullName: "Withings User" });
          } else {
            throw new Error("Failed to load profile");
          }
        }

        // --- Metrics ---
        if (provider === "fitbit") {
          const ov = await metricsOverview(access);
          setSteps(ov.steps ?? null);
          setCalories(ov.calories?.total ?? ov.caloriesOut ?? null);
          setRestingHR(ov.restingHeartRate ?? null);
          setWeight(ov.weight ?? null);
          setDistance(ov.total_km ?? null);

          let sleep = await fitbitMetrics.sleep(access);
          let totalHours = sleep?.hoursAsleep ?? null;

          if (!totalHours || totalHours === 0) {
            const y = new Date();
            y.setDate(y.getDate() - 1);
            const ymd = y.toISOString().slice(0, 10);
            const s2 = await fitbitMetrics.sleep(access, ymd);
            totalHours = s2?.hoursAsleep ?? null;
          }
          setSleepHours(totalHours);

          // --- Fitbit extras ---
          const today = new Date();
          const ymd = (d: Date) => d.toISOString().slice(0, 10);
          const start = ymd(
            new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
          );
          const end = ymd(today);

          // HRV (daily RMSSD ms) – pick latest in the range
          try {
            const h = await fitbitMetrics.hrv(access, start, end);
            const latest = [...(h?.items ?? [])]
              .filter((it) => typeof it.rmssd_ms === "number")
              .sort((a, b) => (a.date < b.date ? -1 : 1))
              .pop();
            setHrv(latest?.rmssd_ms ?? null);
          } catch {
            setHrv(null);
          }

          // SpO₂ nightly (avg % for 'end' date)
          // try {
          //   const s = await fitbitMetrics.spo2Nightly(access, end);
          //   setSpo2(s?.average ?? null);
          // } catch {
          //   setSpo2(null);
          // }
          try {
            const today = new Date();
            const ymd = (d: Date) => d.toISOString().slice(0, 10);
            const todayStr = ymd(today);

            let s = await fitbitMetrics.spo2Nightly(access, todayStr);
            let avg = s?.average ?? null;

            if (avg == null) {
              const y = new Date();
              y.setDate(y.getDate() - 1);
              s = await fitbitMetrics.spo2Nightly(access, ymd(y));
              avg = s?.average ?? null;
            }
            setSpo2(avg);
          } catch {
            setSpo2(null);
          }

          // Skin temperature variability (nightlyRelative °C)
          try {
            const t = await fitbitMetrics.temperature(access, end, end);
            const last = t?.items?.[t.items.length - 1];
            setTempVar(last?.delta_c ?? null);
          } catch {
            setTempVar(null);
          }

          try {
            const i = await tokenInfo(access);
            setInfo(i);
          } catch {}
        } else {
          try {
            const [w, d] = await Promise.all([
              withingsMetricsOverview(access),
              withingsMetricsDaily(access),
            ]);

            setWeight(w.weightKg ?? null);
            setRestingHR(w.restingHeartRate ?? null);
            setSteps(d.steps ?? null);
            setCalories(d.calories ?? null);
            setSleepHours(d.sleepHours ?? null);
            setDistance(d.distanceKm ?? null);

            // ---- NEW: Withings extras (SpO2 + Temperature) ----
            const today = new Date().toISOString().slice(0, 10); // NEW
            withingsSpO2(access)
              .then((s) => setSpo2(s?.latest?.percent ?? null)) // NEW
              .catch(() => setSpo2(null)); // NEW

            withingsTemperature(access, today, today) // NEW
              .then((t) => {
                // NEW
                const item = t?.items?.[t.items.length - 1]; // NEW
                const skin = item?.skin_c ?? null; // NEW
                const body = item?.body_c ?? null; // NEW
                setTempVar(skin ?? body ?? null); // NEW
              }) // NEW
              .catch(() => setTempVar(null));

            // ---- NEW: Withings Heart Rate (Daily avg + Intraday latest) ----
            try {
              // Daily average for today; if null, fallback to yesterday
              const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
              const ymdYesterday = () => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                return ymd(d);
              };
              const todayYmd = ymd();
              let daily = await withingsHeartRateDaily(access, todayYmd);
              if (daily?.hr_average == null) {
                daily = await withingsHeartRateDaily(access, ymdYesterday());
              }
              setAvgHR(daily?.hr_average ?? null);
              setHrUpdatedAt(daily?.updatedAt ?? null);
            } catch {
              setAvgHR(null);
              setHrUpdatedAt(null);
            }
            try {
              const intra = await withingsHeartRateIntraday(
                access,
                new Date().toISOString().slice(0, 10)
              );
              setNowHR(intra?.latest?.bpm ?? null);
            } catch {
              setNowHR(null);
            }
          } catch (e) {
            // keep placeholders if it fails
            setWeight(null);
            setRestingHR(null);
            setSteps(null);
            setCalories(null);
            setSleepHours(null);
            setSpo2(null);
            setTempVar(null);
          }

          setInfo(null);
          // HRV (Withings) not broadly available -> keep as dash
          setHrv(null); // NEW
          // Distance not provided here -> keep null (dash)
          // setDistance(null); // NEW
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load data");
      }
    })();
    // re-run when provider changes
  }, [provider, getAccessToken]);

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

  const fmt = (n: number | null | undefined, dp = 1) =>
    n == null ? "—" : Number(n).toFixed(dp);

  const tempLabel =
    provider === "withings"
      ? "Skin Temperature"
      : "Skin Temperature Variability";

  const fmtTimeHM = (epochSec?: number | null) =>
    epochSec || epochSec === 0
      ? new Date(epochSec * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
  const ymdYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return ymd(d);
  };

  const fmtHMFromHours = (h?: number | null) => {
    if (h == null) return "—";
    const total = Math.round(h * 60); // convert to minutes, avoid 14.599999…
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${hh}h ${mm}m`;
  };

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

        {/* Fitbit metrics only for now; Withings shows placeholders */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Weight" value={weight ?? "—"} sub="kg" />
          <MetricCard
            title="Distance"
            value={distance != null ? distance.toFixed(2) : "—"}
            sub="km"
          />
          <MetricCard title="Steps" value={steps ?? "—"} sub="today" />
          <MetricCard title="Calories" value={calories ?? "—"} sub="today" />
          <MetricCard
            title="Sleep (total)"
            value={fmtHMFromHours(sleepHours) ?? "—"}
            sub=""
          />
          <MetricCard
            title="Blood Oxygen (SpO₂)"
            value={fmt(spo2, 1)}
            sub="%"
          />
          <MetricCard title={tempLabel} value={fmt(tempVar, 1)} sub="°C" />

          {provider === "withings" ? (
            <>
              <MetricCard
                title="Average Heart Rate"
                value={avgHR != null ? Math.round(avgHR) : "—"}
                sub="bpm"
              />
              {/* <MetricCard
                title="Heart Rate (Now)"
                value={nowHR != null ? Math.round(nowHR) : "—"}
                sub="bpm"
              /> */}
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

          {/* <MetricCard title="Resp. Rate" value={respRate ?? "—"} sub="bpm" /> */}
          {/* <MetricCard title="AZM" value={azm ?? "—"} sub="min" /> */}
        </section>
      </main>
    </>
  );
}
