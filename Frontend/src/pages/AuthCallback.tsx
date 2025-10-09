import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tokens } from "@/lib/storage";
import { exchangeCode } from "@/lib/api"; // Fitbit: GET /fitbit/callback?code&state
import { exchangeWithingsCode } from "@/lib/api"; // We'll add this in api.ts (Step 3)

type Provider = "fitbit" | "withings";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finishing sign-in…");
  const navigate = useNavigate();

  useEffect(() => {
    // Remove trailing hash some providers append
    if (window.location.hash && window.location.hash !== "#") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const provider = (tokens.getActiveProvider() as Provider) || "fitbit";

        if (!code) throw new Error("Missing authorization code.");
        if (!state) throw new Error("Missing state parameter.");

        let data: any;
        if (provider === "withings") {
          // Withings: SPA exchanges code via /withings/exchange
          data = await exchangeWithingsCode(code, state);
        } else {
          // Fitbit: backend GET /fitbit/callback does the exchange
          data = await exchangeCode(code, state);
        }

        const sessionJwt = data?.session?.token;
        if (sessionJwt) {
          tokens.setSession(sessionJwt);
          tokens.clearState("withings");
        }

        const access = data?.tokens?.access_token ?? data?.access_token;
        const refresh = data?.tokens?.refresh_token ?? data?.refresh_token;
        const userId =
          data?.tokens?.user_id ??
          data?.user_id ??
          data?.tokens?.userid ??
          data?.userid;

        if (!access) throw new Error("No access token returned from server.");

        tokens.setActiveProvider(provider);
        tokens.setAccess(provider, access);
        if (refresh) tokens.setRefresh(provider, refresh);
        if (userId) tokens.setUserId(provider, String(userId));

        setMsg("Connected! Redirecting to your dashboard…");
        setTimeout(() => {
          // hard replace so context re-reads storage immediately
          window.location.replace("/dashboard");
        }, 150);
      } catch (err: any) {
        console.error("[AuthCallback] error:", err);
        setMsg(`OAuth failed: ${err?.message || "Unknown error"}`);
      }
    })();
  }, [navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">{msg}</p>
    </main>
  );
}
