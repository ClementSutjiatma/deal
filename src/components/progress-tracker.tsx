"use client";

import { Check, Circle, AlertTriangle } from "lucide-react";
import { DEAL_STATUSES, type DealStatus } from "@/lib/constants";

const STEPS = [
  { label: "Listed", statuses: [DEAL_STATUSES.OPEN] },
  { label: "Funded", statuses: [DEAL_STATUSES.FUNDED] },
  { label: "Sent", statuses: [DEAL_STATUSES.TRANSFERRED] },
  { label: "Done", statuses: [DEAL_STATUSES.RELEASED, DEAL_STATUSES.CONFIRMED, DEAL_STATUSES.AUTO_RELEASED] },
];

const STATUS_ORDER: Record<string, number> = {
  OPEN: 0,
  FUNDED: 1,
  TRANSFERRED: 2,
  CONFIRMED: 3,
  RELEASED: 3,
  AUTO_RELEASED: 3,
  DISPUTED: 2.5,
  RESOLVED: 3,
  REFUNDED: 3,
  AUTO_REFUNDED: 1.5,
  EXPIRED: -1,
  CANCELED: -1,
};

interface Props {
  status: DealStatus;
}

export function ProgressTracker({ status }: Props) {
  const currentIdx = STATUS_ORDER[status] ?? -1;
  const isDisputed = status === DEAL_STATUSES.DISPUTED || status === DEAL_STATUSES.RESOLVED;
  const isRefunded = status === DEAL_STATUSES.REFUNDED || status === DEAL_STATUSES.AUTO_REFUNDED;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isComplete = currentIdx > i;
          const isCurrent = Math.floor(currentIdx) === i;

          return (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    isComplete
                      ? "bg-green-500 text-white"
                      : isCurrent
                        ? "bg-orange-500 text-white"
                        : "bg-zinc-100 text-zinc-400"
                  }`}
                >
                  {isComplete ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span
                  className={`text-xs mt-1 font-medium ${
                    isComplete || isCurrent ? "text-zinc-900" : "text-zinc-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mt-[-18px] ${
                    currentIdx > i ? "bg-green-500" : "bg-zinc-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Dispute branch */}
      {isDisputed && (
        <div className="mt-3 flex items-center gap-2 text-amber-600 text-sm font-medium">
          <AlertTriangle className="w-4 h-4" />
          Dispute in progress
        </div>
      )}
      {isRefunded && (
        <div className="mt-3 flex items-center gap-2 text-red-500 text-sm font-medium">
          <AlertTriangle className="w-4 h-4" />
          Refunded
        </div>
      )}
    </div>
  );
}
