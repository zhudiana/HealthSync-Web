// src/components/EditProfileDialog.tsx
import { useEffect, useRef, useState } from "react";
import { getUserByAuth, updateUserByAuth } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (u: { display_name: string | null; email: string | null }) => void;
};

export default function EditProfileDialog({ open, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load current profile when opened
  useEffect(() => {
    if (!open) return;
    const authUserId = localStorage.getItem("authUserId");
    if (!authUserId) return;

    setLoading(true);
    setError(null);
    getUserByAuth(authUserId)
      .then((u) => {
        setName(u?.display_name || "");
        setEmail(u?.email ?? null);
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  function validEmail(v: string) {
    // very light validation; server remains source of truth
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  async function save() {
    const authUserId = localStorage.getItem("authUserId");
    if (!authUserId) return;

    const trimmedName = name.trim();
    const trimmedEmail = (email || "").trim();

    if (trimmedEmail && !validEmail(trimmedEmail)) {
      setError("Please enter a valid email.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await updateUserByAuth(authUserId, {
        display_name: trimmedName || null,
        email: trimmedEmail || null,
      });
      onSaved?.({ display_name: updated.display_name, email: updated.email });
      onClose();
    } catch {
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl ring-1 ring-white/10"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="edit-profile-title"
            className="text-lg font-semibold text-zinc-100"
          >
            Edit profile
          </h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              Display name
            </span>
            <input
              disabled={loading || saving}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mt-1 w-full rounded-lg border border-white/10 bg-transparent px-3 py-2
                         text-zinc-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              Email
            </span>
            <input
              disabled={loading || saving}
              value={email ?? ""}
              onChange={(e) => setEmail(e.target.value || null)}
              placeholder="you@example.com"
              type="email"
              className="mt-1 w-full rounded-lg border border-white/10 bg-transparent px-3 py-2
                         text-zinc-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md border border-white/10 px-3 py-2 text-zinc-200 hover:bg-white/5 disabled:opacity-50"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-white/10 px-3 py-2 text-zinc-100 hover:bg-white/5 disabled:opacity-50"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
