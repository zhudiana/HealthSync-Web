// src/pages/metrics/CurrentHeartRate.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Heart, TrendingUp } from "lucide-react";
import { metrics, getUserByAuth, updateUserByAuth } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import HrThresholdDialog from "@/components/HeartRateThresholdDialog";

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {subtitle && <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>}
    </div>
  );
}

function formatTime(seconds: number | null | undefined): string {
  if (!seconds) return "Just now";

  if (seconds < 60) {
    return `${Math.round(seconds)}s ago`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h ago`;
  }

  const days = Math.floor(seconds / 86400);
  return `${days}d ago`;
}

export default function CurrentHeartRatePage() {
  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [thresholds, setThresholds] = useState<{
    low: number | null;
    high: number | null;
  }>({
    low: null,
    high: null,
  });

  const [heartRateData, setHeartRateData] = useState<{
    bpm: number | null;
    ts: number | null;
    cached_at: string | null;
    age_seconds: number | null;
  }>({
    bpm: null,
    ts: null,
    cached_at: null,
    age_seconds: null,
  });

  // Access token
  const { getAccessToken } = useAuth();

  // Fetch current heart rate
  async function loadCurrentHeartRate() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const data = await metrics.latestHeartRate(token);
      if (data?.error) {
        throw new Error(data.error);
      }

      setHeartRateData({
        bpm: data.bpm,
        ts: data.ts,
        cached_at: data.cached_at,
        age_seconds: data.age_seconds,
      });

      setLastRefresh(new Date());

      // Persist the heart rate data
      try {
        await metrics.latestHeartRatePersist(token);
      } catch (e) {
        console.warn("Failed to persist heart rate:", e);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load current heart rate");
      setHeartRateData({
        bpm: null,
        ts: null,
        cached_at: null,
        age_seconds: null,
      });
    } finally {
      setLoading(false);
    }
  }

  // Auto-refresh every 30 seconds if enabled
  useEffect(() => {
    loadCurrentHeartRate();

    if (!autoRefreshEnabled) return;

    const interval = setInterval(() => {
      loadCurrentHeartRate();
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshEnabled]);

  // Load initial thresholds
  useEffect(() => {
    async function loadThresholds() {
      try {
        const authUserId = localStorage.getItem("authUserId");
        if (!authUserId) return;

        const user = await getUserByAuth(authUserId);
        if (
          user.hr_threshold_low !== undefined ||
          user.hr_threshold_high !== undefined
        ) {
          setThresholds({
            low: user.hr_threshold_low,
            high: user.hr_threshold_high,
          });
        }
      } catch (error) {
        console.error("Failed to load thresholds:", error);
      }
    }
    loadThresholds();
  }, []);

  // Format cached_at timestamp
  const cachedAtTime = heartRateData.cached_at
    ? new Date(heartRateData.cached_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-4xl mx-auto p-4 md:p-8 space-y-8">
        {/* Top bar with Back */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              aria-label="Back to dashboard"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 hover:bg-zinc-900 transition"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Current Heart Rate
              </h2>
              <p className="text-zinc-400">Real-time monitoring</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              Auto-refresh
            </label>

            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            >
              <Heart className="h-4 w-4" />
              Adjust Threshold
            </button>

            <button
              onClick={loadCurrentHeartRate}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Large Heart Rate Display */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 p-8">
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <Heart
                className={`h-16 w-16 ${
                  heartRateData.bpm && heartRateData.bpm > 100
                    ? "text-red-500 animate-pulse"
                    : heartRateData.bpm && heartRateData.bpm > 80
                    ? "text-orange-500"
                    : "text-green-500"
                }`}
              />
            </div>
            <div>
              <div className="text-7xl font-bold text-white">
                {loading ? (
                  <span className="text-zinc-500">—</span>
                ) : heartRateData.bpm !== null ? (
                  heartRateData.bpm
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </div>
              <div className="text-2xl text-zinc-400 mt-2">bpm</div>
            </div>

            {/* Data freshness indicator */}
            <div className="space-y-1">
              <p className="text-sm text-zinc-400">
                Last recorded: {cachedAtTime}
              </p>
              <p className="text-xs text-zinc-500">
                {formatTime(heartRateData.age_seconds)}
              </p>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            title="Current HR"
            value={heartRateData.bpm ?? "—"}
            subtitle="bpm"
          />
          <StatCard
            title="Data Age"
            value={formatTime(heartRateData.age_seconds)}
            subtitle="freshness"
          />
          <StatCard
            title="Last Refresh"
            value={
              lastRefresh
                ? lastRefresh.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"
            }
            subtitle="time"
          />
        </div>

        {/* Heart Rate Status */}
        {heartRateData.bpm !== null && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
            <h3 className="font-semibold text-zinc-200 mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Heart Rate Status
            </h3>
            <div className="space-y-3">
              {heartRateData.bpm < 60 && (
                <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-900/40">
                  <p className="text-sm text-blue-200">
                    <strong>Excellent:</strong> Your heart rate is in a resting
                    state. This is typical during rest or relaxation.
                  </p>
                </div>
              )}
              {heartRateData.bpm >= 60 && heartRateData.bpm < 80 && (
                <div className="p-3 rounded-lg bg-green-950/40 border border-green-900/40">
                  <p className="text-sm text-green-200">
                    <strong>Normal:</strong> Your heart rate is in a healthy
                    range for resting state.
                  </p>
                </div>
              )}
              {heartRateData.bpm >= 80 && heartRateData.bpm < 100 && (
                <div className="p-3 rounded-lg bg-yellow-950/40 border border-yellow-900/40">
                  <p className="text-sm text-yellow-200">
                    <strong>Elevated:</strong> Your heart rate is slightly
                    elevated. This could be due to activity, stress, or
                    caffeine.
                  </p>
                </div>
              )}
              {heartRateData.bpm >= 100 && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/40">
                  <p className="text-sm text-red-200">
                    <strong>High:</strong> Your heart rate is elevated. Consider
                    taking a break or checking if you're experiencing stress or
                    physical exertion.
                  </p>
                </div>
              )}

              {/* Threshold alerts */}
              {thresholds.high !== null &&
                heartRateData.bpm > thresholds.high && (
                  <div className="p-3 rounded-lg bg-red-950/60 border border-red-900/60 mt-4">
                    <p className="text-sm text-red-300">
                      <strong>⚠️ Alert:</strong> Your heart rate (
                      {heartRateData.bpm} bpm) has exceeded your high threshold
                      ({thresholds.high} bpm). An alert has been sent to your
                      email.
                    </p>
                  </div>
                )}
              {thresholds.low !== null &&
                heartRateData.bpm < thresholds.low && (
                  <div className="p-3 rounded-lg bg-blue-950/60 border border-blue-900/60 mt-4">
                    <p className="text-sm text-blue-300">
                      <strong>ℹ️ Alert:</strong> Your heart rate (
                      {heartRateData.bpm} bpm) has gone below your low threshold
                      ({thresholds.low} bpm). An alert has been sent to your
                      email.
                    </p>
                  </div>
                )}
            </div>
          </div>
        )}

        {/* Threshold display card */}
        {(thresholds.low !== null || thresholds.high !== null) && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
            <h3 className="font-semibold text-zinc-200 mb-4">
              Your Thresholds
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {thresholds.low !== null && (
                <div className="rounded-lg bg-blue-950/30 border border-blue-900/40 p-4">
                  <p className="text-xs text-blue-400 uppercase tracking-wide">
                    Low Threshold
                  </p>
                  <p className="text-2xl font-semibold text-blue-200 mt-2">
                    {thresholds.low}
                  </p>
                  <p className="text-xs text-blue-400 mt-1">bpm</p>
                </div>
              )}
              {thresholds.high !== null && (
                <div className="rounded-lg bg-red-950/30 border border-red-900/40 p-4">
                  <p className="text-xs text-red-400 uppercase tracking-wide">
                    High Threshold
                  </p>
                  <p className="text-2xl font-semibold text-red-200 mt-2">
                    {thresholds.high}
                  </p>
                  <p className="text-xs text-red-400 mt-1">bpm</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Threshold Dialog */}
        <HrThresholdDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialLow={thresholds.low}
          initialHigh={thresholds.high}
          onSave={async ({ low, high }) => {
            try {
              const authUserId = localStorage.getItem("authUserId");
              if (!authUserId) throw new Error("Not authenticated");

              const response = await updateUserByAuth(authUserId, {
                hr_threshold_low: low,
                hr_threshold_high: high,
              });

              // Verify the response has the expected properties
              if (
                "hr_threshold_low" in response &&
                "hr_threshold_high" in response
              ) {
                setThresholds({
                  low: response.hr_threshold_low as number | null,
                  high: response.hr_threshold_high as number | null,
                });
              } else {
                console.warn("Response missing threshold values:", response);
                // Fall back to the values we tried to save
                setThresholds({ low, high });
              }
            } catch (error) {
              console.error("Failed to save thresholds:", error);
              throw error; // Re-throw to let the dialog handle the error
            }
          }}
        />
      </main>
    </div>
  );
}
