const API_BASE_URL = import.meta.env.VITE_API_URL;

type Provider = "fitbit" | "withings";

// ---------- Fitbit ----------
export async function getFitbitAuthUrl(scope: string) {
  const res = await fetch(
    `${API_BASE_URL}/fitbit/login?scope=${encodeURIComponent(scope)}`
  );
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return res.json() as Promise<{ authorization_url: string; state: string }>;
}

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

  sleepToday: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/sleep/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "sleep failed");
    return d as {
      date: string;
      totalMinutesAsleep: number | null;
      hoursAsleep: number | null;
      hoursAsleepMain: number | null;
      sessions_saved: number;
      total_sessions: number;
    };
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

  steps: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/steps/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "steps failed");
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

  spo2NightlyToday: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/spo2-nightly/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "spo2 failed");
    return d as {
      date: string;
      average: number | null;
      min: number | null;
      saved: boolean;
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

  temperatureToday: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/temperature/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "temperature failed");
    return d as {
      date: string;
      delta_c: number | null;
      saved: boolean;
      reading_count: number;
      all_readings: Array<{
        date: string;
        delta_c: number | null;
        value: unknown;
      }>;
    };
  },

  restingHrToday: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/resting-hr/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "resting hr failed");
    return d as {
      date: string;
      resting_hr: number | null;
      saved: boolean;
    };
  },

  hrvToday: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/hrv/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "hrv failed");
    return d as {
      date: string;
      rmssd_ms: number | null;
      coverage: number | null;
      low_quartile: number | null;
      high_quartile: number | null;
      saved: boolean;
    };
  },

  respiratoryRateToday: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/respiratory-rate/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "respiratory rate failed");
    return d as {
      date: string;
      full_day_avg: number | null;
      deep_sleep_avg: number | null;
      light_sleep_avg: number | null;
      rem_sleep_avg: number | null;
      saved: boolean;
    };
  },

  respiratoryRate: async (token: string, start: string, end: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/respiratory-rate`);
    u.searchParams.set("access_token", token);
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "respiratory rate failed");
    return d as {
      start: string;
      end: string;
      items: {
        date: string;
        full_day_avg: number | null;
        deep_sleep_avg: number | null;
        light_sleep_avg: number | null;
        rem_sleep_avg: number | null;
      }[];
      raw?: unknown;
    };
  },

  distance: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/distance`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "distance failed");
    return d as {
      date: string;
      total_km: number | null;
      distances: { activity: string; distance: number }[];
      raw?: unknown;
    };
  },

  calories: async (token: string, date?: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/calories/today`);
    u.searchParams.set("access_token", token);
    if (date) u.searchParams.set("date", date);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "calories failed");
    return d as {
      date: string;
      calories_out: number | null;
      activity_calories: number | null;
      bmr_calories: number | null;
    };
  },

  latestHeartRate: async (token: string) => {
    const u = new URL(`${API_BASE_URL}/fitbit/metrics/latest-heart-rate`);
    u.searchParams.set("access_token", token);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "latest heart rate failed");
    return d as {
      bpm: number | null;
      ts: number | null;
      cached_at: string | null;
      age_seconds: number | null;
      error?: string;
    };
  },

  latestHeartRatePersist: async (token: string) => {
    const u = new URL(
      `${API_BASE_URL}/fitbit/metrics/latest-heart-rate/persist`
    );
    u.searchParams.set("access_token", token);
    const r = await fetch(u.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d?.detail || "heart rate persistence failed");
    return d as {
      saved: boolean;
      count: number;
      date_local?: string;
      start_utc?: string;
      end_utc?: string;
      resolution?: string;
      latest_bpm?: number | null;
      message?: string;
      error?: string;
    };
  },
};

// ----------------------------------------------------------
// ---------- Withings ----------
export async function getWithingsAuthUrl(scope: string) {
  const res = await fetch(
    `${API_BASE_URL}/withings/login?scope=${encodeURIComponent(scope)}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error("Failed to get Withings auth URL");
  return res.json();
}

export async function exchangeWithingsCode(code: string, state: string) {
  const res = await fetch(`${API_BASE_URL}/withings/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings exchange failed");
  return data; // { tokens: {...} }
}

export async function getUserByAuth(authUserId: string) {
  const r = await fetch(
    `${API_BASE_URL}/users/by-auth/${encodeURIComponent(authUserId)}`,
    { credentials: "include" }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "Failed to load user");
  return d as {
    id: string;
    auth_user_id: string;
    email: string | null;
    display_name: string | null;
    hr_threshold_low: number | null;
    hr_threshold_high: number | null;
  };
}

export async function updateUserByAuth(
  authUserId: string,
  body: {
    display_name?: string;
    email?: string;
    hr_threshold_low?: number | null;
    hr_threshold_high?: number | null;
  }
) {
  const r = await fetch(
    `${API_BASE_URL}/users/by-auth/${encodeURIComponent(authUserId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
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
  const res = await fetch(url.toString(), { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "withings metrics failed");
  // { weightKg: number|null, restingHeartRate: number|null }
  return data as { weightKg: number | null; restingHeartRate: number | null };
}

export async function withingsWeightLatest(accessToken: string) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/weight/latest`);
  u.searchParams.set("access_token", accessToken);
  const r = await fetch(u.toString(), { credentials: "include" });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings weight latest failed");
  // d = { value: number|null, latest_date: "YYYY-MM-DD"|null }
  return d as { value: number | null; latest_date: string | null };
}

export async function withingsWeightHistory(
  accessToken: string,
  start: string, // YYYY-MM-DD
  end: string // YYYY-MM-DD
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/weight/history`);
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);
  const r = await fetch(u.toString(), { credentials: "include" });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings weight history failed");
  return d as {
    start: string;
    end: string;
    items: { ts: number; weight_kg: number; device?: string }[];
  };
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
    u.searchParams.set("start", start); // NEW
    u.searchParams.set("end", end); // NEW
  }
  const r = await fetch(u.toString(), { credentials: "include" }); // NEW
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
  const r = await fetch(u.toString(), { credentials: "include" });
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
  const r = await fetch(u.toString(), { credentials: "include" }); // NEW
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
  start?: string,
  end?: string,
  tz: string = "Europe/Rome",
  limit: number = 25
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/ecg`);
  u.searchParams.set("access_token", accessToken);
  if (start) u.searchParams.set("start", start);
  if (end) u.searchParams.set("end", end);
  u.searchParams.set("tz", tz);
  u.searchParams.set("limit", String(limit));

  const r = await fetch(u.toString(), { credentials: "include" });
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

// Analytics
export type StepPoint = {
  date: string;
  steps: number;
  distance_km?: number;
  calories?: number;
};

export async function stepsSeries(
  accessToken: string,
  provider: "fitbit" | "withings",
  fromISO: string, // YYYY-MM-DD
  toISO: string // YYYY-MM-DD
): Promise<StepPoint[]> {
  const url = new URL(
    provider === "withings"
      ? "/withings/metrics/steps/series"
      : "/fitbit/metrics/steps/series",
    API_BASE_URL
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("from", fromISO);
  url.searchParams.set("to", toISO);

  try {
    const res = await fetch(url.toString(), { credentials: "include" });
    const contentType = res.headers.get("content-type") || "";

    // Parse JSON only if it's JSON
    const raw = contentType.includes("application/json")
      ? await res.json()
      : null;

    if (!res.ok) {
      const detail =
        (raw && (raw.detail || raw.message)) ||
        `Failed to load steps series (${res.status})`;
      throw new Error(detail);
    }

    // Support both shapes: an array or { items: [...] }
    const items = Array.isArray(raw) ? raw : raw?.items ?? [];

    // Ensure we return StepPoint[] with minimal coercion
    return items.map((p: any) => ({
      date: String(p.date),
      steps: Number(p.steps ?? 0),
      distance_km: p.distance_km ?? undefined,
      calories: p.calories ?? undefined,
    })) as StepPoint[];
  } catch (error) {
    console.error("stepsSeries error:", error);
    throw error;
  }
}

// --- Withings: steps for a single day (maps to GET /withings/metrics/daily) ---
export async function withingsStepsDaily(accessToken: string, date: string) {
  // Try cached endpoint first
  try {
    const res = await fetch(
      `${API_BASE_URL}/withings/metrics/steps/daily/cached/${date}?access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    if (res.ok) {
      return res.json();
    }
    if (res.status !== 404) {
      throw new Error(await res.text());
    }
  } catch (error) {
    console.warn("Failed to fetch cached steps data:", error);
  }

  // Fall back to main API endpoint if cache fails or returns 404
  const u = new URL(`${API_BASE_URL}/withings/metrics/daily`);
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("date", date);
  const r = await fetch(u.toString(), { credentials: "include" });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.detail || "withings steps daily failed");
  // { date, steps, distanceKm, calories?, sleepHours? }
  return d as {
    date: string;
    steps: number | null;
    distanceKm: number | null;
    calories?: number | null;
    sleepHours?: number | null;
  };
}

export async function withingsStepsRange(
  accessToken: string,
  start: string, // YYYY-MM-DD
  end: string // YYYY-MM-DD
) {
  const dates: string[] = [];
  {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  const results = await Promise.all(
    dates.map((d) => withingsStepsDaily(accessToken, d))
  );
  return results; // array of {date, steps, ...}
}

export async function withingsDistanceDaily(accessToken: string, date: string) {
  const res = await fetch(
    `${API_BASE_URL}/withings/metrics/distance/daily/cached/${date}?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  if (!res.ok && res.status !== 404) throw new Error(await res.text());
  return res.json();
}

export async function withingsWeightHistoryCached(
  accessToken: string,
  start: string,
  end: string
) {
  const u = new URL(`${API_BASE_URL}/withings/metrics/weight/history/cached`);
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);

  const r = await fetch(u.toString(), { credentials: "include" });

  if (r.status === 404) return null;

  const d = await r.json();
  if (!r.ok)
    throw new Error(d?.detail || "withings weight history (cached) failed");
  return d as {
    start: string;
    end: string;
    items: { ts: number; weight_kg: number; device?: string }[];
    fromCache?: boolean;
  } | null;
}

export async function withingsSpO2Cached(accessToken: string, date: string) {
  const res = await fetch(
    `${API_BASE_URL}/withings/metrics/spo2/daily/cached/${date}?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    date: string;
    items: { ts: number; percent: number }[];
  }>;
}

export async function withingsTemperatureDaily(
  accessToken: string,
  date: string
) {
  const res = await fetch(
    `${API_BASE_URL}/withings/metrics/temperature/daily/cached/${date}?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    date: string;
    items: { ts: number; body_c: number }[];
  }>;
}

// ---------- Fitbit Weight History & Latest ----------
export async function fitbitWeightHistory(
  accessToken: string,
  dateFrom: string,
  dateTo: string
) {
  const url = new URL(`${API_BASE_URL}/fitbit/metrics/weight`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("date", dateFrom);
  url.searchParams.set("end", dateTo);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "fitbit weight history failed");

  return data as {
    date: string;
    weight: Array<{
      date: string;
      weight_kg: number;
      fat_pct: number | null;
      bmi: number | null;
      logId: string;
      source: string;
    }>;
  };
}

export async function fitbitWeightLatest(accessToken: string) {
  const url = new URL(`${API_BASE_URL}/fitbit/metrics/weight`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("period", "1d");

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "fitbit weight latest failed");

  // Get the latest item from the response
  const items = data.weight || [];
  const latest = items[items.length - 1] || null;

  return latest as {
    date: string;
    weight_kg: number;
    fat_pct: number | null;
    bmi: number | null;
    logId: string;
    source: string;
  } | null;
}

// ---------- Fitbit Distance History ----------
export async function fitbitDistanceHistory(
  accessToken: string,
  dateFrom: string,
  dateTo: string
) {
  const url = new URL(`${API_BASE_URL}/fitbit/metrics/distance`);
  url.searchParams.set("access_token", accessToken);

  // Fetch for each day in the range since Fitbit distance is daily
  const points: Array<{ date: string; distance_km: number | null }> = [];
  let currentDate = new Date(dateFrom);
  const endDate = new Date(dateTo);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split("T")[0];
    try {
      const dayUrl = new URL(`${API_BASE_URL}/fitbit/metrics/distance`);
      dayUrl.searchParams.set("access_token", accessToken);
      dayUrl.searchParams.set("date", dateStr);

      const res = await fetch(dayUrl.toString());
      const data = await res.json();
      if (res.ok) {
        points.push({
          date: data.date || dateStr,
          distance_km: data.distance_km,
        });
      }
    } catch (e) {
      console.warn(`Failed to fetch distance for ${dateStr}:`, e);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    start: dateFrom,
    end: dateTo,
    items: points,
  };
}

// ---------- Fitbit Steps History ----------
export async function fitbitStepsHistory(
  accessToken: string,
  dateFrom: string,
  dateTo: string
) {
  const url = new URL(`${API_BASE_URL}/fitbit/metrics/steps`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("start_date", dateFrom);
  url.searchParams.set("end_date", dateTo);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "fitbit steps history failed");

  return data as {
    start: string;
    end: string;
    items: Array<{
      date: string;
      steps: number | null;
      active_minutes: number | null;
      calories: number | null;
    }>;
  };
}
