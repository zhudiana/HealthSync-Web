import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!open) return;
    const authUserId = localStorage.getItem("authUserId");
    if (!authUserId) return;

    setLoading(true);
    getUserByAuth(authUserId)
      .then((u) => {
        setName(u.display_name || "");
        setEmail(u.email ?? null);
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    const authUserId = localStorage.getItem("authUserId");
    if (!authUserId) return;

    setSaving(true);
    try {
      const updated = await updateUserByAuth(authUserId, {
        display_name: name.trim() || null,
        // email: email ?? null, // enable when you want users to edit email
      });
      onSaved?.({ display_name: updated.display_name, email: updated.email });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-900 p-4">
        <div className="mb-3 text-lg font-semibold">Edit profile</div>

        <div className="space-y-3">
          <label className="block text-sm text-muted-foreground">
            Display name
            <input
              disabled={loading}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 outline-none"
              placeholder="Your name"
            />
          </label>

          {/* Keep for later if you decide to allow email editing
          <label className="block text-sm text-muted-foreground">
            Email
            <input
              disabled={loading}
              value={email ?? ""}
              onChange={(e) => setEmail(e.target.value || null)}
              className="mt-1 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 outline-none"
              placeholder="you@example.com"
              type="email"
            />
          </label>
          */}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md border border-white/10 px-3 py-2 hover:bg-white/5"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-white/10 px-3 py-2 hover:bg-white/5 disabled:opacity-50"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
