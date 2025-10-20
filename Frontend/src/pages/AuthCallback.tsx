import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tokens } from "@/lib/storage";
import { exchangeCode } from "@/lib/api"; // Fitbit: GET /fitbit/callback?code&state
import { exchangeWithingsCode } from "@/lib/api"; // Withings: POST /withings/exchange

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

        // Prefer explicit ?provider=... in URL; else fall back to stored choice; else default fitbit
        const providerFromUrl = url.searchParams.get(
          "provider"
        ) as Provider | null;
        const providerStored =
          (tokens.getActiveProvider() as Provider | null) || null;
        let provider: Provider = (providerFromUrl ||
          providerStored ||
          "fitbit") as Provider;

        if (!code) throw new Error("Missing authorization code.");
        if (!state) throw new Error("Missing state parameter.");

        // Call the appropriate exchange endpoint (with a safe fallback)
        let data: any | null = null;
        if (provider === "withings") {
          data = await exchangeWithingsCode(code, state);
        } else {
          // provider === "fitbit"
          try {
            data = await exchangeCode(code, state);
          } catch (e) {
            // If Fitbit exchange fails but this was actually a Withings callback,
            // try Withings as a fallback.
            try {
              data = await exchangeWithingsCode(code, state);
              provider = "withings";
            } catch {
              throw e; // rethrow original Fitbit error if Withings also fails
            }
          }
        }

        // Be tolerant to different backend shapes
        // - old Fitbit: { access_token, refresh_token, user_id }
        // - Withings (yours): { withings: { access_token, refresh_token, userid } } OR { tokens: {...} }
        // - direct Withings body: { body: { access_token, refresh_token, userid } }
        const access =
          data?.tokens?.access_token ??
          data?.access_token ??
          data?.withings?.access_token ??
          data?.body?.access_token;

        const refresh =
          data?.tokens?.refresh_token ??
          data?.refresh_token ??
          data?.withings?.refresh_token ??
          data?.body?.refresh_token;

        const userId =
          data?.tokens?.user_id ??
          data?.user_id ??
          data?.tokens?.userid ??
          data?.userid ??
          data?.withings?.userid ??
          data?.body?.userid;

        // Optional app session JWT (keep supporting it if backend still returns it)
        const sessionJwt = data?.session?.token;
        if (sessionJwt) {
          tokens.setSession(sessionJwt);
        }

        if (!access) {
          // Helpful hint for diagnosing provider mismatch during early testing
          throw new Error("No access token returned from server.");
        }

        // Persist credentials
        tokens.setActiveProvider(provider);
        tokens.setAccess(provider, String(access));
        if (refresh) tokens.setRefresh(provider, String(refresh));
        if (userId != null) tokens.setUserId(provider, String(userId));

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
