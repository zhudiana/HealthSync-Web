type Provider = "fitbit" | "withings";

const makeKeys = (provider: Provider) => ({
  access: `${provider}_access_token`,
  refresh: `${provider}_refresh_token`,
  userId: `${provider}_user_id`,
  oauthState: `${provider}_oauth_state`,
});

const PROVIDER_KEY = "active_provider";
const SESSION_KEY = "hs_session";

export const tokens = {
  getActiveProvider: (): Provider | null =>
    localStorage.getItem(PROVIDER_KEY) as Provider | null,
  setActiveProvider: (p: Provider) => localStorage.setItem(PROVIDER_KEY, p),
  clearActiveProvider: () => localStorage.removeItem(PROVIDER_KEY),

  getAccess: (provider: Provider) =>
    localStorage.getItem(makeKeys(provider).access),
  setAccess: (provider: Provider, v: string) =>
    localStorage.setItem(makeKeys(provider).access, v),

  getRefresh: (provider: Provider) =>
    localStorage.getItem(makeKeys(provider).refresh),
  setRefresh: (provider: Provider, v: string) =>
    localStorage.setItem(makeKeys(provider).refresh, v),

  getUserId: (provider: Provider) =>
    localStorage.getItem(makeKeys(provider).userId),
  setUserId: (provider: Provider, v: string) =>
    localStorage.setItem(makeKeys(provider).userId, v),

  getSession: () => localStorage.getItem(SESSION_KEY),
  setSession: (jwt: string) => localStorage.setItem(SESSION_KEY, jwt),
  clearSession: () => localStorage.removeItem(SESSION_KEY),

  clearAll: (provider: Provider) => {
    const keys = makeKeys(provider);
    localStorage.removeItem(keys.access);
    localStorage.removeItem(keys.refresh);
    localStorage.removeItem(keys.userId);
    localStorage.removeItem(keys.oauthState);
  },

  getState: (provider: Provider) =>
    localStorage.getItem(makeKeys(provider).oauthState),
  setState: (provider: Provider, v: string) =>
    localStorage.setItem(makeKeys(provider).oauthState, v),
  clearState: (provider: Provider) =>
    localStorage.removeItem(makeKeys(provider).oauthState),
};
