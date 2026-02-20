"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAppUser } from "@/components/providers";
import { useUsdcBalance } from "@/lib/hooks/useUsdcBalance";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";

const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "84532";
const explorerBase = isTestnet
  ? "https://sepolia.basescan.org"
  : "https://basescan.org";

interface DealInfo {
  id: string;
  short_code: string;
  event_name: string;
  status: string;
  price_cents: number;
  num_tickets: number;
  seller_id: string;
  buyer_id: string | null;
  escrow_tx_hash: string | null;
  funded_at: string | null;
  transferred_at: string | null;
  confirmed_at: string | null;
  disputed_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface DealEvent {
  id: string;
  deal_id: string;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// Map event types to display info
const EVENT_CONFIG: Record<
  string,
  {
    label: string;
    icon: "in" | "out" | "neutral";
    color: string;
    bgColor: string;
  }
> = {
  funded: {
    label: "Deposited to escrow",
    icon: "out",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
  },
  transferred: {
    label: "Tickets transferred",
    icon: "neutral",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  confirmed: {
    label: "Deal confirmed",
    icon: "in",
    color: "text-green-600",
    bgColor: "bg-green-50",
  },
  disputed: {
    label: "Dispute filed",
    icon: "neutral",
    color: "text-red-600",
    bgColor: "bg-red-50",
  },
  resolved: {
    label: "Dispute resolved",
    icon: "neutral",
    color: "text-zinc-600",
    bgColor: "bg-zinc-50",
  },
  auto_released: {
    label: "Auto-released to seller",
    icon: "in",
    color: "text-green-600",
    bgColor: "bg-green-50",
  },
  auto_refunded: {
    label: "Auto-refunded to buyer",
    icon: "in",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
  },
  expired: {
    label: "Deal expired",
    icon: "neutral",
    color: "text-zinc-400",
    bgColor: "bg-zinc-50",
  },
};

export default function WalletPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { user } = useAppUser();
  const [deals, setDeals] = useState<DealInfo[]>([]);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address || null;
  const { formatted: usdcFormatted } = useUsdcBalance(walletAddress);

  useEffect(() => {
    if (!user?.id) return;
    async function fetchTransactions() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/wallet/transactions?user_id=${user!.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setDeals(data.deals);
          setEvents(data.events);
        }
      } catch (err) {
        console.error("Failed to fetch transactions:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchTransactions();
  }, [user?.id]);

  if (!ready) return null;

  if (!authenticated || !user) {
    return (
      <div className="flex flex-col h-screen max-w-lg mx-auto px-4 items-center justify-center gap-4">
        <Wallet className="w-10 h-10 text-zinc-300" />
        <p className="text-sm text-zinc-500">Log in to view your wallet</p>
        <button
          onClick={login}
          className="px-6 py-2.5 rounded-full bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
        >
          Log in
        </button>
      </div>
    );
  }

  // Build a transaction list: combine events with deal context
  const dealMap = new Map(deals.map((d) => [d.id, d]));

  // Build enriched transactions
  const transactions = events
    .filter((e) => EVENT_CONFIG[e.event_type])
    .map((e) => {
      const deal = dealMap.get(e.deal_id);
      if (!deal) return null;

      const config = EVENT_CONFIG[e.event_type];
      const isSeller = deal.seller_id === user.id;
      const txHash =
        e.metadata?.tx_hash ||
        e.metadata?.escrow_tx_hash ||
        e.metadata?.transfer_tx_hash ||
        e.metadata?.confirm_tx_hash ||
        e.metadata?.dispute_tx_hash ||
        null;

      // Determine the amount direction based on user role and event type
      let amount: number | null = null;
      let direction: "in" | "out" | "neutral" = "neutral";

      if (e.event_type === "funded") {
        amount = deal.price_cents;
        direction = isSeller ? "neutral" : "out"; // buyer pays out
      } else if (
        e.event_type === "confirmed" ||
        e.event_type === "auto_released"
      ) {
        amount = deal.price_cents;
        direction = isSeller ? "in" : "neutral"; // seller receives
      } else if (
        e.event_type === "auto_refunded" ||
        (e.event_type === "resolved" && e.metadata?.favor_buyer)
      ) {
        amount = deal.price_cents;
        direction = isSeller ? "neutral" : "in"; // buyer gets refund
      } else if (
        e.event_type === "resolved" &&
        e.metadata?.favor_buyer === false
      ) {
        amount = deal.price_cents;
        direction = isSeller ? "in" : "neutral"; // seller gets funds
      }

      return {
        ...e,
        deal,
        config,
        txHash,
        amount,
        direction,
        isSeller,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    deal_id: string;
    event_type: string;
    actor_id: string | null;
    metadata: Record<string, any> | null;
    created_at: string;
    deal: DealInfo;
    config: (typeof EVENT_CONFIG)[string];
    txHash: string | null;
    amount: number | null;
    direction: "in" | "out" | "neutral";
    isSeller: boolean;
  }>;

  // Custom label for the user's perspective
  function getLabel(tx: (typeof transactions)[0]) {
    if (tx.event_type === "funded") {
      return tx.isSeller ? "Buyer deposited" : "You deposited";
    }
    if (tx.event_type === "transferred") {
      return tx.isSeller ? "You transferred tickets" : "Seller transferred tickets";
    }
    if (tx.event_type === "confirmed") {
      return tx.isSeller ? "Funds released to you" : "You confirmed receipt";
    }
    if (tx.event_type === "auto_released") {
      return tx.isSeller ? "Funds auto-released to you" : "Funds auto-released";
    }
    if (tx.event_type === "auto_refunded") {
      return tx.isSeller ? "Buyer auto-refunded" : "Refunded to you";
    }
    if (tx.event_type === "disputed") {
      return tx.isSeller ? "Buyer filed dispute" : "You filed a dispute";
    }
    if (tx.event_type === "resolved") {
      if (tx.metadata?.favor_buyer) {
        return tx.isSeller ? "Refunded to buyer" : "Refunded to you";
      }
      return tx.isSeller ? "Funds released to you" : "Funds released to seller";
    }
    return tx.config.label;
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Header */}
      <div className="px-4 pt-14 pb-4 border-b border-zinc-200">
        <div className="flex items-center gap-3 mb-4">
          <Link
            href="/"
            className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-zinc-600" />
          </Link>
          <h1 className="text-lg font-bold">Wallet</h1>
        </div>

        {/* Balance card */}
        <div className="bg-zinc-50 rounded-2xl p-4">
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide mb-1">
            USDC Balance
          </p>
          <p className="text-3xl font-bold text-zinc-900 mb-3">
            ${usdcFormatted ?? "..."}
            {isTestnet && (
              <span className="text-xs font-semibold ml-2 px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-500 uppercase align-middle">
                Testnet
              </span>
            )}
          </p>

          {/* Wallet address */}
          {user.wallet_address && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(user.wallet_address!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span className="font-mono">
                {user.wallet_address.slice(0, 6)}...
                {user.wallet_address.slice(-4)}
              </span>
              <a
                href={`${explorerBase}/address/${user.wallet_address}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-1 hover:text-emerald-600"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </button>
          )}
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">
            Transactions
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-zinc-300 animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <RefreshCw className="w-8 h-8 text-zinc-200" />
            <p className="text-sm text-zinc-400">No transactions yet</p>
            <p className="text-xs text-zinc-300">
              Deposits and payouts will appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {transactions.map((tx) => (
              <Link
                key={tx.id}
                href={`/deal/${tx.deal.short_code}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
              >
                {/* Direction icon */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${tx.config.bgColor}`}
                >
                  {tx.direction === "in" ? (
                    <ArrowDownLeft
                      className={`w-4 h-4 ${tx.config.color}`}
                    />
                  ) : tx.direction === "out" ? (
                    <ArrowUpRight
                      className={`w-4 h-4 ${tx.config.color}`}
                    />
                  ) : (
                    <RefreshCw className={`w-3.5 h-3.5 ${tx.config.color}`} />
                  )}
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 truncate">
                    {getLabel(tx)}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">
                    {tx.deal.event_name}
                    {tx.txHash && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={`${explorerBase}/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-emerald-600 hover:underline"
                        >
                          tx
                        </a>
                      </>
                    )}
                  </p>
                </div>

                {/* Amount + timestamp */}
                <div className="text-right flex-shrink-0">
                  {tx.amount !== null && tx.direction !== "neutral" && (
                    <p
                      className={`text-sm font-semibold ${
                        tx.direction === "in"
                          ? "text-green-600"
                          : "text-zinc-900"
                      }`}
                    >
                      {tx.direction === "in" ? "+" : "-"}$
                      {(tx.amount / 100).toFixed(2)}
                    </p>
                  )}
                  <p className="text-[10px] text-zinc-400">
                    {formatTime(tx.created_at)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
