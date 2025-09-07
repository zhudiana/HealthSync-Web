// src/components/Header.tsx
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

export default function Header() {
  const { profile, logout, provider } = useAuth();
  let name: string;
  if (provider === "withings") {
    const full =
      profile?.fullName?.trim() ||
      [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
    if (full) {
      name = full;
    } else if (profile?.id) {
      name = `W-${String(profile.id).slice(0, 6)}`;
    } else {
      name = "Withings User"; // ultimate fallback
    }
  } else {
    // Fitbit (default)
    name = profile?.displayName || profile?.fullName?.trim() || "Fitbit User";
  }
  const avatar =
    (provider === "fitbit" ? profile?.avatar150 || profile?.avatar : null) ||
    "https://static0.fitbit.com/images/profile/defaultProfile_150.png";

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // close on outside click/esc
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-background/70 bg-background/60 border-b border-white/10">
      <div className="max-w-6xl mx-auto h-14 px-4 flex items-center justify-between">
        <div className="font-bold tracking-tight">
          <span className="text-foreground">Health</span>
          <span className="text-primary">Sync</span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-white/5 border border-white/10"
          >
            <span className="text-sm text-muted-foreground hidden sm:block">
              Hello, <span className="text-foreground font-medium">{name}</span>
            </span>
            <img
              src={avatar}
              alt="avatar"
              className="h-8 w-8 rounded-full object-cover"
            />
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4 opacity-70"
              aria-hidden="true"
            >
              <path
                d="M5.5 7.5L10 12l4.5-4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-40 rounded-xl border border-white/10 bg-background shadow-lg p-1">
              <button
                onClick={logout}
                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/5"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
