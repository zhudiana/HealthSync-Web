import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getUserByAuth } from "@/lib/api";
import EditProfileDialog from "@/components/EditProfileDialog";
import { Watch, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

interface HeaderProps {
  className?: string;
  children?: React.ReactNode;
}

export default function Header({ className, children }: HeaderProps) {
  const { profile, logout, provider } = useAuth();

  function fallbackName() {
    if (provider === "withings") {
      const full =
        profile?.fullName?.trim() ||
        [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
      if (full) return full;
      if (profile?.id) return `W-${String(profile.id).slice(0, 6)}`;
      return "Withings User";
    }
    // Fitbit
    return profile?.displayName || profile?.fullName?.trim() || "Fitbit User";
  }

  const [displayName, setDisplayName] = useState<string>(fallbackName());

  useEffect(() => {
    const storedAuthUserId = localStorage.getItem("authUserId");
    if (storedAuthUserId) {
      getUserByAuth(storedAuthUserId)
        .then((user) => {
          if (user.display_name) {
            setDisplayName(user.display_name);
          }
        })
        .catch((err) => console.error("Failed to load user:", err));
    }
  }, []);

  const avatar =
    (provider === "fitbit" ? profile?.avatar150 || profile?.avatar : null) ||
    "https://static0.fitbit.com/images/profile/defaultProfile_150.png";

  // dropdown + modal
  const [open, setOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
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

  // Load display name from your DB user (by auth_user_id) if available
  useEffect(() => {
    const id = localStorage.getItem("authUserId");
    if (!id) return; // fallback to provider name only
    getUserByAuth(id)
      .then((u) => {
        if (u?.display_name) setDisplayName(u.display_name);
      })
      .catch(() => {});
  }, [provider, profile?.fullName, profile?.displayName]);

  return (
    <header
      className={`sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-background/70 bg-background/60 border-b border-white/10 ${
        className || ""
      }`}
    >
      <div className="w-full h-16 pl-2 pr-4 flex items-center justify-between">
        {children || (
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <Watch className="h-5 w-5" />
            <Link to={"/"}>
              <div className="text-lg leading-none">
                <span className="text-foreground">Health</span>
                <span className="text-primary">Sync</span>
              </div>
            </Link>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">
              {provider === "withings" ? "Withings" : "Fitbit"}
            </span>
          </div>
        )}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-white/5 border border-white/10"
          >
            <span className="text-sm text-muted-foreground hidden sm:block">
              Hello,{" "}
              <span className="text-foreground font-medium">{displayName}</span>
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
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-background shadow-lg p-1">
              <button
                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/5"
                onClick={() => {
                  setOpen(false);
                  location.reload();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </span>
              </button>

              <div className="h-px bg-white/10 my-1" />

              <button
                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/5"
                onClick={() => {
                  setShowEdit(true);
                  setOpen(false);
                }}
              >
                Edit profile
              </button>

              <div className="h-px bg-white/10 my-1" />

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

      {/* Modal for editing name */}
      <EditProfileDialog
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={(u) => {
          setDisplayName(u.display_name || fallbackName());
        }}
      />
    </header>
  );
}
