import { useEffect, useState } from "react";
import { fetchProfile, tokenInfo, metricsOverview } from "@/lib/api"; // import
import { useAuth } from "@/context/AuthContext";
import Header from "@/components/Header";
import MetricCard from "@/components/MetricCard";

export default function Dashboard() {
  const { getAccessToken, profile: ctxProfile } = useAuth();
  const [profile, setProfile] = useState<any>(ctxProfile);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const [steps, setSteps] = useState<number | null>(null);
  const [restingHR, setRestingHR] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [calories, setCalories] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const access = await getAccessToken();
        if (!access) {
          setErr("Not authenticated");
          return;
        }
        const p = profile ?? (await fetchProfile(access)).user;
        setProfile(p);

        const ov = await metricsOverview(access); // today by default
        setSteps(ov.steps ?? null);
        setCalories(ov.caloriesOut ?? null);
        setRestingHR(ov.restingHeartRate ?? null);
        setSleepHours(ov.sleepHours ?? null);
        setWeight(ov.weight ?? null);

        try {
          const i = await tokenInfo(access);
          setInfo(i);
        } catch {}
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load data");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    profile?.displayName || profile?.fullName?.trim() || "Fitbit User";

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
          <MetricCard title="Steps" value={steps ?? "—"} sub="today" />
          <MetricCard title="Calories" value={calories ?? "—"} sub="today" />
          <MetricCard title="Resting HR" value={restingHR ?? "—"} sub="bpm" />
          <MetricCard title="Sleep" value={sleepHours ?? "—"} sub="hours" />
          <MetricCard title="Weight" value={weight ?? "—"} sub="kg" />
        </section>

        {/* <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 p-4">
            <h3 className="text-xl font-semibold mb-2">Profile</h3>
            <pre className="text-sm overflow-auto">
              {JSON.stringify(profile, null, 2)}
            </pre>
          </div>

          {info && (
            <div className="rounded-2xl border border-white/10 p-4">
              <h3 className="text-xl font-semibold mb-2">Token Info</h3>
              <pre className="text-sm overflow-auto">
                {JSON.stringify(info, null, 2)}
              </pre>
            </div>
          )}
        </section> */}
      </main>
    </>
  );
}
