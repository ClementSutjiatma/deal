"use client";

import { useEffect, useState, useCallback, use } from "react";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth";
import { useAppUser } from "@/components/providers";
import { ProgressTracker } from "@/components/progress-tracker";
import { Chat } from "@/components/chat";
import { SellerDashboard } from "@/components/seller-dashboard";
import { ConversationReadView } from "@/components/conversation-read-view";
import { Copy, Check, ExternalLink, Lock, Clock, AlertTriangle, Loader2, Plus, Wallet } from "lucide-react";
import { useEscrow, type EscrowStep } from "@/lib/hooks/useEscrow";
import { useUsdcBalance } from "@/lib/hooks/useUsdcBalance";
import { useAnonymousId, clearAnonymousId } from "@/lib/hooks/useAnonymousId";
import { createClient } from "@/lib/supabase/client";
import type { Deal, Conversation } from "@/lib/types/database";
import type { DealStatus } from "@/lib/constants";
import { base } from "viem/chains";

const STEP_LABELS: Record<EscrowStep, string> = {
  idle: "",
  approving: "Approving USDC...",
  depositing: "Depositing to escrow...",
  confirming: "Confirming transaction...",
  transferring: "Marking as transferred...",
  disputing: "Filing dispute...",
  done: "Done!",
  error: "Transaction failed",
};

export default function DealPage({ params }: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = use(params);
  const { authenticated, login, user: privyUser, getAccessToken } = usePrivy();
  const { user, syncUser } = useAppUser();
  const [deal, setDeal] = useState<(Deal & { seller: { id: string; name: string | null } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Buyer conversation state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationStatus, setConversationStatus] = useState<string | null>(null);
  const [negotiatedPriceCents, setNegotiatedPriceCents] = useState<number | null>(null);

  // Seller dashboard state
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedBuyerName, setSelectedBuyerName] = useState<string>("");

  const escrow = useEscrow();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();
  const [fundingLoading, setFundingLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Get embedded wallet address for balance checking
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address || null;

  const { balance: usdcBalance, formatted: usdcFormatted, refetch: refetchBalance } = useUsdcBalance(walletAddress);

  const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "84532";
  const supabase = createClient();

  // Access token for Chat transport (refreshed on auth state changes)
  const [chatAccessToken, setChatAccessToken] = useState<string | null>(null);
  useEffect(() => {
    if (authenticated) {
      getAccessToken().then((t) => setChatAccessToken(t));
    } else {
      setChatAccessToken(null);
    }
  }, [authenticated, getAccessToken]);

  // Anonymous buyer ID (generated per-deal, stored in localStorage)
  const anonymousId = useAnonymousId(deal?.id);

  /** Helper to make authenticated API calls */
  async function authFetch(url: string, options: RequestInit = {}) {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return fetch(url, { ...options, headers });
  }

  const fetchDeal = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${shortCode}`);
      if (res.ok) {
        const data = await res.json();
        setDeal(data);
      } else {
        setError("Deal not found");
      }
    } catch {
      setError("Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [shortCode]);

  useEffect(() => {
    fetchDeal();
    const interval = setInterval(fetchDeal, 10000);
    return () => clearInterval(interval);
  }, [fetchDeal]);

  // Sync Privy user -> app user (populates privy_wallet_id, wallet_address, etc.)
  const [hasSynced, setHasSynced] = useState(false);
  useEffect(() => {
    if (authenticated && privyUser && !hasSynced && (!user || !user.privy_wallet_id)) {
      (async () => {
        const token = await getAccessToken();
        if (token) {
          await syncUser(privyUser, token);
          setHasSynced(true);
        }
      })();
    }
  }, [authenticated, privyUser, user, syncUser, hasSynced, getAccessToken]);

  // Fetch/create buyer conversation when deal loads
  // Handles: authenticated buyers, anonymous buyers, and sellers on post-OPEN deals
  useEffect(() => {
    if (!deal) return;

    const isSeller = user?.id === deal.seller_id;

    if (isSeller) {
      // Seller: only need conversation scoping for post-OPEN deals with a buyer
      if (deal.status === "OPEN" || !deal.buyer_id) return;

      async function fetchClaimedConversation() {
        const res = await fetch(`/api/deals/${deal!.id}/conversations?seller_id=${user!.id}`);
        if (res.ok) {
          const convs: Conversation[] = await res.json();
          // Find the claimed conversation (preferred) or the one with buyer_id matching deal.buyer_id
          const claimed = convs.find((c) => c.status === "claimed")
            || convs.find((c) => c.buyer_id === deal!.buyer_id);
          if (claimed) {
            setConversationId(claimed.id);
            setConversationStatus(claimed.status);
            if (claimed.negotiated_price_cents) {
              setNegotiatedPriceCents(claimed.negotiated_price_cents);
            }
          }
        }
      }
      fetchClaimedConversation();
      return;
    }

    // Authenticated buyer
    if (user) {
      if (deal.status !== "OPEN" && user.id !== deal.buyer_id) return;

      async function initAuthenticatedConversation() {
        const res = await fetch(`/api/deals/${deal!.id}/conversations?buyer_id=${user!.id}`);
        if (res.ok) {
          const conv: Conversation = await res.json();
          setConversationId(conv.id);
          setConversationStatus(conv.status);
          if (conv.negotiated_price_cents) {
            setNegotiatedPriceCents(conv.negotiated_price_cents);
          }
        }
      }
      initAuthenticatedConversation();
      return;
    }

    // Anonymous buyer (not authenticated, deal is OPEN)
    if (!authenticated && deal.status === "OPEN" && anonymousId) {
      async function initAnonymousConversation() {
        const res = await fetch(`/api/deals/${deal!.id}/conversations?anonymous_id=${anonymousId}`);
        if (res.ok) {
          const conv: Conversation = await res.json();
          setConversationId(conv.id);
          setConversationStatus(conv.status);
        }
      }
      initAnonymousConversation();
    }
  }, [deal?.id, deal?.seller_id, deal?.status, deal?.buyer_id, user?.id, authenticated, anonymousId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auth transition: claim anonymous conversation when user logs in
  useEffect(() => {
    if (!user || !anonymousId || !deal || !conversationId) return;
    if (user.id === deal.seller_id) return; // seller doesn't claim

    async function claimAnonymousConversation() {
      try {
        const res = await fetch(`/api/deals/${deal!.id}/conversations/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anonymous_id: anonymousId,
            buyer_id: user!.id,
          }),
        });
        if (res.ok) {
          const conv: Conversation = await res.json();
          setConversationId(conv.id);
          setConversationStatus(conv.status);
          if (conv.negotiated_price_cents) {
            setNegotiatedPriceCents(conv.negotiated_price_cents);
          }
          // Clear the anonymous ID from localStorage
          clearAnonymousId(deal!.id);
        }
      } catch {
        // Claim failed -- not critical, user can still chat with new conversation
      }
    }
    claimAnonymousConversation();
  }, [user?.id, anonymousId, deal?.id, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to conversation status changes (for buyer -- detect "closed")
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conv-status:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Conversation;
          setConversationStatus(updated.status);
          if (updated.negotiated_price_cents) {
            setNegotiatedPriceCents(updated.negotiated_price_cents);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500">{error || "Deal not found"}</p>
      </div>
    );
  }

  const isSeller = user?.id === deal.seller_id;
  const isBuyer = user?.id === deal.buyer_id;
  // Anonymous users get "buyer" role when deal is OPEN (can ask questions via chat)
  const userRole: "seller" | "buyer" | null = isSeller
    ? "seller"
    : isBuyer
      ? "buyer"
      : (authenticated || deal.status === "OPEN")
        ? "buyer"
        : null;
  const effectivePrice = negotiatedPriceCents ?? deal.price_cents;
  const priceDisplay = `$${(effectivePrice / 100).toFixed(2)}`;
  const isTerminal = ["RELEASED", "REFUNDED", "AUTO_RELEASED", "AUTO_REFUNDED", "EXPIRED", "CANCELED"].includes(deal.status);
  const buyerOfferAccepted = !!(deal.terms as Record<string, unknown> | null)?.buyer_offer_accepted;
  const isConversationClosed = conversationStatus === "closed";
  // Disable chat input when this party's evidence collection is done
  const disputeEvidenceComplete = deal.status === "DISPUTED" && (
    (isBuyer && (deal as Record<string, unknown>).dispute_buyer_done === true) ||
    (isSeller && (deal as Record<string, unknown>).dispute_seller_done === true)
  );

  // --- Server-side deposit flow ---
  async function handleDeposit() {
    if (!authenticated) { login(); return; }
    if (!user) {
      if (privyUser) {
        const token = await getAccessToken();
        if (token) await syncUser(privyUser, token);
      }
      setDepositError("Your account is still loading. Please try again in a moment.");
      return;
    }

    setDepositLoading(true);
    setDepositError(null);

    try {
      const res = await authFetch(`/api/deals/${deal!.id}/deposit`, {
        method: "POST",
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setDepositError(data.error || "Deposit failed");
        return;
      }

      fetchDeal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      setDepositError(message);
    } finally {
      setDepositLoading(false);
    }
  }

  // --- Server-side transfer flow (gas-sponsored) ---
  async function handleTransfer() {
    if (!user) return;
    escrow.setLoading("transferring");
    try {
      const res = await authFetch(`/api/deals/${deal!.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        escrow.setError(data.error || "Transfer failed");
        return;
      }
      escrow.setDone();
      fetchDeal();
    } catch (err) {
      escrow.setError(err instanceof Error ? err.message : "Transfer failed");
    }
  }

  // --- Server-side confirm flow (gas-sponsored) ---
  async function handleConfirm() {
    if (!user) return;
    escrow.setLoading("confirming");
    try {
      const res = await authFetch(`/api/deals/${deal!.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        escrow.setError(data.error || "Confirm failed");
        return;
      }
      escrow.setDone();
      fetchDeal();
    } catch (err) {
      escrow.setError(err instanceof Error ? err.message : "Confirm failed");
    }
  }

  // --- Server-side dispute flow (gas-sponsored) ---
  async function handleDispute() {
    if (!user) return;
    escrow.setLoading("disputing");
    try {
      const res = await authFetch(`/api/deals/${deal!.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        escrow.setError(data.error || "Dispute failed");
        return;
      }
      escrow.setDone();
      fetchDeal();
    } catch (err) {
      escrow.setError(err instanceof Error ? err.message : "Dispute failed");
    }
  }

  // --- Fund wallet flow ---
  async function handleFundWallet() {
    if (!authenticated) { login(); return; }
    if (!walletAddress) return;

    setFundingLoading(true);
    try {
      if (isTestnet) {
        // Testnet: claim USDC from CDP faucet (1 USDC per claim, max 10/day)
        // Calculate how much USDC is still needed
        const requiredUsdc = deal ? deal.price_cents / 100 : 1;
        const currentBalance = usdcBalance !== null ? Number(usdcBalance) / 1e6 : 0;
        const needed = Math.ceil(Math.max(requiredUsdc - currentBalance, 1));

        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: walletAddress, token: "usdc", amount: needed }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Failed to claim test USDC");
          return;
        }
        // Wait for the faucet txs to confirm, then refresh balance
        const { claims } = await res.json();
        await new Promise((r) => setTimeout(r, Math.min(claims * 3000, 15000)));
        refetchBalance();
      } else {
        // Mainnet: open Privy funding modal (Coinbase Onramp / Apple Pay)
        await fundWallet({
          address: walletAddress,
          options: {
            chain: base,
            asset: "USDC",
            amount: deal ? String(effectivePrice / 100) : "10",
          },
        });
        // After modal closes, refresh balance
        refetchBalance();
      }
    } catch (err) {
      console.error("Fund wallet error:", err);
    } finally {
      setFundingLoading(false);
    }
  }

  function copyLink() {
    const link = `${window.location.origin}/deal/${deal!.short_code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function getTimeLeft(deadline: string, timeoutSeconds: number): string {
    const deadlineTime = new Date(deadline).getTime() + timeoutSeconds * 1000;
    const remaining = deadlineTime - Date.now();
    if (remaining <= 0) return "Expired";
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  // --- Render seller's conversation detail view ---
  if (isSeller && deal.status === "OPEN" && selectedConvId) {
    return (
      <div className="flex flex-col h-screen max-w-lg mx-auto pt-14">
        <ConversationReadView
          dealId={deal.id}
          conversationId={selectedConvId}
          buyerName={selectedBuyerName}
          onBack={() => { setSelectedConvId(null); setSelectedBuyerName(""); }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Deal header */}
      <div className="px-4 pt-14 pb-4 border-b border-zinc-200 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold">{deal.event_name}</h1>
          <p className="text-sm text-zinc-500">
            {[
              deal.event_date && new Date(deal.event_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
              deal.venue,
            ].filter(Boolean).join(" · ")}
          </p>
          <p className="text-sm text-zinc-500">
            {deal.num_tickets} ticket{deal.num_tickets !== 1 ? "s" : ""}
            {deal.section ? ` · Section ${deal.section}` : ""}
            {deal.row ? `, Row ${deal.row}` : ""}
            {deal.seats ? `, Seats ${deal.seats}` : ""}
            {deal.transfer_method ? ` · ${deal.transfer_method}` : ""}
          </p>
          </div>
        </div>

        <ProgressTracker status={deal.status as DealStatus} />

        {/* Seller share link */}
        {deal.status === "OPEN" && isSeller && (() => {
          const dealUrl = typeof window !== "undefined"
            ? `${window.location.origin}/deal/${deal.short_code}`
            : `/deal/${deal.short_code}`;
          const shareText = `${deal.event_name} — ${deal.num_tickets} ticket${deal.num_tickets !== 1 ? "s" : ""}${deal.section ? `, Section ${deal.section}` : ""}. Buy here:`;

          return (
            <div className="bg-zinc-50 rounded-xl p-3 space-y-3">
              <p className="text-sm text-zinc-600">Share your deal link:</p>
              <div className="flex gap-2">
                <div className="flex-1 bg-white rounded-lg px-3 py-2 text-xs font-mono text-zinc-500 truncate border border-zinc-200">
                  {dealUrl}
                </div>
                <button onClick={copyLink} className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 hover:text-zinc-700">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              {/* Social share buttons */}
              <div className="flex gap-2">
                {/* Facebook */}
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(dealUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-9 rounded-lg bg-[#1877F2] text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-[#1565C0] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  Facebook
                </a>
                {/* Reddit */}
                <a
                  href={`https://www.reddit.com/submit?url=${encodeURIComponent(dealUrl)}&title=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-9 rounded-lg bg-[#FF4500] text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-[#E03D00] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                  Reddit
                </a>
              </div>
              <div className="flex gap-2">
                {/* X (Twitter) */}
                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(dealUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-9 rounded-lg bg-black text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  X
                </a>
                {/* Instagram */}
                <a
                  href="https://www.instagram.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-9 rounded-lg bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#F77737] text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                  Instagram
                </a>
              </div>
            </div>
          );
        })()}

        {deal.status === "FUNDED" && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium">
            <Lock className="w-4 h-4" />
            {priceDisplay} locked in escrow
            {deal.funded_at && (
              <span className="text-zinc-400 font-normal ml-auto flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getTimeLeft(deal.funded_at, 7200)} left
              </span>
            )}
          </div>
        )}

        {deal.status === "TRANSFERRED" && (
          <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
            <ExternalLink className="w-4 h-4" />
            Seller says transferred
            {deal.transferred_at && (
              <span className="text-zinc-400 font-normal ml-auto flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getTimeLeft(deal.transferred_at, 14400)} auto-release
              </span>
            )}
          </div>
        )}

        {deal.status === "RELEASED" || deal.status === "AUTO_RELEASED" ? (
          <div className="text-sm text-green-600 font-medium">Deal complete!</div>
        ) : null}
      </div>

      {/* Terms (for OPEN deal, buyer view) */}
      {deal.status === "OPEN" && !isSeller && (
        <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50">
          <p className="text-xs font-semibold text-zinc-500 mb-2">TERMS</p>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• Seller transfers within 2 hours of deposit</li>
            <li>• 4 hours to confirm receipt</li>
            <li>• Seller timeout → automatic refund</li>
            <li>• Disputes adjudicated by Dealbay</li>
          </ul>
          <p className="text-xs text-zinc-400 mt-2">Chat with Dealbay to make an offer.</p>
        </div>
      )}

      {/* Conversation closed banner */}
      {isConversationClosed && deal.status !== "OPEN" && (
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
          <p className="text-sm text-zinc-500 text-center">This deal was claimed by another buyer.</p>
        </div>
      )}

      {/* On-chain transaction status banner */}
      {(escrow.isLoading || depositLoading) && (
        <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-200 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          <span className="text-sm text-emerald-800 font-medium">
            {depositLoading ? "Processing deposit..." : STEP_LABELS[escrow.step]}
          </span>
        </div>
      )}

      {escrow.step === "error" && escrow.error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{escrow.error}</p>
          <button onClick={escrow.reset} className="text-xs text-red-500 underline mt-1">
            Dismiss
          </button>
        </div>
      )}

      {depositError && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{depositError}</p>
          <button onClick={() => setDepositError(null)} className="text-xs text-red-500 underline mt-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Chat / Dashboard area */}
      <div className="flex-1 overflow-hidden">
        {/* Seller sees dashboard when deal is OPEN */}
        {isSeller && deal.status === "OPEN" ? (
          <SellerDashboard
            dealId={deal.id}
            sellerId={user!.id}
            onSelectConversation={(convId, name) => {
              setSelectedConvId(convId);
              setSelectedBuyerName(name);
            }}
          />
        ) : (!isSeller && !conversationId) || (isSeller && deal.status !== "OPEN" && deal.buyer_id && !conversationId) ? (
          /* Waiting for conversation to load (both anonymous and authenticated) */
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          /* Both anonymous and authenticated users see Chat */
          <Chat
            dealId={deal.id}
            userId={user?.id || null}
            userRole={userRole}
            chatMode={deal.chat_mode}
            conversationId={conversationId}
            anonymousId={!authenticated ? anonymousId : null}
            disabled={isTerminal || isConversationClosed || disputeEvidenceComplete || (!isSeller && !isBuyer && deal.status !== "OPEN")}
            placeholder={deal.status === "OPEN" && !isSeller ? (buyerOfferAccepted ? "Ask a question..." : "Make an offer...") : "Type a message..."}
            onDepositRequest={(cents) => setNegotiatedPriceCents(cents)}
            onDeposit={handleDeposit}
            onLogin={!authenticated ? login : undefined}
            depositLoading={depositLoading}
            accessToken={chatAccessToken}
            authenticated={authenticated}
            dealStatus={deal.status}
            dealPriceCents={effectivePrice}
            buyerOfferAccepted={buyerOfferAccepted}
            onTransfer={handleTransfer}
            transferLoading={escrow.isLoading && escrow.step === "transferring"}
            onConfirm={handleConfirm}
            onDispute={handleDispute}
            confirmLoading={escrow.isLoading && escrow.step === "confirming"}
            disputeLoading={escrow.isLoading && escrow.step === "disputing"}
            transferMethod={deal.transfer_method || ""}
          />
        )}
      </div>

      {/* Action buttons */}
      {!isTerminal && !isConversationClosed && (
        <div className="border-t border-zinc-200 px-4 py-3 space-y-2">
          {deal.status === "OPEN" && !isSeller && buyerOfferAccepted && (() => {
            // USDC has 6 decimals; price_cents / 100 = dollars, * 1e6 = USDC units
            const requiredAmount = BigInt(effectivePrice) * BigInt(10000);
            const hasEnough = usdcBalance !== null && usdcBalance >= requiredAmount;

            return (
              <>
                {/* Balance indicator */}
                {authenticated && walletAddress && (
                  <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
                    <span className="flex items-center gap-1">
                      <Wallet className="w-3 h-3" />
                      Balance: {usdcFormatted ?? "..."} USDC
                    </span>
                    {!hasEnough && (
                      <span className="text-emerald-600">
                        Need {(effectivePrice / 100).toFixed(2)} USDC
                      </span>
                    )}
                  </div>
                )}

                {/* Get USDC button (shown when balance is insufficient) */}
                {authenticated && !hasEnough && (
                  <button
                    onClick={handleFundWallet}
                    disabled={fundingLoading}
                    className="w-full h-12 rounded-2xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors disabled:opacity-50"
                  >
                    {fundingLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {isTestnet ? "Claiming test USDC..." : "Opening payment..."}
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        {isTestnet
                          ? `Get ${Math.min(Math.ceil(Math.max((deal.price_cents / 100) - (usdcBalance !== null ? Number(usdcBalance) / 1e6 : 0), 1)), 10)} test USDC`
                          : "Get USDC"}
                      </>
                    )}
                  </button>
                )}

                {/* Deposit button removed — now shown inline in chat via requestDeposit tool */}
              </>
            );
          })()}

          {/* Transfer and confirm/dispute buttons moved inline to chat via tools */}
        </div>
      )}
    </div>
  );
}
