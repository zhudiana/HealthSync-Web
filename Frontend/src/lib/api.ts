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

// ---------- Fitbit extras ----------
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
    total_km?: number;
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

  // ---------- NEW: added Fitbit metrics ----------
  // vo2max: async (token: string, start: string, end: string) => {
  //   const u = new URL(`${API_BASE_URL}/fitbit/metrics/vo2max`);
  //   u.searchParams.set("access_token", token);
  //   u.searchParams.set("start", start);
  //   u.searchParams.set("end", end);
  //   const r = await fetch(u.toString());
  //   const d = await r.json();
  //   if (!r.ok) throw new Error(d?.detail || "vo2max failed");
  //   return d as {
  //     start: string;
  //     end: string;
  //     items: { date: string; vo2max_ml_kg_min: number | null }[];
  //     raw?: unknown;
  //   };
  // },

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

  // respiratoryRate: async (token: string, start: string, end: string) => {
  //   const u = new URL(`${API_BASE_URL}/fitbit/metrics/respiratory-rate`);
  //   u.searchParams.set("access_token", token);
  //   u.searchParams.set("start", start);
  //   u.searchParams.set("end", end);
  //   const r = await fetch(u.toString());
  //   const d = await r.json();
  //   if (!r.ok) throw new Error(d?.detail || "respiratory-rate failed");
  //   return d as {
  //     start: string;
  //     end: string;
  //     items: { date: string; breaths_per_min: number | null }[];
  //     raw?: unknown;
  //   };
  // },

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

  // azm: async (token: string, start: string, end: string) => {
  //   const u = new URL(`${API_BASE_URL}/fitbit/metrics/azm`);
  //   u.searchParams.set("access_token", token);
  //   u.searchParams.set("start", start);
  //   u.searchParams.set("end", end);
  //   const r = await fetch(u.toString());
  //   const d = await r.json();
  //   if (!r.ok) throw new Error(d?.detail || "azm failed");
  //   return d as {
  //     start: string;
  //     end: string;
  //     items: { date: string; minutes: number | null }[];
  //     raw?: unknown;
  //   };
  // },

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

export async function withingsMetricsOverview(accessToken: string) {
  const url = new URL(`${API_BASE_URL}/withings/metrics/overview`);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings metrics failed");
  // { weightKg: number|null, restingHeartRate: number|null }
  return data as { weightKg: number | null; restingHeartRate: number | null };
}

export async function withingsMetricsDaily(accessToken: string, date?: string) {
  const url = new URL(`${API_BASE_URL}/withings/metrics/daily`);
  url.searchParams.set("access_token", accessToken);
  if (date) url.searchParams.set("date", date);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings daily metrics failed");
  // { date, steps, calories, sleepHours }
  return data as {
    date: string;
    steps: number | null;
    calories: number | null;
    sleepHours: number | null;
    distanceKm: number | null;
  };
}

// ---- NEW: Withings specific metric helpers ----
export async function withingsHeartRate(
  accessToken: string,
  start?: string,
  end?: string
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/heart-rate`); // NEW
  u.searchParams.set("access_token", accessToken); // NEW
  if (start && end) {
    // NEW
    u.searchParams.set("start", start); // NEW
    u.searchParams.set("end", end); // NEW
  } // NEW
  const r = await fetch(u.toString()); // NEW
  const d = await r.json(); // NEW
  if (!r.ok) throw new Error(d?.detail || "withings heart-rate failed"); // NEW
  return d as {
    latest?: { ts: number; bpm: number };
    items?: { ts: number; bpm: number }[];
  }; // NEW
}

export async function withingsSpO2(
  accessToken: string,
  start?: string,
  end?: string
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/spo2`); // NEW
  u.searchParams.set("access_token", accessToken); // NEW
  if (start && end) {
    // NEW
    u.searchParams.set("start", start); // NEW
    u.searchParams.set("end", end); // NEW
  } // NEW
  const r = await fetch(u.toString()); // NEW
  const d = await r.json(); // NEW
  if (!r.ok) throw new Error(d?.detail || "withings spo2 failed"); // NEW
  return d as {
    latest?: { ts: number; percent: number };
    items?: { ts: number; percent: number }[];
  }; // NEW
}

export async function withingsTemperature(
  accessToken: string,
  start: string,
  end: string
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/temperature`); // NEW
  u.searchParams.set("access_token", accessToken); // NEW
  u.searchParams.set("start", start); // NEW
  u.searchParams.set("end", end); // NEW
  const r = await fetch(u.toString()); // NEW
  const d = await r.json(); // NEW
  if (!r.ok) throw new Error(d?.detail || "withings temperature failed"); // NEW
  return d as {
    // NEW
    start: string; // NEW
    end: string; // NEW
    items: { ts: number; body_c: number | null; skin_c: number | null }[]; // NEW
  }; // NEW
}
