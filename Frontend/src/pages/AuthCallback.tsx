// AuthCallback.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tokens } from "@/lib/storage";
import { exchangeFitbitCode, exchangeWithingsCode } from "@/lib/api"; // ✅ use POST /fitbit/exchange now

type Provider = "fitbit" | "withings";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finishing sign-in…");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // 1) Read params
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const provider = (tokens.getActiveProvider() as Provider) || "fitbit";

        if (!code) throw new Error("Missing authorization code.");
        if (!state) throw new Error("Missing state parameter.");

        // 2) Exchange on backend
        const data =
          provider === "withings"
            ? await exchangeWithingsCode(code, state)
            : await exchangeFitbitCode(code, state);

        // 3) Extract tokens (backend may nest under .tokens)
        const access = data?.tokens?.access_token ?? data?.access_token;
        const refresh = data?.tokens?.refresh_token ?? data?.refresh_token;
        const userId =
          data?.tokens?.user_id ??
          data?.user_id ??
          data?.tokens?.userid ??
          data?.userid;

        if (!access) throw new Error("No access token returned from server.");

        // 4) Persist client-side session (short-lived access; refresh optional)
        tokens.setActiveProvider(provider);
        tokens.setAccess(provider, access);
        if (refresh) tokens.setRefresh(provider, refresh);
        if (userId) tokens.setUserId(provider, String(userId));

        // 5) Clean the URL (remove code/state) to avoid leaking in history
        const clean = new URL(window.location.href);
        clean.searchParams.delete("code");
        clean.searchParams.delete("state");
        window.history.replaceState(null, "", clean.pathname);

        setMsg("Connected! Redirecting to your dashboard…");
        navigate("/dashboard", { replace: true });
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
