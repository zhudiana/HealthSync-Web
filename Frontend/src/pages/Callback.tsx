import { useEffect, useState } from "react";
import { exchangeCode } from "@/lib/api";
import { tokens } from "@/lib/storage";
import { useNavigate } from "react-router-dom";

export default function Callback() {
  const [msg, setMsg] = useState("Completing sign-in…");
  const navigate = useNavigate();

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const code = qs.get("code");
    const state = qs.get("state");
    const err = qs.get("error");

    (async () => {
      try {
        if (err) throw new Error(`Authorization failed: ${err}`);
        if (!code || !state) throw new Error("Missing code/state");

        const expected = tokens.getState();
        if (expected && expected !== state) throw new Error("State mismatch");
        const data = await exchangeCode(code, state);

        tokens.setAccess(data.tokens.access_token);
        tokens.setRefresh(data.tokens.refresh_token);
        tokens.setUserId(data.tokens.user_id);
        tokens.clearState();

        setMsg("Success! Redirecting…");
        // Clean URL
        window.history.replaceState({}, document.title, "/dashboard");
        navigate("/dashboard");
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
