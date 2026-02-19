"use client";

import { useState, useCallback } from "react";

export type EscrowStep =
  | "idle"
  | "approving"
  | "depositing"
  | "confirming"
  | "transferring"
  | "disputing"
  | "done"
  | "error";

export function useEscrow() {
  const [step, setStep] = useState<EscrowStep>("idle");
  const [error, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const setLoading = useCallback((s: EscrowStep) => {
    setStep(s);
    setErrorMsg(null);
    setTxHash(null);
  }, []);

  const setDone = useCallback((hash?: string) => {
    setTxHash(hash ?? null);
    setStep("done");
  }, []);

  const setError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setStep("error");
  }, []);

  const reset = useCallback(() => {
    setStep("idle");
    setErrorMsg(null);
    setTxHash(null);
  }, []);

  return {
    step,
    error,
    txHash,
    setLoading,
    setDone,
    setError,
    reset,
    isLoading: !["idle", "done", "error"].includes(step),
  };
}
