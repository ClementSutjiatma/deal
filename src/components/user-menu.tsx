"use client";

import { useState, useRef, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Copy,
  Check,
  Tag,
  ShoppingBag,
  Wallet,
  ArrowUpRight,
  Loader2,
  Plus,
} from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAppUser } from "./providers";
import { useUsdcBalance } from "@/lib/hooks/useUsdcBalance";

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
  FUNDED: "bg-emerald-100 text-emerald-800",
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

const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "84532";

export function UserMenu() {
  const { ready, authenticated, login, logout, user: privyUser } = usePrivy();
  const { wallets } = useWallets();
  const { user, setUser } = useAppUser();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const [sellerDeals, setSellerDeals] = useState<DealSummary[]>([]);
  const [buyerDeals, setBuyerDeals] = useState<DealSummary[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Get embedded wallet address for balance
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address || null;

  // USDC balance (polls every 10s)
  const { formatted: usdcFormatted, balance: usdcBalance } =
    useUsdcBalance(walletAddress);

  const hasBalance = usdcBalance !== null && usdcBalance > BigInt(0);

  // Extract current deal short_code from URL
  const currentShortCode = pathname?.startsWith("/deal/")
    ? pathname.split("/")[2]
    : null;

  // Close dropdown on click outside
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

  // Fetch deals when user logs in, and refetch every time the dropdown opens
  useEffect(() => {
    if (!user?.id) {
      setSellerDeals([]);
      setBuyerDeals([]);
      return;
    }
    async function fetchDeals() {
      const [sellerRes, buyerRes] = await Promise.all([
        fetch(`/api/deals/seller?seller_id=${user!.id}`),
        fetch(`/api/deals/buyer?buyer_id=${user!.id}`),
      ]);
      if (sellerRes.ok) setSellerDeals(await sellerRes.json());
      if (buyerRes.ok) setBuyerDeals(await buyerRes.json());
    }
    fetchDeals();
  }, [user?.id, open]); // refetch when dropdown opens

  if (!ready) return null;

  if (!authenticated) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        {pathname !== "/sell" && (
          <Link
            href="/sell"
            className="h-9 px-3 rounded-full bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Sell
          </Link>
        )}
        <button
          onClick={login}
          className="h-9 px-4 rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 hover:bg-zinc-200 transition-colors"
        >
          Log in
        </button>
      </div>
    );
  }

  const displayName =
    user?.name ||
    privyUser?.phone?.number ||
    privyUser?.email?.address ||
    "Account";

  // Filter out deals that appear in both lists
  const sellerDealIds = new Set(sellerDeals.map((d) => d.id));
  const filteredBuyerDeals = buyerDeals.filter((d) => !sellerDealIds.has(d.id));

  const hasDeals = sellerDeals.length > 0 || filteredBuyerDeals.length > 0;

  function handleLogout() {
    setOpen(false);
    setUser(null);
    logout();
  }

  async function handleCashout() {
    if (!walletAddress || !usdcFormatted || !hasBalance) return;

    setCashoutLoading(true);
    try {
      const res = await fetch("/api/offramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: walletAddress,
          amount: usdcFormatted,
          userId: user?.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error("Offramp error:", err);
        return;
      }

      const { url } = await res.json();
      window.open(url, "_blank");
    } catch (err) {
      console.error("Cashout error:", err);
    } finally {
      setCashoutLoading(false);
    }
  }

  return (
    <div ref={ref} className="fixed top-4 right-4 z-50 flex items-center gap-2">
      {pathname !== "/sell" && (
        <Link
          href="/sell"
          className="h-9 px-3 rounded-full bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Sell
        </Link>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="h-9 px-3 rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 hover:bg-zinc-200 transition-colors flex items-center gap-1.5"
      >
        {displayName}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-zinc-200 overflow-hidden max-h-[calc(100dvh-4rem)] overflow-y-auto">
          {/* Account info */}
          {(privyUser?.phone?.number || privyUser?.email?.address) && (
            <div className="px-4 py-2 text-xs text-zinc-400 border-b border-zinc-100">
              {privyUser?.phone?.number || privyUser?.email?.address}
            </div>
          )}

          {/* Wallet address + balance */}
          {user?.wallet_address && (
            <div className="border-b border-zinc-100">
              <div className="flex items-center">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(user.wallet_address!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex-1 px-4 py-2 text-xs text-zinc-500 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="truncate font-mono">
                    {user.wallet_address.slice(0, 6)}...
                    {user.wallet_address.slice(-4)}
                  </span>
                </button>
              </div>

              {/* Balance row — links to /wallet */}
              <Link
                href="/wallet"
                onClick={() => setOpen(false)}
                className="px-4 py-2 flex items-center justify-between hover:bg-zinc-50 transition-colors"
              >
                <span className="flex items-center gap-1.5 text-xs text-zinc-600">
                  <Wallet className="w-3 h-3 text-zinc-400" />
                  <span className="font-medium">
                    {usdcFormatted ?? "..."} USDC
                  </span>
                  {isTestnet && (
                    <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-zinc-100 text-zinc-400 uppercase">
                      Testnet
                    </span>
                  )}
                </span>

                {/* Cash out button (mainnet only, when balance > 0) */}
                {!isTestnet && hasBalance ? (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCashout();
                    }}
                    disabled={cashoutLoading}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-50 text-green-700 text-[11px] font-semibold hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    {cashoutLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <ArrowUpRight className="w-3 h-3" />
                        Cash out
                      </>
                    )}
                  </button>
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-300" />
                )}
              </Link>
            </div>
          )}

          {/* Seller listings */}
          {sellerDeals.length > 0 && (
            <div className="border-b border-zinc-100">
              <div className="px-3 py-2 flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-zinc-400" />
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
                  Your listings
                </p>
              </div>
              <DealList
                deals={sellerDeals}
                currentShortCode={currentShortCode}
                onSelect={() => setOpen(false)}
              />
            </div>
          )}

          {/* Buyer deals (following) */}
          {filteredBuyerDeals.length > 0 && (
            <div className="border-b border-zinc-100">
              <div className="px-3 py-2 flex items-center gap-1.5">
                <ShoppingBag className="w-3 h-3 text-zinc-400" />
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
                  Your deals
                </p>
              </div>
              <DealList
                deals={filteredBuyerDeals}
                currentShortCode={currentShortCode}
                onSelect={() => setOpen(false)}
              />
            </div>
          )}

          {/* No deals message */}
          {!hasDeals && (
            <div className="px-4 py-3 text-center border-b border-zinc-100">
              <p className="text-xs text-zinc-400">No deals yet</p>
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function DealList({
  deals,
  currentShortCode,
  onSelect,
}: {
  deals: DealSummary[];
  currentShortCode: string | null;
  onSelect: () => void;
}) {
  return (
    <div className="max-h-48 overflow-y-auto divide-y divide-zinc-50">
      {deals.map((d) => {
        const isCurrent = d.short_code === currentShortCode;
        return (
          <Link
            key={d.id}
            href={`/deal/${d.short_code}`}
            onClick={onSelect}
            className={`block px-3 py-2 hover:bg-zinc-50 transition-colors ${
              isCurrent ? "bg-emerald-50" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium truncate ${isCurrent ? "text-emerald-700" : "text-zinc-900"}`}
                >
                  {d.event_name}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {d.num_tickets} ticket{d.num_tickets !== 1 ? "s" : ""} · $
                  {(d.price_cents / 100).toFixed(2)}
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
  );
}
