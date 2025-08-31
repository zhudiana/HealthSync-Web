import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL as string; // e.g. http://localhost:8000

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finishing sign-in...");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code) {
          setMsg("Missing authorization code.");
          return;
        }

        const expectedState = sessionStorage.getItem("oauth_state");
        if (!state || !expectedState || state !== expectedState) {
          setMsg("Invalid state. Please start the sign-in again.");
          return;
        }
        sessionStorage.removeItem("oauth_state");

        const verifier = sessionStorage.getItem("fitbit_code_verifier");
        if (!verifier) {
          setMsg("Missing PKCE verifier. Please start the sign-in again.");
          return;
        }

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const res = await fetch(`${API_BASE}/fitbit/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier, state }),
          signal: controller.signal,
        }).catch((e) => {
          throw new Error(
            e?.name === "AbortError"
              ? "Request timed out."
              : e?.message || "Network error."
          );
        });
        clearTimeout(id);

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          // Backend forwards Fitbit error details in `detail`
          const reason =
            (data?.detail && JSON.stringify(data.detail)) ||
            data?.error_description ||
            data?.error ||
            res.statusText ||
            "OAuth failed.";
          throw new Error(reason);
        }

        // Clear PKCE verifier after successful exchange
        sessionStorage.removeItem("fitbit_code_verifier");
        setMsg("Fitbit connected! Redirecting to your dashboard...");
        // Small delay for UX, then navigate
        setTimeout(() => navigate("/dashboard"), 800);
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
