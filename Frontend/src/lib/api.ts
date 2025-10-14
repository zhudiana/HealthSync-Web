import { tokens } from "@/lib/storage";
const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type Provider = "fitbit" | "withings";

// ---------- Fitbit ----------
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

export async function fetchProfile(
  accessToken: string,
  provider: "fitbit" | "withings"
) {
  if (provider === "fitbit") {
    const res = await fetch(
      `${API_BASE_URL}/fitbit/user-profile?access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "fitbit profile failed");
    return data; // { user: {...} }
  } else {
    const res = await fetch(
      `${API_BASE_URL}/withings/profile?access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "withings profile failed");
    return data; // { firstName, lastName, fullName }
  }
}

export async function refreshToken(refreshToken: string, provider: Provider) {
  const url =
    provider === "fitbit"
      ? `${API_BASE_URL}/fitbit/refresh`
      : `${API_BASE_URL}/withings/refresh`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "refresh failed");
  return data;
}

export async function revoke(accessToken: string, provider: Provider) {
  const url =
    provider === "fitbit"
      ? `${API_BASE_URL}/fitbit/revoke?access_token=${encodeURIComponent(
          accessToken
        )}`
      : `${API_BASE_URL}/withings/revoke?access_token=${encodeURIComponent(
          accessToken
        )}`;

  const res = await fetch(url);
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

export type CaloriesBlock = {
  total: number | null;
  active?: number | null;
  bmr_estimate?: number | null;
  goal_total?: number | null;
};

export async function metricsOverview(accessToken: string, date?: string) {
  const url = new URL(`${API_BASE_URL}/fitbit/metrics/overview`);
  url.searchParams.set("access_token", accessToken);
  if (date) url.searchParams.set("date", date);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "overview failed");

  return data as {
    date: string;
    steps?: number | null;
    calories?: CaloriesBlock; // <-- add this
    caloriesOut?: number | null; // legacy total
    activityCalories?: number | null; // legacy active
    restingHeartRate?: number | null;
    sleepHours?: number | null;
    weight?: number | null;
    total_km?: number | null;
  };
}

export const metrics = {
  summary: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/summary`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "summary failed");
    // return d;
    // Total calories = Fitbit app's "Energy burned"
    const caloriesTotal: number | null =
      d?.calories?.total ?? d?.caloriesOut ?? null;

    // keep other fields if your UI needs them; add a single, clear field:
    return { ...d, caloriesTotal };
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

  spo2Nightly: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/spo2-nightly`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "spo2 failed");
    return d as {
      date: string;
      average: number | null;
      min: number | null;
      max: number | null;
      raw?: unknown;
    };
  },

  hrv: async (token: string, start: string, end: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/hrv`);
    u.searchParams.set("access_token", token);
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "hrv failed");
    return d as {
      start: string;
      end: string;
      items: { date: string; rmssd_ms: number | null }[];
      raw?: unknown;
    };
  },

  temperature: async (token: string, start: string, end: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/temperature`);
    u.searchParams.set("access_token", token);
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "temperature failed");
    return d as {
      start: string;
      end: string;
      items: { date: string; delta_c: number | null }[];
      raw?: unknown;
    };
  },

  distance: async (token: string, date?: string) => {
    // NEW
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/distance`); // NEW
    u.searchParams.set("access_token", token); // NEW
    if (date) u.searchParams.set("date", date); // NEW
    const r = await fetch(u.toString()); // NEW
    const d = await r.json(); // NEW
    if (!r.ok) throw new Error(d?.detail || "distance failed"); // NEW
    return d as {
      // NEW
      date: string; // NEW
      total_km: number | null; // NEW
      distances: { activity: string; distance: number }[]; // NEW
      raw?: unknown; // NEW
    }; // NEW
  },
};

// ---------- Withings ----------
export async function getWithingsAuthUrl(scope: string) {
  const res = await fetch(
    `${API_BASE_URL}/withings/login?scope=${encodeURIComponent(scope)}`
  );
  if (!res.ok) throw new Error("Failed to get Withings auth URL");
  return res.json();
}

export async function exchangeWithingsCode(code: string, state: string) {
  const res = await fetch(`${API_BASE_URL}/withings/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings exchange failed");
  return data; // { tokens: {...} }
}

export async function getUserByAuth(authUserId: string) {
  const r = await fetch(
    `${API_BASE_URL}/users/by-auth/${encodeURIComponent(authUserId)}`
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "Failed to load user");
  return d as {
    id: string;
    auth_user_id: string;
    email: string | null;
    display_name: string | null;
  };
}

export async function updateUserByAuth(
  authUserId: string,
  body: { display_name?: string; email?: string }
) {
  const r = await fetch(
    `${API_BASE_URL}/users/by-auth/${encodeURIComponent(authUserId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "Failed to update user");
  return d as {
    id: string;
    auth_user_id: string;
    email: string | null;
    display_name: string | null;
  };
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const jwt = tokens.getSession();
  const headers = new Headers(init.headers || {});
  if (jwt) headers.set("Authorization", `Bearer ${jwt}`);

  // If caller gave a full URL, use it as-is; otherwise prefix API_BASE_URL
  const isAbsolute = /^https?:\/\//i.test(input);
  const url = isAbsolute ? input : `${API_BASE_URL}${input}`;
  return fetch(url, { ...init, headers });
}

export async function withingsMetricsOverview() {
  const res = await apiFetch(`/withings/metrics/overview`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings metrics failed");
  return data as { weightKg: number | null; restingHeartRate: number | null };
}

export async function withingsWeightLatest() {
  const res = await apiFetch(`/withings/metrics/weight/latest`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || "withings weight latest failed");
  return data as { value: number | null; latest_date: string | null };
}

export async function withingsMetricsDaily(date?: string) {
  const url = new URL(`${API_BASE_URL}/withings/metrics/daily`);
  if (date) url.searchParams.set("date", date);

  const res = await apiFetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || "withingsMetricsDaily failed");
  }
  return data;
}

export async function withingsHeartRate(start?: string, end?: string) {
  const u = new URL(`/withings/metrics/heart-rate/intraday`, API_BASE_URL);
  if (start) u.searchParams.set("start", start);
  if (end) u.searchParams.set("end", end);
  const r = await apiFetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings heart-rate failed");
  return d as {
    latest?: { ts: number; bpm: number };
    items?: { ts: number; bpm: number }[];
  };
}

export async function withingsHeartRateDaily(date?: string) {
  const u = new URL(`/withings/metrics/heart-rate/daily`, API_BASE_URL);
  if (date) u.searchParams.set("date", date);
  const r = await apiFetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings hr daily failed");
  return d as {
    date: string;
    hr_average: number | null;
    hr_min: number | null;
    hr_max: number | null;
    updatedAt: number | null;
  };
}

export async function withingsSpO2(start?: string, end?: string) {
  const u = new URL(`/withings/metrics/spo2`, API_BASE_URL);
  if (start && end) {
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);
  }
  const r = await apiFetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings spo2 failed");
  return d as {
    latest?: { ts: number; percent: number };
    items?: { ts: number; percent: number }[];
  };
}

export async function withingsTemperature(
  start: string,
  end: string,
  tz = "Europe/Rome"
) {
  const u = new URL(`/withings/metrics/temperature`, API_BASE_URL);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);
  u.searchParams.set("tz", tz);
  const r = await apiFetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings temperature failed");
  return d as {
    start: string;
    end: string;
    items: { ts: number; body_c: number | null; skin_c?: number | null }[];
    latest: {
      ts: number;
      body_c: number | null;
      skin_c?: number | null;
    } | null;
  };
}

export async function withingsECG(
  start: string,
  end: string,
  tz = "Europe/Rome",
  limit = 25
) {
  const u = new URL(`/withings/metrics/ecg`, API_BASE_URL);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);
  u.searchParams.set("tz", tz);
  u.searchParams.set("limit", String(limit));
  const r = await apiFetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings ECG failed");
  return d;
}
