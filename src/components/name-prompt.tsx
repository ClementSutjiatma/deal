"use client";

import { useState } from "react";
import { useAppUser } from "./providers";

export function NamePrompt() {
  const { user, setUser } = useAppUser();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (user?.name) return null;
  if (!user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving || !user) return;

    setSaving(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privy_user_id: user!.privy_user_id,
          phone: user!.phone,
          name: name.trim(),
          wallet_address: user!.wallet_address,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-emerald-50 rounded-2xl p-4 mb-4">
      <p className="text-sm font-medium text-zinc-700 mb-2">
        What should we call you?
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name"
          className="flex-1 h-10 px-4 rounded-xl bg-white text-sm outline-none focus:ring-2 focus:ring-emerald-600/50"
        />
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </form>
  );
}
