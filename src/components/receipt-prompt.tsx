"use client";

import { Check, AlertTriangle, Loader2 } from "lucide-react";

interface Props {
  transferMethod: string;
  onConfirm: () => void;
  onDispute: () => void;
  disabled?: boolean;
  confirmLoading?: boolean;
  disputeLoading?: boolean;
  dealStatus?: string;
  isLatest?: boolean;
}

export function ReceiptPrompt({
  transferMethod,
  onConfirm,
  onDispute,
  disabled,
  confirmLoading,
  disputeLoading,
  dealStatus,
  isLatest = true,
}: Props) {
  const loading = confirmLoading || disputeLoading;

  // Already confirmed/released — show completed badge
  if (dealStatus === "RELEASED" || dealStatus === "AUTO_RELEASED" || dealStatus === "CONFIRMED") {
    return (
      <div className="mt-2 bg-green-50 border border-green-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-green-700 text-sm font-semibold">
          <Check className="w-4 h-4" />
          Tickets received — funds released
        </div>
      </div>
    );
  }

  // Disputed
  if (dealStatus === "DISPUTED") {
    return (
      <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
          <AlertTriangle className="w-4 h-4" />
          Dispute filed
        </div>
      </div>
    );
  }

  // Older prompt — show static badge
  if (!isLatest) {
    return (
      <div className="mt-2 bg-zinc-50 border border-zinc-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Check className="w-3.5 h-3.5" />
          Receipt confirmation requested
        </div>
      </div>
    );
  }

  // Active confirm/dispute buttons
  return (
    <div className="mt-2 bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-green-700">
        The seller says they transferred the tickets via {transferMethod || "the agreed method"}. Did you receive them?
      </p>
      <button
        onClick={onConfirm}
        disabled={disabled || loading}
        className="w-full h-10 rounded-xl bg-green-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors disabled:opacity-50"
      >
        {confirmLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Releasing funds...
          </>
        ) : (
          <>
            <Check className="w-4 h-4" />
            Got them — release funds
          </>
        )}
      </button>
      <button
        onClick={onDispute}
        disabled={disabled || loading}
        className="w-full h-10 rounded-xl bg-zinc-100 text-zinc-700 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
      >
        {disputeLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Filing dispute...
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4" />
            Something&apos;s wrong
          </>
        )}
      </button>
    </div>
  );
}
