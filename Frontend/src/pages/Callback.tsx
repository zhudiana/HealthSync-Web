import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangeWithingsCode } from "@/lib/api"; // << changed
import { tokens } from "@/lib/storage";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Completing sign-in…");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");

      try {
        if (err) throw new Error(`Authorization failed: ${err}`);
        if (!code || !state) throw new Error("Missing code/state");

        // optional state check (keep if you store state client-side)
        const expected = tokens.getState("withings");
        if (expected && expected !== state) throw new Error("State mismatch");

        const data = await exchangeWithingsCode(code, state);

        tokens.setActiveProvider("withings");
        tokens.setAccess("withings", data?.tokens?.access_token || "");
        if (data?.tokens?.refresh_token)
          tokens.setRefresh("withings", data.tokens.refresh_token);

        // ⬇️ save your app JWT for Authorization header
        const sessionJwt = data?.session?.token;
        if (!sessionJwt) throw new Error("Missing session token from backend");
        tokens.setSession(sessionJwt);

        tokens.clearState("withings");

        setMsg("Success! Redirecting…");

        // remove ?code=&state= and go dashboard
        window.history.replaceState({}, document.title, "/dashboard");
        navigate("/dashboard", { replace: true });
      } catch (e: any) {
        setMsg(e?.message ?? "Sign-in failed");
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center">
      <p className="text-lg">{msg}</p>
    </div>
  );
}
