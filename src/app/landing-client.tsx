"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Ticket } from "lucide-react";
import { TextMorph } from "torph/react";

interface Listing {
  short_code: string;
  event_name: string;
  venue: string | null;
  num_tickets: number;
  price_cents: number;
  created_at: string;
}

// Detect what's missing from the user's input to nudge for more detail
function getNudge(input: string): string {
  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return 'e.g. "2 Taylor Swift tickets, section 204, $150 each"';
  }

  const hasPrice = /\$\d|(\d+)\s*(dollars|bucks|each|per)/i.test(input);
  const hasLocation =
    /section|row|seat|ga|general|floor|pit|balcony|mezzanine|vip/i.test(input) ||
    /at\s+\w|@\s*\w|stadium|arena|center|theatre|theater|garden|field|park/i.test(input);
  const hasQuantity = /\d+\s*(ticket|tix|pair|set)/i.test(input) || /^[1-9]\s/i.test(input);

  const missing: string[] = [];

  if (!hasQuantity) missing.push("how many tickets");
  if (!hasPrice) missing.push("what's the price");
  if (!hasLocation) missing.push("section or venue");

  if (missing.length === 0) {
    return "Looks good — hit enter to list it";
  }

  if (missing.length === 1) {
    return `Add ${missing[0]} and you're set`;
  }

  return `Try adding ${missing[0]} and ${missing[1]}`;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function LandingClient({ listings }: { listings: Listing[] }) {
  const [input, setInput] = useState("");
  const router = useRouter();

  const nudge = useMemo(() => getNudge(input), [input]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      // Navigate to /sell with the description pre-filled as a query param
      router.push(`/sell?q=${encodeURIComponent(input.trim())}`);
    },
    [input, router]
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero + Input */}
      <main className="flex-1 flex flex-col items-center px-6 pt-24 pb-12">
        <div className="max-w-lg w-full space-y-4">
          {/* Title */}
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            I&rsquo;m selling
          </h1>

          {/* Input area */}
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="2 Taylor Swift tickets, section 204, $150 each..."
                rows={3}
                className="w-full resize-none rounded-2xl border border-zinc-200 bg-white px-5 py-4 pr-14 text-base outline-none placeholder:text-zinc-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute right-3 bottom-3 w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors disabled:opacity-30 disabled:hover:bg-orange-500"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Nudge text */}
          <TextMorph
            as="p"
            className="text-sm text-zinc-400 h-5"
            duration={400}
          >
            {nudge}
          </TextMorph>
        </div>

        {/* Listings grid */}
        {listings.length > 0 && (
          <div className="max-w-lg w-full mt-16">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">
              Live listings
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {listings.map((listing) => (
                <a
                  key={listing.short_code}
                  href={`/deal/${listing.short_code}`}
                  className="group rounded-2xl border border-zinc-100 bg-zinc-50/50 p-4 hover:border-orange-200 hover:bg-orange-50/30 transition-colors"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-200 transition-colors">
                      <Ticket className="w-4 h-4 text-orange-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 truncate">
                        {listing.event_name}
                      </p>
                      {listing.venue && (
                        <p className="text-xs text-zinc-400 truncate mt-0.5">
                          {listing.venue}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between mt-3">
                    <span className="text-sm font-semibold text-zinc-900">
                      {formatPrice(listing.price_cents)}
                      <span className="text-xs font-normal text-zinc-400">
                        {listing.num_tickets > 1
                          ? ` × ${listing.num_tickets}`
                          : " ea"}
                      </span>
                    </span>
                    <span className="text-xs text-zinc-300">
                      {timeAgo(listing.created_at)}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-zinc-400">
        Powered by USDC on Base. Gas costs less than a penny.
      </footer>
    </div>
  );
}
