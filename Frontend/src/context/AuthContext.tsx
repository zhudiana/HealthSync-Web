import { createContext, useContext, useEffect, useState } from "react";
import { tokens } from "@/lib/storage";
import {
  fetchProfile,
  refreshToken,
  revoke,
  getFitbitAuthUrl,
  getWithingsAuthUrl,
} from "@/lib/api";

type Profile = any;
type Provider = "fitbit" | "withings" | null;

type AuthCtx = {
  isAuthenticated: boolean;
  provider: Provider;
  profile: Profile | null;
  loading: boolean;
  loginStart: (
    provider: Exclude<Provider, null>,
    scope?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const Ctx = createContext<AuthCtx>({
  isAuthenticated: false,
  provider: null,
  profile: null,
  loading: false,
  loginStart: async () => {},
  logout: async () => {},
  getAccessToken: async () => null,
});

export function useAuth() {
  return useContext(Ctx);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<Provider>(
    tokens.getActiveProvider()
  );
  const [isAuthenticated, setAuth] = useState(
    !!provider &&
      (!!tokens.getAccess(provider) || !!tokens.getRefresh(provider))
  );

  async function getAccessToken(): Promise<string | null> {
    if (!provider) return null;

    const access = tokens.getAccess(provider);
    if (access) return access;

    const refresh = tokens.getRefresh(provider);
    if (!refresh) return null;

    try {
      // Your API should accept the provider to hit the right backend route
      const r = await refreshToken(refresh, provider);
      tokens.setAccess(provider, r.access_token);
      if (r.refresh_token) tokens.setRefresh(provider, r.refresh_token);
      return r.access_token as string;
    } catch {
      return null;
    }
  }

  async function loadProfile() {
    if (!provider) return;

    const access = await getAccessToken();
    if (!access) {
      setAuth(false);
      setProfile(null);
      return;
    }

    try {
      const data = await fetchProfile(access, provider);
      setProfile(data?.user ?? null);
      setAuth(true);
    } catch {
      // If 401, try refresh once
      const refreshed = await getAccessToken();
      if (!refreshed) {
        setAuth(false);
        setProfile(null);
      } else {
        try {
          const data2 = await fetchProfile(refreshed, provider);
          setProfile(data2?.user ?? null);
          setAuth(true);
        } catch {
          setAuth(false);
          setProfile(null);
        }
      }
    }
  }

  useEffect(() => {
    if (
      provider &&
      (tokens.getAccess(provider) || tokens.getRefresh(provider))
    ) {
      loadProfile();
    }
  }, [provider]);

  async function logout() {
    try {
      if (provider) {
        const access = tokens.getAccess(provider);
        if (access) await revoke(access, provider);
      }
    } catch {
      // ignore
    } finally {
      if (provider) {
        tokens.clearAll(provider);
      }
      tokens.clearActiveProvider();
      setAuth(false);
      setProvider(null);
      setProfile(null);
    }
  }

  async function loginStart(
    nextProvider: Exclude<Provider, null>,
    scope?: string
  ) {
    setLoading(true);
    try {
      // one-at-a-time: clear the other provider
      const other: Exclude<Provider, null> =
        nextProvider === "fitbit" ? "withings" : "fitbit";
      tokens.clearAll(other);

      tokens.setActiveProvider(nextProvider);
      setProvider(nextProvider);

      if (nextProvider === "fitbit") {
        console.log("[OAuth] Fitbit → requesting auth URL…", { scope });
        const res = await getFitbitAuthUrl(
          scope ?? "activity heartrate profile sleep weight"
        );
        console.log("[OAuth] Fitbit → response from /fitbit/login:", res);

        const url = res?.authorization_url;
        const st = res?.state;
        if (!url) throw new Error("Fitbit: missing authorization_url");

        try {
          // tokens.setState(nextProvider, st ?? "");
        } catch (err) {
          console.error(
            "[OAuth] Fitbit → tokens.setState failed, continuing to redirect:",
            err
          );
        }

        // Try multiple navigation strategies to avoid any browser quirk
        try {
          console.log("[OAuth] Fitbit → redirecting via location.assign", url);
          window.location.assign(url);
          return;
        } catch (e1) {
          console.warn("[OAuth] assign failed, trying href", e1);
        }
        try {
          console.log("[OAuth] Fitbit → redirecting via location.href", url);
          window.location.href = url;
          return;
        } catch (e2) {
          console.warn("[OAuth] href failed, creating anchor fallback", e2);
        }

        // Final fallback: synthetic click
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        return;

        // prevent finally from toggling loading back too soon
      } else {
        console.log("[OAuth] Withings → requesting auth URL…", { scope });
        const res = await getWithingsAuthUrl(scope ?? "user.info,user.metrics");
        console.log("[OAuth] Withings → response from /withings/login:", res);
        if (
          !res ||
          typeof res.authorization_url !== "string" ||
          !res.authorization_url
        ) {
          throw new Error("Withings: missing authorization_url");
        }
        if (!res.state) {
          console.warn(
            "[OAuth] Withings → missing state; continuing but this may break callback"
          );
        }
        tokens.setState(nextProvider, res.state ?? "");
        console.log("[OAuth] Withings → redirecting to", res.authorization_url);
        window.location.href = res.authorization_url; // hard navigation
        return;
      }
    } catch (e) {
      console.error("[OAuth] loginStart error:", e);
      throw e; // let caller show error if needed
    } finally {
      // This runs only if we didn't hard-navigate
      setLoading(false);
    }
  }

  return (
    <Ctx.Provider
      value={{
        isAuthenticated,
        provider,
        profile,
        loading,
        loginStart,
        logout,
        getAccessToken,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
