// AuthCallback.tsx (drop-in replacement)
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangeWithingsCode } from "@/lib/api";
// optional: import getMe if you add /auth/me on backend
// import { getMe } from "@/lib/api";

declare global {
  interface Window {
    __hs_exchange_done?: boolean;
  }
}

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finishing sign-in…");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // prevent double POST if React re-mounts
      if (window.__hs_exchange_done) return;
      window.__hs_exchange_done = true;

      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code) throw new Error("Missing authorization code.");
        if (!state) throw new Error("Missing state parameter.");

        // Backend sets HttpOnly cookies; body is just { ok: true }
        await exchangeWithingsCode(code, state);

        // Clean query so refresh doesn't replay
        const clean = new URL(window.location.href);
        clean.searchParams.delete("code");
        clean.searchParams.delete("state");
        window.history.replaceState({}, "", clean.pathname);

        // Optional: verify cookie/session
        // const me = await getMe(); console.log("Signed in as", me);

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
