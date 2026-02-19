"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, TrendingUp, Lock, Scale } from "lucide-react";
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

export function LandingClient({ listings }: { listings: Listing[] }) {
  const [input, setInput] = useState("");
  const router = useRouter();

  const nudge = useMemo(() => getNudge(input), [input]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      router.push(`/sell?q=${encodeURIComponent(input.trim())}`);
    },
    [input, router]
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Ticker */}
      {listings.length > 0 && (
        <div className="w-full overflow-hidden bg-zinc-50 border-b border-zinc-100">
          <div className="animate-ticker flex whitespace-nowrap py-2.5">
            {/* Duplicate the list for seamless infinite scroll */}
            {[...listings, ...listings].map((listing, i) => (
              <a
                key={`${listing.short_code}-${i}`}
                href={`/deal/${listing.short_code}`}
                className="inline-flex items-center gap-1.5 px-4 text-xs text-zinc-400 hover:text-orange-500 transition-colors flex-shrink-0"
              >
                <span className="font-medium text-zinc-600">
                  {listing.event_name}
                </span>
                <span className="text-zinc-300">·</span>
                <span>{formatPrice(listing.price_cents)}</span>
                {listing.venue && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span>{listing.venue}</span>
                  </>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Logo */}
      <div className="px-6 pt-6 pb-0 max-w-lg w-full mx-auto">
        <a href="/" className="inline-flex items-center gap-1.5 text-lg font-bold text-zinc-900">
          <span className="text-xl">🤝</span>
          Dealbay
        </a>
      </div>

      {/* Hero + Input */}
      <main className="flex-1 flex flex-col items-center px-6 pt-12 pb-12">
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

        {/* Benefits */}
        <div className="max-w-lg w-full mt-16 space-y-6">
          <div className="flex gap-4 items-start">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Get the best price
              </h3>
              <p className="text-sm text-zinc-400 mt-0.5">
                Dealbay negotiates a price equal to or above your asking price, so you never sell for less.
              </p>
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
              <Lock className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Payment secured, zero fees
              </h3>
              <p className="text-sm text-zinc-400 mt-0.5">
                Funds lock the moment a buyer commits. Auto-releases on confirmation. No fees, ever.
              </p>
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
              <Scale className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Automated dispute resolution
              </h3>
              <p className="text-sm text-zinc-400 mt-0.5">
                Evidence-based: Dealbay gathers evidence and adjudicates payment should any dispute come up.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-zinc-400">
        Powered by USDC on Base. Gas costs less than a penny.
      </footer>
    </div>
  );
}
