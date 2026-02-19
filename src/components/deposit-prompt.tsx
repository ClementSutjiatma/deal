"use client";

import { Lock, Loader2 } from "lucide-react";

interface Props {
  amountCents: number;
  onDeposit: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function DepositPrompt({ amountCents, onDeposit, disabled, loading }: Props) {
  const priceDisplay = `$${(amountCents / 100).toFixed(2)}`;

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
