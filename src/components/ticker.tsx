"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Listing {
  short_code: string;
  event_name: string;
  venue: string | null;
  section: string | null;
  num_tickets: number;
  price_cents: number;
  created_at: string;
}

export function Ticker() {
  const [listings, setListings] = useState<Listing[]>([]);

  useEffect(() => {
    async function fetchListings() {
      try {
        const res = await fetch("/api/listings");
        if (res.ok) {
          const data = await res.json();
          setListings(data.listings ?? []);
        }
      } catch {
        // Silently fail — ticker is non-critical
      }
    }
    fetchListings();
  }, []);

  return (
    <div className="w-full bg-zinc-50 border-b border-zinc-100 flex items-center">
      {/* Logo — fixed left */}
      <Link
        href="/"
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 text-base font-bold text-zinc-900 hover:text-orange-500 transition-colors"
      >
        <span className="text-lg">🤝</span>
        Dealbay
      </Link>

      {/* Scrolling ticker */}
      {listings.length > 0 && (
        <div className="flex-1 overflow-hidden">
          <div className="animate-ticker flex whitespace-nowrap py-2.5">
            {[...listings, ...listings].map((listing, i) => (
              <Link
                key={`${listing.short_code}-${i}`}
                href={`/deal/${listing.short_code}`}
                className="inline-flex items-center gap-1.5 px-4 text-xs text-zinc-400 hover:text-orange-500 transition-colors flex-shrink-0"
              >
                <span className="font-medium text-zinc-600">
                  {listing.event_name}
                </span>
                {listing.section && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span>{listing.section}</span>
                  </>
                )}
                {listing.venue && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span>{listing.venue}</span>
                  </>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
