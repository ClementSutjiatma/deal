"use client";

import { useState, useEffect, useRef } from "react";
import { List } from "lucide-react";
import Link from "next/link";

interface DealSummary {
  id: string;
  short_code: string;
  event_name: string;
  status: string;
  price_cents: number;
  num_tickets: number;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700",
  FUNDED: "bg-orange-100 text-orange-700",
  TRANSFERRED: "bg-blue-100 text-blue-700",
  CONFIRMED: "bg-green-100 text-green-700",
  RELEASED: "bg-green-100 text-green-700",
  AUTO_RELEASED: "bg-green-100 text-green-700",
  DISPUTED: "bg-red-100 text-red-700",
  RESOLVED: "bg-zinc-100 text-zinc-600",
  REFUNDED: "bg-zinc-100 text-zinc-600",
  AUTO_REFUNDED: "bg-zinc-100 text-zinc-600",
  EXPIRED: "bg-zinc-100 text-zinc-500",
  CANCELED: "bg-zinc-100 text-zinc-500",
};

interface Props {
  sellerId: string;
  currentDealId?: string;
}

export function ListingsDropdown({ sellerId, currentDealId }: Props) {
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchDeals() {
      const res = await fetch(`/api/deals/seller?seller_id=${sellerId}`);
      if (res.ok) {
        const data = await res.json();
        setDeals(data);
      }
    }
    fetchDeals();
  }, [sellerId]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 transition-colors text-zinc-600 text-xs font-medium"
      >
        <List className="w-3.5 h-3.5" />
        {deals.length > 0 && <span>{deals.length}</span>}
      </button>

      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-1 w-72 bg-white rounded-xl shadow-lg border border-zinc-200 overflow-hidden z-50"
        >
          <div className="px-3 py-2 border-b border-zinc-100">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Your listings
            </p>
          </div>
          {deals.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-zinc-400">No listings yet</p>
              <p className="text-xs text-zinc-300 mt-1">Create a deal to see it here</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-zinc-50">
              {deals.map((d) => {
                const isCurrent = d.id === currentDealId;
                return (
                  <Link
                    key={d.id}
                    href={`/deal/${d.short_code}`}
                    onClick={() => setOpen(false)}
                    className={`block px-3 py-2.5 hover:bg-zinc-50 transition-colors ${
                      isCurrent ? "bg-orange-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${isCurrent ? "text-orange-600" : "text-zinc-900"}`}>
                          {d.event_name}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {d.num_tickets} ticket{d.num_tickets !== 1 ? "s" : ""} · ${(d.price_cents / 100).toFixed(2)}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                          STATUS_COLORS[d.status] || "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
