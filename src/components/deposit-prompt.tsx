"use client";

import { Lock, Loader2, Check, LogIn } from "lucide-react";

interface Props {
  amountCents: number;
  onDeposit: () => void;
  disabled?: boolean;
  loading?: boolean;
  authenticated?: boolean;
  onLogin?: () => void;
  dealStatus?: string;
  isLatest?: boolean;
}

export function DepositPrompt({
  amountCents,
  onDeposit,
  disabled,
  loading,
  authenticated,
  onLogin,
  dealStatus,
  isLatest = true,
}: Props) {
  const priceDisplay = `$${(amountCents / 100).toFixed(2)}`;

  // Deal already funded — show "Deposited" badge
  if (dealStatus && dealStatus !== "OPEN") {
    return (
      <div className="mt-2 bg-green-50 border border-green-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-green-700 text-sm font-semibold">
          <Check className="w-4 h-4" />
          {priceDisplay} deposited
        </div>
      </div>
    );
  }

  // Older deposit prompt — show static badge (not clickable)
  if (!isLatest) {
    return (
      <div className="mt-2 bg-zinc-50 border border-zinc-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Lock className="w-3.5 h-3.5" />
          {priceDisplay} offered
        </div>
      </div>
    );
  }

  // Not authenticated — show "Log in to deposit" button
  if (!authenticated && onLogin) {
    return (
      <div className="mt-2 bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-orange-700">Ready to lock in this deal?</p>
        <button
          onClick={onLogin}
          className="w-full h-10 rounded-xl bg-orange-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors"
        >
          <LogIn className="w-4 h-4" />
          Log in to deposit {priceDisplay}
        </button>
      </div>
    );
  }

  // Default: active deposit button
  return (
    <div className="mt-2 bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-orange-700">Ready to lock in this deal?</p>
      <button
        onClick={onDeposit}
        disabled={disabled || loading}
        className="w-full h-10 rounded-xl bg-orange-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            Deposit {priceDisplay}
          </>
        )}
      </button>
    </div>
  );
}
