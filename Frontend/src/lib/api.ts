const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function getFitbitAuthUrl(scope: string) {
  const res = await fetch(
    `${API_BASE_URL}/fitbit/login?scope=${encodeURIComponent(scope)}`
  );
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return res.json() as Promise<{ authorization_url: string; state: string }>;
}

export async function exchangeCode(code: string, state: string) {
  const url = `${API_BASE_URL}/fitbit/callback?code=${encodeURIComponent(
    code
  )}&state=${encodeURIComponent(state)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "callback failed");
  return data;
}

export async function fetchProfile(accessToken: string) {
  const res = await fetch(
    `${API_BASE_URL}/fitbit/user-profile?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "profile failed");
  return data;
}

export async function refreshToken(refreshToken: string) {
  const res = await fetch(`${API_BASE_URL}/fitbit/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "refresh failed");
  return data;
}

export async function revoke(accessToken: string) {
  const res = await fetch(
    `${API_BASE_URL}/fitbit/revoke?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "revoke failed");
  return data;
}

export async function tokenInfo(accessToken: string) {
  const res = await fetch(
    `${API_BASE_URL}/fitbit/token-info?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "token info failed");
  return data;
}

// ########################################

export async function metricsOverview(accessToken: string, date?: string) {
  const url = new URL(`${API_BASE_URL}/fitbit/metrics/overview`);
  url.searchParams.set("access_token", accessToken);
  if (date) url.searchParams.set("date", date);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "overview failed");
  return data as {
    date: string;
    steps?: number;
    caloriesOut?: number;
    restingHeartRate?: number;
    sleepHours?: number;
    weight?: number;
  };
}

// If you want the individual ones too:
export const metrics = {
  summary: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/summary`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "summary failed");
    return d;
  },
  restingHR: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/resting-hr`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "rhr failed");
    return d;
  },
  sleep: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/sleep`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "sleep failed");
    return d;
  },
  weight: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/weight`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "weight failed");
    return d;
  },
};

// #################### Withings ######################

export async function getWithingsAuthUrl(scope: string) {
  const res = await fetch(
    `/api/withings/authorize?scope=${encodeURIComponent(scope)}`
  );
  if (!res.ok) throw new Error("Failed to get Withings auth URL");
  return res.json();
}

export async function fetchWithingsProfile(accessToken: string) {
  const res = await fetch("/api/withings/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Withings profile");
  return res.json();
}
