"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY_PREFIX = "deal_anon_id_";

/**
 * Generates and persists an anonymous session ID per deal in localStorage.
 * Used to isolate chat threads for unauthenticated buyers.
 * Re-computes when dealId changes (e.g. from undefined to actual value).
 */
export function useAnonymousId(dealId: string | undefined): string {
  const [anonId, setAnonId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !dealId) return;
    const key = STORAGE_KEY_PREFIX + dealId;
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    setAnonId(id);
  }, [dealId]);

  return anonId;
}

/** Clear the anonymous ID for a deal (call after claiming the conversation). */
export function clearAnonymousId(dealId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY_PREFIX + dealId);
}
