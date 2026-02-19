"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send, Paperclip, X } from "lucide-react";
import { DepositPrompt } from "@/components/deposit-prompt";
import type { Message } from "@/lib/types/database";

interface Props {
  dealId: string;
  userId: string | null;
  userRole: "seller" | "buyer" | null;
  chatMode: string;
  conversationId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  onDepositRequest?: (amountCents: number) => void;
  depositLoading?: boolean;
  onDeposit?: () => void;
  onLogin?: () => void;
}

/** Strip deposit_request tags from displayed message content */
function cleanDepositTag(text: string): string {
  return text.replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "").trim();
}

/** Extract deposit_request amount from message content */
function extractDepositRequest(text: string): number | null {
  const match = text.match(/<deposit_request\s+amount_cents="(\d+)"\s*\/>/);
  return match ? parseInt(match[1], 10) : null;
}

export function Chat({
  dealId,
  userId,
  userRole,
  chatMode,
  conversationId,
  disabled,
  placeholder,
  onDepositRequest,
  depositLoading,
  onDeposit,
  onLogin,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // Fetch initial messages
  useEffect(() => {
    async function fetchMessages() {
      // Buyers must have a conversationId before fetching
      if (userRole === "buyer" && !conversationId) return;

      const params = new URLSearchParams();
      if (userId) params.set("user_id", userId);
      if (conversationId) params.set("conversation_id", conversationId);

      const res = await fetch(`/api/deals/${dealId}/messages?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);

        // Check for deposit requests in existing messages
        if (onDepositRequest) {
          for (const msg of data) {
            if (msg.metadata?.deposit_request_cents) {
              onDepositRequest(msg.metadata.deposit_request_cents);
            }
          }
        }
      }
    }
    fetchMessages();
  }, [dealId, userId, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to realtime
  useEffect(() => {
    // Buyers must have a conversationId before subscribing
    if (userRole === "buyer" && !conversationId) return;

    // Use conversation_id filter when available, otherwise fall back to deal_id
    const filterColumn = conversationId ? "conversation_id" : "deal_id";
    const filterValue = conversationId || dealId;

    const channel = supabase
      .channel(`messages:${filterValue}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `${filterColumn}=eq.${filterValue}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          // Check visibility
          if (chatMode === "dispute" && userId) {
            if (newMsg.visibility === "seller_only" && userRole !== "seller") return;
            if (newMsg.visibility === "buyer_only" && userRole !== "buyer") return;
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          // Check for deposit request in new AI messages
          if (newMsg.role === "ai" && onDepositRequest) {
            const meta = newMsg.metadata as Record<string, unknown> | null;
            if (meta?.deposit_request_cents) {
              onDepositRequest(meta.deposit_request_cents as number);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId, conversationId, userId, userRole, chatMode, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clean up previews on unmount
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 4 images at a time
    const maxNew = Math.max(0, 4 - pendingFiles.length);
    const newFiles = files.slice(0, maxNew);

    setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 4));
    setPreviews((prev) => [
      ...prev,
      ...newFiles.map((f) => URL.createObjectURL(f)),
    ].slice(0, 4));

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removePendingFile(index: number) {
    URL.revokeObjectURL(previews[index]);
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadFiles(): Promise<string[]> {
    if (pendingFiles.length === 0) return [];

    const urls: string[] = [];
    for (const file of pendingFiles) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${dealId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await supabase.storage
        .from("deal-evidence")
        .upload(path, file, { contentType: file.type });

      if (!error) {
        const { data: urlData } = supabase.storage
          .from("deal-evidence")
          .getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
    }
    return urls;
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && pendingFiles.length === 0) || !userRole || sending) return;
    if (userRole === "buyer" && !conversationId) return;

    setSending(true);
    try {
      // Upload images first
      const mediaUrls = await uploadFiles();

      const res = await fetch(`/api/deals/${dealId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_id: userId,
          content: input.trim() || (mediaUrls.length > 0 ? "[image]" : ""),
          role: userRole,
          conversation_id: conversationId || undefined,
          media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
        }),
      });

      if (res.ok) {
        setInput("");
        setPendingFiles([]);
        previews.forEach((url) => URL.revokeObjectURL(url));
        setPreviews([]);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => {
          const meta = msg.metadata as Record<string, unknown> | null;
          const depositCents = meta?.deposit_request_cents as number | undefined;
          const displayContent = cleanDepositTag(msg.content);

          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === userRole ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  msg.role === "ai" || msg.role === "system"
                    ? "bg-zinc-100 text-zinc-700"
                    : msg.role === userRole
                      ? "bg-orange-500 text-white"
                      : "bg-zinc-200 text-zinc-900"
                }`}
              >
                {msg.role !== userRole && msg.role !== "ai" && msg.role !== "system" && (
                  <div className="text-xs font-semibold mb-1 opacity-70">
                    {msg.role === "seller" ? "Seller" : "Buyer"}
                  </div>
                )}
                {msg.role === "ai" && (
                  <div className="text-xs font-semibold mb-1 text-orange-600">AI Agent</div>
                )}
                <div className="whitespace-pre-wrap">{displayContent}</div>
                {msg.media_urls && msg.media_urls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.media_urls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt="attachment"
                        className="rounded-lg max-w-full max-h-48 object-cover"
                      />
                    ))}
                  </div>
                )}
                {/* Inline deposit prompt for AI messages with deposit request */}
                {msg.role === "ai" && depositCents && userRole === "buyer" && onDeposit && (
                  <DepositPrompt
                    amountCents={depositCents}
                    onDeposit={onDeposit}
                    disabled={disabled}
                    loading={depositLoading}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Pending image previews */}
      {previews.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-100 flex gap-2 overflow-x-auto">
          {previews.map((url, i) => (
            <div key={i} className="relative flex-shrink-0">
              <img
                src={url}
                alt="pending upload"
                className="w-16 h-16 rounded-lg object-cover border border-zinc-200"
              />
              <button
                onClick={() => removePendingFile(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-800 text-white flex items-center justify-center"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Login CTA for unauthenticated visitors */}
      {!userRole && onLogin && (
        <div className="border-t border-zinc-200 px-4 py-3">
          <button
            onClick={onLogin}
            className="w-full h-10 rounded-2xl bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-700 transition-colors"
          >
            Log in to chat
          </button>
        </div>
      )}

      {/* Input */}
      {!disabled && userRole && (
        <form onSubmit={sendMessage} className="border-t border-zinc-200 px-4 py-3 flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              pendingFiles.length > 0
                ? "bg-orange-100 text-orange-600"
                : "bg-zinc-100 text-zinc-400 hover:text-zinc-600"
            }`}
            disabled={sending}
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder || "Type a message..."}
            className="flex-1 h-10 px-4 rounded-full bg-zinc-100 text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={(!input.trim() && pendingFiles.length === 0) || sending}
            className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
}
