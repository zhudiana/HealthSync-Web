import heroImage from "@/assets/healthsync-hero.jpg";
import AuthButton from "@/components/AuthButton";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Index() {
  const [loading, setLoading] = useState<"fitbit" | "withings" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.isAuthenticated) {
      navigate("/dashboard");
    }
  }, [auth.isAuthenticated, navigate]);

  async function startFitbit() {
    setErr(null);
    setLoading("fitbit");
    try {
      // Default Fitbit scopes
      await auth.loginStart(
        "fitbit",
        "activity heartrate profile sleep weight"
      );
      // Redirect happens inside loginStart
    } catch (e: any) {
      setErr(e?.message ?? "Failed to start Fitbit OAuth");
      setLoading(null);
    }
  }

  async function startWithings() {
    setErr(null);
    setLoading("withings");
    try {
      // Default Withings scopes
      await auth.loginStart(
        "withings",
        "user.info,user.metrics,user.activity,user.sleepevents"
      );
      // Redirect happens inside loginStart
    } catch (e: any) {
      setErr(e?.message ?? "Failed to start Withings OAuth");
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-30 pointer-events-none"
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-b from-background/40 to-background/80" />
      <div className="relative z-10 text-center max-w-2xl mx-auto px-6">
        <h1 className="text-6xl md:text-7xl font-bold text-foreground mb-6 tracking-tight">
          Health<span className="text-primary">Sync</span>
        </h1>
        <p className="text-xl md:text-2xl text-muted-foreground mb-12 leading-relaxed">
          Connect your device to view your health metrics in a personal
          dashboard.
        </p>

        {err && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-red-200">
            {err}
          </div>
        )}

        <div className="flex flex-col gap-4 max-w-md mx-auto">
          <AuthButton
            onClick={startFitbit}
            disabled={!!loading}
            label={
              loading === "fitbit"
                ? "Connecting to Fitbit..."
                : "Login with Fitbit"
            }
          />
          <AuthButton
            onClick={startWithings}
            disabled={!!loading}
            label={
              loading === "withings"
                ? "Connecting to Withings..."
                : "Login with Withings"
            }
          />
        </div>

        <p className="text-sm text-muted-foreground mt-12 opacity-70">
          Secure OAuth • Your data stays private
        </p>
      </div>
    </main>
  );
}
