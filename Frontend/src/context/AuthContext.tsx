import { createContext, useContext, useEffect, useState } from "react";
import { tokens, providerStorage } from "@/lib/storage";
import { fetchProfile, refreshToken, revoke } from "@/lib/api";
import { getFitbitAuthUrl, getWithingsAuthUrl } from "@/lib/oauth"; // 👈 add this

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
  const [provider, setProvider] = useState<Provider>(providerStorage.get());
  const [isAuthenticated, setAuth] = useState(
    (!!tokens.getAccess() || !!tokens.getRefresh()) && !!provider
  );

  async function getAccessToken(): Promise<string | null> {
    const access = tokens.getAccess();
    if (access) return access;
    const refresh = tokens.getRefresh();
    if (!refresh) return null;

    try {
      const r = await refreshToken(refresh, provider);
      tokens.setAccess(r.access_token);
      if (r.refresh_token) tokens.setRefresh(r.refresh_token);
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
    if ((tokens.getAccess() || tokens.getRefresh()) && provider) loadProfile();
  }, [provider]);

  async function logout() {
    try {
      const access = tokens.getAccess();
      if (access && provider) await revoke(access, provider);
    } catch {
      // ignore
    } finally {
      tokens.clearAll();
      providerStorage.clear();
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
      providerStorage.set(nextProvider);
      setProvider(nextProvider);

      // 👉 Redirect depending on provider
      if (nextProvider === "fitbit") {
        const { authorization_url, state } = await getFitbitAuthUrl(scope);
        tokens.setState(state);
        window.location.href = authorization_url;
      } else if (nextProvider === "withings") {
        const { authorization_url, state } = await getWithingsAuthUrl(scope);
        tokens.setState(state);
        window.location.href = authorization_url;
      }
    } finally {
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
