import heroImage from "@/assets/healthsync-hero.jpg";
import AuthButton from "@/components/AuthButton";
import { useState } from "react";
import { getFitbitAuthUrl } from "@/lib/api";
import { tokens } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Index() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const auth = useAuth();
  const navigate = useNavigate();

  // Inject loginStart into context for other components if needed
  auth.loginStart = async (
    scope = "activity heartrate profile sleep weight"
  ) => {
    setErr(null);
    setLoading(true);
    try {
      const { authorization_url, state } = await getFitbitAuthUrl(scope);
      tokens.setState(state);
      window.location.href = authorization_url;
    } catch (e: any) {
      setErr(e?.message ?? "Failed to start OAuth");
    } finally {
      setLoading(false);
    }
  };

  if (auth.isAuthenticated) {
    navigate("/dashboard");
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
          Connect your Fitbit to view your health metrics in a personal
          dashboard.
        </p>

        {err && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-red-200">
            {err}
          </div>
        )}

        <AuthButton
          onClick={() => auth.loginStart()}
          disabled={loading}
          label={loading ? "Connecting..." : "Login with Fitbit"}
        />

        <p className="text-sm text-muted-foreground mt-12 opacity-70">
          Secure OAuth • Your data stays private
        </p>
      </div>
    </main>
  );
}
