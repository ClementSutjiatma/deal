"use client";

import { useState } from "react";

const STORAGE_KEY_PREFIX = "deal_anon_id_";

/**
 * Generates and persists an anonymous session ID per deal in localStorage.
 * Used to isolate chat threads for unauthenticated buyers.
 */
export function useAnonymousId(dealId: string | undefined): string {
  const [anonId] = useState(() => {
    if (typeof window === "undefined" || !dealId) return "";
    const key = STORAGE_KEY_PREFIX + dealId;
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  });
  return anonId;
}

/** Clear the anonymous ID for a deal (call after claiming the conversation). */
export function clearAnonymousId(dealId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY_PREFIX + dealId);
}
