"use client";

import { ExternalLink, Loader2, Check } from "lucide-react";

interface Props {
  transferMethod: string;
  onTransfer: () => void;
  disabled?: boolean;
  loading?: boolean;
  dealStatus?: string;
  isLatest?: boolean;
}

export function TransferPrompt({
  transferMethod,
  onTransfer,
  disabled,
  loading,
  dealStatus,
  isLatest = true,
}: Props) {
  // Already transferred — show completed badge
  if (dealStatus && dealStatus !== "FUNDED") {
    return (
      <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-blue-700 text-sm font-semibold">
          <Check className="w-4 h-4" />
          Tickets transferred
        </div>
      </div>
    );
  }

  // Older prompt — show static badge
  if (!isLatest) {
    return (
      <div className="mt-2 bg-zinc-50 border border-zinc-200 rounded-xl p-3">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <ExternalLink className="w-3.5 h-3.5" />
          Transfer requested
        </div>
      </div>
    );
  }

  // Active transfer button
  return (
    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-blue-700">
        Transfer the tickets via {transferMethod || "the agreed method"}, then confirm below.
      </p>
      <button
        onClick={onTransfer}
        disabled={disabled || loading}
        className="w-full h-10 rounded-xl bg-blue-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <ExternalLink className="w-4 h-4" />
            I&apos;ve transferred the tickets
          </>
        )}
      </button>
    </div>
  );
}
