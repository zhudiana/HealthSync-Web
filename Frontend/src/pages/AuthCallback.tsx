import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tokens } from "@/lib/storage";
import { exchangeCode } from "@/lib/api"; // calls GET /fitbit/callback?code=...&state=...

type Provider = "fitbit" | "withings";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finishing sign-in…");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        // If you pass provider in the redirect back to SPA, read it; otherwise default to fitbit for now
        const provider =
          (url.searchParams.get("provider") as Provider) || "fitbit";

        if (!code) {
          setMsg("Missing authorization code.");
          return;
        }
        if (!state) {
          setMsg("Missing state parameter.");
          return;
        }

        // Exchange the code on the backend (backend has the PKCE verifier stored from /fitbit/login)
        const data = await exchangeCode(code, state); // expects Fitbit for now
        // shape: { message, tokens: { access_token, refresh_token, user_id, ... }, user_id }

        const access = data?.tokens?.access_token;
        const refresh = data?.tokens?.refresh_token;
        const userId = data?.tokens?.user_id || data?.user_id;

        if (!access) {
          throw new Error("No access token returned from server.");
        }

        // Persist active provider and tokens (one-at-a-time model)
        tokens.setActiveProvider(provider);
        tokens.setAccess(provider, access);
        if (refresh) tokens.setRefresh(provider, refresh);
        if (userId) tokens.setUserId(provider, userId);

        setMsg("Connected! Redirecting to your dashboard…");
        // Small delay for UX, then navigate
        // setTimeout(() => navigate("/dashboard"), 400);
        setTimeout(() => {
          window.location.replace("/dashboard");
        }, 150);
      } catch (err: any) {
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
