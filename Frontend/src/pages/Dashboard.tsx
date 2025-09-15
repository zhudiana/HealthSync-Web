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

  // NEW states
  // const [vo2max, setVo2max] = useState<number | null>(null); // NEW
  const [spo2, setSpo2] = useState<number | null>(null); // NEW
  const [hrv, setHrv] = useState<number | null>(null); // NEW
  // const [respRate, setRespRate] = useState<number | null>(null); // NEW
  const [tempVar, setTempVar] = useState<number | null>(null); // NEW
  // const [azm, setAzm] = useState<number | null>(null); // NEW
  const [distance, setDistance] = useState<number | null>(null);

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
          const ov = await metricsOverview(access); // Fitbit-only
          setSteps(ov.steps ?? null);
          setCalories(ov.caloriesOut ?? null);
          setRestingHR(ov.restingHeartRate ?? null);
          setSleepHours(ov.sleepHours ?? null);
          setWeight(ov.weight ?? null);
          setDistance(ov.total_km ?? null);

          try {
            const i = await tokenInfo(access); // Fitbit-only
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
            // SpO₂ (take latest percent)                           // NEW
            withingsSpO2(access)
              .then((s) => setSpo2(s?.latest?.percent ?? null)) // NEW
              .catch(() => setSpo2(null)); // NEW

            // Temperature: Withings returns body/skin absolute °C   // NEW
            // For your "Skin Temperature Variability" tile,         // NEW
            // show the latest available skin temp (or body temp).   // NEW
            withingsTemperature(access, today, today) // NEW
              .then((t) => {
                // NEW
                const item = t?.items?.[t.items.length - 1]; // NEW
                const skin = item?.skin_c ?? null; // NEW
                const body = item?.body_c ?? null; // NEW
                setTempVar(skin ?? body ?? null); // NEW
              }) // NEW
              .catch(() => setTempVar(null));
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
          setDistance(null); // NEW
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
          <MetricCard title="Distance" value={distance ?? "—"} sub="km" />
          <MetricCard title="Steps" value={steps ?? "—"} sub="today" />
          <MetricCard title="Calories" value={calories ?? "—"} sub="today" />
          <MetricCard
            title="Resting Heart Rate (RHR)"
            value={restingHR ?? "—"}
            sub="bpm"
          />
          <MetricCard title="Sleep" value={sleepHours ?? "—"} sub="hours" />

          {/* NEW extras */}
          {/* <MetricCard title="VO₂ Max" value={vo2max ?? "—"} sub="ml/kg/min" /> */}
          <MetricCard
            title="Blood Oxygen (SpO₂)"
            value={fmt(spo2, 1)}
            sub="%"
          />
          <MetricCard
            title="Heart Rate Variability (HRV)"
            value={hrv ?? "—"}
            sub="ms"
          />
          {/* <MetricCard title="Resp. Rate" value={respRate ?? "—"} sub="bpm" /> */}
          <MetricCard title={tempLabel} value={fmt(tempVar, 1)} sub="°C" />
          {/* <MetricCard title="AZM" value={azm ?? "—"} sub="min" /> */}
        </section>
      </main>
    </>
  );
}
