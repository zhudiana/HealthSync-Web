import React, { useEffect, useMemo, useState } from "react";

export type HrThresholds = { low: number | null; high: number | null };

export interface HrThresholdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLow?: number | null;
  initialHigh?: number | null;
  onSave: (payload: HrThresholds) => Promise<void> | void;
  isSavingExternally?: boolean;
}

const HR_MIN = 30;
const HR_MAX = 220;

export default function HrThresholdDialog({
  open,
  onOpenChange,
  initialLow = null,
  initialHigh = null,
  onSave,
  isSavingExternally,
}: HrThresholdDialogProps) {
  const [low, setLow] = useState<string>(
    initialLow == null ? "" : String(initialLow)
  );
  const [high, setHigh] = useState<string>(
    initialHigh == null ? "" : String(initialHigh)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLow(initialLow == null ? "" : String(initialLow));
      setHigh(initialHigh == null ? "" : String(initialHigh));
    }
  }, [open, initialLow, initialHigh]);

  const busy = saving || !!isSavingExternally;

  function parseOrNull(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : (NaN as unknown as number); // sentinel for invalid
  }

  const errors = useMemo(() => {
    const e: { low?: string; high?: string; pair?: string } = {};
    const l = parseOrNull(low);
    const h = parseOrNull(high);

    if (low.trim() !== "") {
      if (Number.isNaN(l)) e.low = "Must be a number";
      else if (l! < HR_MIN || l! > HR_MAX) e.low = `Enter ${HR_MIN}-${HR_MAX}`;
    }
    if (high.trim() !== "") {
      if (Number.isNaN(h)) e.high = "Must be a number";
      else if (h! < HR_MIN || h! > HR_MAX) e.high = `Enter ${HR_MIN}-${HR_MAX}`;
    }
    if (!e.low && !e.high && l !== null && h !== null && l >= h) {
      e.pair = "Low must be less than High";
    }
    return e;
  }, [low, high]);

  const previewText = useMemo(() => {
    const l = parseOrNull(low);
    const h = parseOrNull(high);
    if (low.trim() === "" && high.trim() === "")
      return "No alerts set. You won't get HR threshold notifications.";
    if (
      !Number.isNaN(l as any) &&
      !Number.isNaN(h as any) &&
      l !== null &&
      h !== null
    )
      return `Alert if HR < ${l} or HR > ${h} bpm.`;
    if (!Number.isNaN(l as any) && l !== null) return `Alert if HR < ${l} bpm.`;
    if (!Number.isNaN(h as any) && h !== null) return `Alert if HR > ${h} bpm.`;
    return "";
  }, [low, high]);

  async function handleSave() {
    if (errors.low || errors.high || errors.pair) return;
    const payload: HrThresholds = {
      low: parseOrNull(low),
      high: parseOrNull(high),
    };
    try {
      setSaving(true);
      await onSave(payload);
      onOpenChange(false);
    } catch (err) {
      console.error("Save HR thresholds failed", err);
      // TODO: surface error to user
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !busy) onOpenChange(false);
  }

  if (!open) return null;

  // Minimal inline styles to avoid external CSS
  const styles = {
    overlay: {
      position: "fixed" as const,
      inset: 0,
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    },
    modal: {
      width: "min(520px, 92vw)",
      background: "#111",
      color: "#eee",
      borderRadius: 16,
      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      padding: 20,
      border: "1px solid rgba(255,255,255,0.08)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    },
    title: { fontSize: 18, fontWeight: 700, margin: 0 },
    desc: { fontSize: 13, opacity: 0.8, marginTop: 6 },
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
      marginTop: 16,
    },
    label: { fontSize: 12, opacity: 0.9, marginBottom: 6, display: "block" },
    input: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "#181818",
      color: "#fff",
      outline: "none",
    },
    err: { fontSize: 12, color: "#ff6b6b", marginTop: 6 },
    hint: { fontSize: 12, opacity: 0.7, marginTop: 6 },
    summary: {
      marginTop: 12,
      fontSize: 13,
      background: "rgba(255,255,255,0.06)",
      padding: 10,
      borderRadius: 10,
    },
    row: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 16,
    },
    textBtn: {
      background: "transparent",
      color: "#bbb",
      border: "none",
      padding: 0,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
    },
    primary: {
      background: "#4f46e5",
      color: "white",
      border: "none",
      borderRadius: 10,
      padding: "10px 14px",
      cursor: "pointer",
      fontWeight: 600,
    },
    ghost: {
      background: "transparent",
      color: "#eee",
      border: "1px solid rgba(255,255,255,0.16)",
      borderRadius: 10,
      padding: "10px 14px",
      cursor: "pointer",
      marginRight: 8,
    },
    footer: { display: "flex", gap: 8 },
  } as const;

  return (
    <div style={styles.overlay} onKeyDown={handleKeyDown}>
      <div role="dialog" aria-modal="true" style={styles.modal}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={styles.title}>Heart Rate Alerts</h2>
          <button
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            style={{ ...styles.textBtn, fontSize: 18, lineHeight: 1 }}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <p style={styles.desc}>
          Set your personalized high/low heart rate thresholds (in bpm). Leave a
          field blank to disable that side of the alert.
        </p>

        <div style={styles.grid}>
          <div>
            <label htmlFor="low" style={styles.label}>
              Low (bpm)
            </label>
            <input
              id="low"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 45"
              style={styles.input}
              value={low}
              onChange={(e) => setLow(e.target.value)}
              disabled={busy}
            />
            {errors.low ? (
              <div style={styles.err}>{errors.low}</div>
            ) : (
              <div style={styles.hint}>
                Min {HR_MIN}, leave blank to disable.
              </div>
            )}
          </div>
          <div>
            <label htmlFor="high" style={styles.label}>
              High (bpm)
            </label>
            <input
              id="high"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 120"
              style={styles.input}
              value={high}
              onChange={(e) => setHigh(e.target.value)}
              disabled={busy}
            />
            {errors.high ? (
              <div style={styles.err}>{errors.high}</div>
            ) : (
              <div style={styles.hint}>
                Max {HR_MAX}, leave blank to disable.
              </div>
            )}
          </div>
        </div>

        {errors.pair && (
          <div style={{ ...styles.err, marginTop: 10 }}>{errors.pair}</div>
        )}

        <div style={styles.summary}>{previewText}</div>

        <div style={styles.row}>
          <button
            type="button"
            onClick={() => {
              setLow("");
              setHigh("");
            }}
            style={styles.textBtn}
            disabled={busy}
          >
            Clear thresholds
          </button>

          <div style={styles.footer}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={styles.ghost}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{ ...styles.primary, opacity: busy ? 0.7 : 1 }}
              disabled={busy || !!errors.low || !!errors.high || !!errors.pair}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
          Tip: Typical resting HR for most adults is ~60–100 bpm, but your
          optimal zone can vary by fitness level. You can change these anytime.
        </div>
      </div>
    </div>
  );
}
