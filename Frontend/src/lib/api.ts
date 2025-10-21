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

// export async function exchangeCode(code: string, state: string) {
//   const url = `${API_BASE_URL}/fitbit/callback?code=${encodeURIComponent(
//     code
//   )}&state=${encodeURIComponent(state)}`;
//   const res = await fetch(url);
//   const data = await res.json();
//   if (!res.ok) throw new Error(data?.detail || "callback failed");
//   return data;
// }

// export async function exchangeFitbitCode(code: string, state: string) {
//   const res = await fetch(`${API_BASE_URL}/fitbit/exchange`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ code, state }),
//   });
//   const data = await res.json();
//   if (!res.ok) throw new Error(data?.detail || "exchange failed");
//   return data as {
//     message: string;
//     account_id: string;
//     fitbit_user_id: string;
//     app_user: {
//       id: string;
//       auth_user_id: string;
//       display_name?: string | null;
//     };
//     expires_at?: string | null;
//     scope?: string | null;
//     tokens: {
//       access_token: string;
//       refresh_token: string;
//       expires_in: number;
//       scope: string;
//       token_type: string;
//       user_id: string;
//     };
//   };
// }

export async function exchangeFitbitCode(code: string, state: string) {
  const res = await fetch(`${API_BASE_URL}/fitbit/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "exchange failed");
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

export async function withingsMetricsOverview(accessToken: string) {
  const url = new URL(`${API_BASE_URL}/withings/metrics/overview`);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings metrics failed");
  // { weightKg: number|null, restingHeartRate: number|null }
  return data as { weightKg: number | null; restingHeartRate: number | null };
}

export async function withingsWeightLatest(accessToken: string) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/weight/latest`);
  u.searchParams.set("access_token", accessToken);
  const r = await fetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings weight latest failed");
  // d = { value: number|null, latest_date: "YYYY-MM-DD"|null }
  return d as { value: number | null; latest_date: string | null };
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

export async function withingsHeartRateDaily(
  accessToken: string,
  date?: string // YYYY-MM-DD (defaults to today on the backend)
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/heart-rate/daily`);
  u.searchParams.set("access_token", accessToken);
  if (date) u.searchParams.set("date", date);
  const r = await fetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings hr daily failed");
  return d as {
    date: string;
    hr_average: number | null;
    hr_min: number | null;
    hr_max: number | null;
    updatedAt: number | null; // epoch seconds (may be null)
  };
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
    latest: { ts: number; body_c: number | null; skin_c: number | null } | null;
  }; // NEW
}

export async function withingsECG(
  accessToken: string,
  start: string,
  end: string,
  tz: string = "Europe/Rome",
  limit: number = 25
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/ecg`);
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);
  u.searchParams.set("tz", tz);
  u.searchParams.set("limit", String(limit));

  const r = await fetch(u.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings ECG failed");
  return d as {
    start: string;
    end: string;
    tz: string;
    count: number;
    items: {
      signalid: number | null;
      ts: number;
      time_iso: string;
      heart_rate: number | null;
      afib: boolean | number | null;
      classification: string | number | null;
      deviceid: string | null;
      model: number | string | null;
    }[];
    latest: {
      signalid: number | null;
      ts: number;
      time_iso: string;
      heart_rate: number | null;
      afib: boolean | number | null;
      classification: string | number | null;
      deviceid: string | null;
      model: number | string | null;
    } | null;
  };
}
