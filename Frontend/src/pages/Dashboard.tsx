import { useEffect, useState } from "react";
import {
  fetchProfile,
  tokenInfo,
  metricsOverview,
  withingsMetricsOverview,
  withingsMetricsDaily,
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
  const [vo2max, setVo2max] = useState<number | null>(null); // NEW
  const [spo2, setSpo2] = useState<number | null>(null); // NEW
  const [hrv, setHrv] = useState<number | null>(null); // NEW
  const [respRate, setRespRate] = useState<number | null>(null); // NEW
  const [tempVar, setTempVar] = useState<number | null>(null); // NEW
  const [azm, setAzm] = useState<number | null>(null); // NEW
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
          } catch (e) {
            // keep placeholders if it fails
            setWeight(null);
            setRestingHR(null);
            setSteps(null);
            setCalories(null);
            setSleepHours(null);
          }

          setInfo(null);
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
          <MetricCard title="Steps" value={steps ?? "—"} sub="today" />
          <MetricCard title="Calories" value={calories ?? "—"} sub="today" />
          <MetricCard
            title="Resting Heart Rate (RHR)"
            value={restingHR ?? "—"}
            sub="bpm"
          />
          <MetricCard title="Sleep" value={sleepHours ?? "—"} sub="hours" />
          <MetricCard title="Weight" value={weight ?? "—"} sub="kg" />

          {/* NEW extras */}
          <MetricCard title="VO₂ Max" value={vo2max ?? "—"} sub="ml/kg/min" />
          <MetricCard title="Blood Oxygen (SpO₂)" value={spo2 ?? "—"} sub="%" />
          <MetricCard
            title="Heart Rate Variability (HRV)"
            value={hrv ?? "—"}
            sub="ms"
          />
          <MetricCard title="Resp. Rate" value={respRate ?? "—"} sub="bpm" />
          <MetricCard title="Skin Temp" value={tempVar ?? "—"} sub="Δ °C" />
          <MetricCard title="AZM" value={azm ?? "—"} sub="min" />
          <MetricCard title="Distance" value={distance ?? "—"} sub="km" />
        </section>
      </main>
    </>
  );
}
