"use client";

import { useEffect, useState, useCallback, use } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAppUser } from "@/components/providers";
import { ProgressTracker } from "@/components/progress-tracker";
import { Chat } from "@/components/chat";
import { Copy, Share2, Check, ExternalLink, Lock, Clock, AlertTriangle } from "lucide-react";
import type { Deal } from "@/lib/types/database";
import type { DealStatus } from "@/lib/constants";

export default function DealPage({ params }: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = use(params);
  const { ready, authenticated, login } = usePrivy();
  const { user } = useAppUser();
  const [deal, setDeal] = useState<(Deal & { seller: { id: string; name: string | null } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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
    // Poll for updates every 10s
    const interval = setInterval(fetchDeal, 10000);
    return () => clearInterval(interval);
  }, [fetchDeal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
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
  const userRole: "seller" | "buyer" | null = isSeller ? "seller" : isBuyer ? "buyer" : (authenticated ? "buyer" : null);
  const priceDisplay = `$${(deal.price_cents / 100).toFixed(2)}`;
  const isTerminal = ["RELEASED", "REFUNDED", "AUTO_RELEASED", "AUTO_REFUNDED", "EXPIRED", "CANCELED"].includes(deal.status);

  async function handleDeposit() {
    if (!authenticated) { login(); return; }
    if (!user) return;
    setActionLoading(true);
    try {
      // In production, this would trigger Coinbase Onramp → USDC → escrow deposit
      // For now, directly claim the deal
      const res = await fetch(`/api/deals/${deal!.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_id: user.id }),
      });
      if (res.ok) {
        fetchDeal();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to deposit");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTransfer() {
    if (!user) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/deals/${deal!.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller_id: user.id }),
      });
      if (res.ok) fetchDeal();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirm() {
    if (!user) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/deals/${deal!.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_id: user.id }),
      });
      if (res.ok) fetchDeal();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDispute() {
    if (!user) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/deals/${deal!.id}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_id: user.id }),
      });
      if (res.ok) fetchDeal();
    } finally {
      setActionLoading(false);
    }
  }

  function copyLink() {
    const link = `${window.location.origin}/deal/${deal!.short_code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Countdown helper
  function getTimeLeft(deadline: string, timeoutSeconds: number): string {
    const deadlineTime = new Date(deadline).getTime() + timeoutSeconds * 1000;
    const remaining = deadlineTime - Date.now();
    if (remaining <= 0) return "Expired";
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Deal header */}
      <div className="px-4 py-4 border-b border-zinc-200 space-y-4">
        <div>
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

        <ProgressTracker status={deal.status as DealStatus} />

        {/* Status info */}
        {deal.status === "OPEN" && isSeller && (
          <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
            <p className="text-sm text-zinc-600">Share your deal link:</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-white rounded-lg px-3 py-2 text-xs font-mono text-zinc-500 truncate border border-zinc-200">
                {window.location.origin}/deal/{deal.short_code}
              </div>
              <button onClick={copyLink} className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 hover:text-zinc-700">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {deal.status === "FUNDED" && (
          <div className="flex items-center gap-2 text-sm text-orange-600 font-medium">
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
            <li>• Disputes adjudicated by AI</li>
          </ul>
          <p className="text-xs text-zinc-400 mt-2">First to deposit claims tickets.</p>
        </div>
      )}

      {/* Chat */}
      <div className="flex-1 overflow-hidden">
        <Chat
          dealId={deal.id}
          userId={user?.id || null}
          userRole={userRole}
          chatMode={deal.chat_mode}
          disabled={isTerminal || (!isSeller && !isBuyer && deal.status !== "OPEN")}
          placeholder={deal.status === "OPEN" && !isSeller ? "Ask a question..." : "Type a message..."}
        />
      </div>

      {/* Action buttons */}
      {!isTerminal && (
        <div className="border-t border-zinc-200 px-4 py-3 space-y-2">
          {/* OPEN: buyer can deposit */}
          {deal.status === "OPEN" && !isSeller && (
            <button
              onClick={handleDeposit}
              disabled={actionLoading}
              className="w-full h-14 rounded-2xl bg-orange-500 text-white font-semibold text-lg flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              <Lock className="w-5 h-5" />
              Deposit {priceDisplay}
            </button>
          )}

          {/* FUNDED: seller can mark transferred */}
          {deal.status === "FUNDED" && isSeller && (
            <button
              onClick={handleTransfer}
              disabled={actionLoading}
              className="w-full h-14 rounded-2xl bg-blue-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              I've transferred the tickets
            </button>
          )}

          {/* TRANSFERRED: buyer can confirm or dispute */}
          {deal.status === "TRANSFERRED" && isBuyer && (
            <>
              <button
                onClick={handleConfirm}
                disabled={actionLoading}
                className="w-full h-12 rounded-2xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                <Check className="w-5 h-5" />
                Got them — release funds
              </button>
              <button
                onClick={handleDispute}
                disabled={actionLoading}
                className="w-full h-12 rounded-2xl bg-zinc-100 text-zinc-700 font-semibold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                <AlertTriangle className="w-4 h-4" />
                Something's wrong
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
