"use client";

import { Scale, Check, AlertTriangle } from "lucide-react";

interface Props {
  ruling: "BUYER" | "SELLER";
  reasoning: string;
  dealStatus?: string;
}

export function DisputeRuling({ ruling, reasoning, dealStatus }: Props) {
  const favorBuyer = ruling === "BUYER";
  const isResolved = dealStatus === "REFUNDED" || dealStatus === "RELEASED"
    || dealStatus === "AUTO_REFUNDED" || dealStatus === "AUTO_RELEASED";

  return (
    <div className={`mt-2 border rounded-xl p-3 space-y-2 ${
      favorBuyer
        ? "bg-blue-50 border-blue-200"
        : "bg-green-50 border-green-200"
    }`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Scale className="w-4 h-4 text-zinc-600" />
        <span className="text-zinc-900">Dispute Ruling</span>
      </div>

      <p className="text-sm text-zinc-700">{reasoning}</p>

      <div className={`flex items-center gap-2 text-sm font-semibold ${
        isResolved
          ? favorBuyer ? "text-blue-700" : "text-green-700"
          : "text-zinc-500"
      }`}>
        {isResolved ? (
          <>
            <Check className="w-4 h-4" />
            {favorBuyer ? "Funds refunded to buyer" : "Funds released to seller"}
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4" />
            Resolving on-chain...
          </>
        )}
      </div>
    </div>
  );
}
