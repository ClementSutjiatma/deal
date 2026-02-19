"use client";

import { useState, useRef, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ChevronDown, LogOut } from "lucide-react";
import { useAppUser } from "./providers";

export function UserMenu() {
  const { ready, authenticated, login, logout, user: privyUser } = usePrivy();
  const { user, setUser } = useAppUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  if (!ready) return null;

  if (!authenticated) {
    return (
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={login}
          className="h-9 px-4 rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 hover:bg-zinc-200 transition-colors"
        >
          Log in
        </button>
      </div>
    );
  }

  const displayName = user?.name || privyUser?.phone?.number || "Account";

  function handleLogout() {
    setOpen(false);
    setUser(null);
    logout();
  }

  return (
    <div ref={ref} className="fixed top-4 right-4 z-50">
      <button
        onClick={() => setOpen(!open)}
        className="h-9 px-3 rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 hover:bg-zinc-200 transition-colors flex items-center gap-1.5"
      >
        {displayName}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-zinc-200 py-1 overflow-hidden">
          {privyUser?.phone?.number && (
            <div className="px-4 py-2 text-xs text-zinc-400 border-b border-zinc-100">
              {privyUser.phone.number}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
