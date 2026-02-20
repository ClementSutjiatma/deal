"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/client";
import { Send, Paperclip, X } from "lucide-react";
import { DepositPrompt } from "@/components/deposit-prompt";
import { TransferPrompt } from "@/components/transfer-prompt";
import { ReceiptPrompt } from "@/components/receipt-prompt";
import { MarkdownText } from "@/components/markdown-text";
import type { Message } from "@/lib/types/database";

interface Props {
  dealId: string;
  userId: string | null;
  userRole: "seller" | "buyer" | null;
  chatMode: string;
  conversationId?: string | null;
  anonymousId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  onDepositRequest?: (amountCents: number) => void;
  depositLoading?: boolean;
  onDeposit?: () => void;
  onLogin?: () => void;
  accessToken?: string | null;
  authenticated?: boolean;
  dealStatus?: string;
  dealPriceCents?: number;
  buyerOfferAccepted?: boolean;
  // Transfer flow (seller)
  onTransfer?: () => void;
  transferLoading?: boolean;
  // Confirm/dispute flow (buyer)
  onConfirm?: () => void;
  onDispute?: () => void;
  confirmLoading?: boolean;
  disputeLoading?: boolean;
  transferMethod?: string;
}

/** Convert a Supabase Message to AI SDK UIMessage format */
function dbMessageToUIMessage(msg: Message): UIMessage {
  const meta = msg.metadata as Record<string, unknown> | null;
  const depositCents = meta?.deposit_request_cents as number | undefined;
  const transferMethod = meta?.transfer_method as string | undefined;
  const receiptMethod = meta?.receipt_method as string | undefined;

  // Build parts array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  // Clean tags from content for display
  const cleanContent = msg.content
    .replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "")
    .replace(/<command>.*?<\/command>/g, "")
    .trim();

  if (cleanContent) {
    parts.push({ type: "text", text: cleanContent });
  }

  // AI message tool parts: reconstruct from metadata
  if (msg.role === "ai") {
    if (depositCents) {
      parts.push({
        type: "tool-requestDeposit",
        toolCallId: `db-deposit-${msg.id}`,
        state: "output-available",
        input: { amount_cents: depositCents },
        output: { amount_cents: depositCents },
      });
    }
    if (transferMethod) {
      parts.push({
        type: "tool-confirmTransfer",
        toolCallId: `db-transfer-${msg.id}`,
        state: "output-available",
        input: { transfer_method: transferMethod },
        output: { transfer_method: transferMethod },
      });
    }
    if (receiptMethod) {
      parts.push({
        type: "tool-confirmReceipt",
        toolCallId: `db-receipt-${msg.id}`,
        state: "output-available",
        input: { transfer_method: receiptMethod },
        output: { transfer_method: receiptMethod },
      });
    }
  }

  return {
    id: msg.id,
    role: msg.role === "ai" ? "assistant" : "user",
    parts: parts.length > 0 ? parts : [{ type: "text", text: "" }],
  } as UIMessage;
}

/**
 * Chat wrapper — fetches initial messages from the DB, then mounts the
 * inner ChatInner component which calls useChat.
 *
 * This two-component pattern is required because useChat's `messages`
 * parameter is only read on mount (initial state). If we fetch messages
 * asynchronously and pass them later, useChat ignores them.
 */
export function Chat(props: Props) {
  const { getAccessToken } = usePrivy();
  const {
    dealId,
    userId,
    userRole,
    conversationId,
    accessToken,
    dealStatus,
    onDepositRequest,
  } = props;

  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const knownMsgIdsRef = useRef(new Set<string>());
  // Track original DB role (buyer/seller/ai) for each message ID
  const msgRolesRef = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;

    async function fetchMessages() {
      if (userRole === "buyer" && !conversationId) {
        if (!cancelled) {
          setInitialMessages(null);
          setIsLoading(false);
        }
        return;
      }

      const params = new URLSearchParams();
      if (conversationId) params.set("conversation_id", conversationId);

      const headers: Record<string, string> = {};
      const token = accessToken || await getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      try {
        const res = await fetch(`/api/deals/${dealId}/messages?${params.toString()}`, { headers });
        if (cancelled) return;

        if (res.ok) {
          const data: Message[] = await res.json();
          const uiMsgs = data.map(dbMessageToUIMessage);

          // Track known IDs for deduplication and original roles
          data.forEach((m) => {
            knownMsgIdsRef.current.add(m.id);
            msgRolesRef.current.set(m.id, m.role);
          });

          // Extract deposit requests from messages
          if (onDepositRequest) {
            for (const msg of data) {
              const meta = msg.metadata as Record<string, unknown> | null;
              if (meta?.deposit_request_cents) {
                onDepositRequest(meta.deposit_request_cents as number);
              }
            }
          }

          setInitialMessages(uiMsgs);
        } else {
          setInitialMessages(null);
        }
      } catch {
        if (!cancelled) setInitialMessages(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    // Reset loading when key deps change (e.g. deal transitions)
    setIsLoading(true);
    fetchMessages();

    return () => { cancelled = true; };
  }, [dealId, userId, conversationId, accessToken, dealStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Key ensures ChatInner unmounts/remounts when initialMessages or conversationId changes,
  // so useChat re-initializes with fresh state.
  const chatKey = `${conversationId || "no-conv"}-${initialMessages?.length ?? 0}-${dealStatus}`;

  return (
    <ChatInner
      key={chatKey}
      {...props}
      initialMessages={initialMessages || undefined}
      knownMsgIds={knownMsgIdsRef}
      msgRoles={msgRolesRef}
    />
  );
}

// ─── Inner chat component (calls useChat) ────────────────────────────

interface InnerProps extends Props {
  initialMessages?: UIMessage[];
  knownMsgIds: React.RefObject<Set<string>>;
  msgRoles: React.RefObject<Map<string, string>>;
}

function ChatInner({
  dealId,
  userId,
  userRole,
  chatMode,
  conversationId,
  anonymousId,
  disabled,
  placeholder,
  onDepositRequest,
  depositLoading,
  onDeposit,
  onLogin,
  accessToken,
  authenticated,
  dealStatus,
  dealPriceCents,
  buyerOfferAccepted,
  onTransfer,
  transferLoading,
  onConfirm,
  onDispute,
  confirmLoading,
  disputeLoading,
  transferMethod,
  initialMessages,
  knownMsgIds,
  msgRoles,
}: InnerProps) {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // Build transport only when we have what we need.
  const transport = useMemo(() => {
    if (!accessToken && !anonymousId) return null;
    // Buyers need a conversationId to avoid creating duplicate conversations
    if (userRole === "buyer" && !conversationId) return null;

    return new DefaultChatTransport({
      api: `/api/deals/${dealId}/chat`,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "x-conversation-id": conversationId || "",
        "x-anonymous-id": anonymousId || "",
      },
    });
  }, [dealId, accessToken, conversationId, anonymousId, userRole]);

  // onFinish handler for useChat — check for tool parts
  const handleFinish = useCallback(({ message }: { message: UIMessage }) => {
    if (onDepositRequest) {
      for (const part of message.parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = part as any;
        if (
          p.type === "tool-requestDeposit" &&
          p.state === "output-available"
        ) {
          onDepositRequest(p.output.amount_cents);
        }
      }
    }
  }, [onDepositRequest]);

  // useChat — initialized with messages from the DB.
  // This hook is called exactly once per ChatInner mount (parent keys on chatKey).
  const { messages: aiMessages, sendMessage, status } = useChat({
    ...(transport ? { transport } : {}),
    ...(initialMessages && initialMessages.length > 0 ? { messages: initialMessages } : {}),
    onFinish: handleFinish,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Subscribe to realtime for messages from OTHER users
  useEffect(() => {
    if (userRole === "buyer" && !conversationId) return;

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

          // Track original DB role for rendering
          msgRoles.current.set(newMsg.id, newMsg.role);

          // Skip messages we already know about
          if (knownMsgIds.current.has(newMsg.id)) return;

          // AI messages: only pass through for roles that DON'T receive
          // the AI response via useChat streaming (e.g. seller viewing
          // a buyer conversation in post-OPEN states). When the current
          // user triggered the AI response, useChat already has it —
          // adding it again via realtime causes duplicates because the
          // server-generated DB ID differs from the client-side ID.
          if (newMsg.role === "ai") {
            // Seller in post-OPEN sees AI messages via realtime (not streaming)
            const sellerObserving = userRole === "seller";
            if (!sellerObserving) {
              knownMsgIds.current.add(newMsg.id);
              // Still extract deposit metadata even though we skip display
              if (onDepositRequest) {
                const meta = newMsg.metadata as Record<string, unknown> | null;
                if (meta?.deposit_request_cents) {
                  onDepositRequest(meta.deposit_request_cents as number);
                }
              }
              return; // useChat already has this message from streaming
            }

            knownMsgIds.current.add(newMsg.id);
            setRealtimeMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            if (onDepositRequest) {
              const meta = newMsg.metadata as Record<string, unknown> | null;
              if (meta?.deposit_request_cents) {
                onDepositRequest(meta.deposit_request_cents as number);
              }
            }
            return;
          }

          // Skip own messages — useChat handles them optimistically
          if (newMsg.role === "buyer" && userRole === "buyer") {
            knownMsgIds.current.add(newMsg.id);
            return;
          }
          if (newMsg.role === "seller" && userRole === "seller") {
            knownMsgIds.current.add(newMsg.id);
            return;
          }

          // Check visibility in dispute mode
          if (chatMode === "dispute" && userId) {
            if (newMsg.visibility === "seller_only" && userRole !== "seller") return;
            if (newMsg.visibility === "buyer_only" && userRole !== "buyer") return;
          }

          knownMsgIds.current.add(newMsg.id);
          setRealtimeMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId, conversationId, userId, userRole, chatMode, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge useChat messages with realtime messages from other users
  const allMessages = useMemo(() => {
    const realtimeUIMsgs: UIMessage[] = realtimeMessages
      .filter((m) => !aiMessages.some((ai) => ai.id === m.id))
      .map(dbMessageToUIMessage);

    const combined = [...aiMessages];
    for (const rtMsg of realtimeUIMsgs) {
      if (!combined.some((m) => m.id === rtMsg.id)) {
        combined.push(rtMsg);
      }
    }

    return combined;
  }, [aiMessages, realtimeMessages]);

  // Find the last tool message IDs for isLatest tracking
  const { lastDepositMsgId, lastTransferMsgId, lastReceiptMsgId } = useMemo(() => {
    let deposit: string | null = null;
    let transfer: string | null = null;
    let receipt: string | null = null;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (msg.role === "assistant") {
        for (const part of msg.parts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = part as any;
          if (!deposit && p.type === "tool-requestDeposit") deposit = msg.id;
          if (!transfer && p.type === "tool-confirmTransfer") transfer = msg.id;
          if (!receipt && p.type === "tool-confirmReceipt") receipt = msg.id;
        }
      }
      if (deposit && transfer && receipt) break;
    }
    return { lastDepositMsgId: deposit, lastTransferMsgId: transfer, lastReceiptMsgId: receipt };
  }, [allMessages]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages]);

  // Clean up previews on unmount
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const maxNew = Math.max(0, 4 - pendingFiles.length);
    const newFiles = files.slice(0, maxNew);

    setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 4));
    setPreviews((prev) => [
      ...prev,
      ...newFiles.map((f) => URL.createObjectURL(f)),
    ].slice(0, 4));

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

  // Can send if: has a role AND (seller OR has conversationId for buyers)
  const canSend = !!userRole && (userRole === "seller" || !!conversationId) && !!transport;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && pendingFiles.length === 0) || !canSend || isStreaming) return;

    // Upload images first (only for authenticated users)
    const mediaUrls = userId ? await uploadFiles() : [];

    const text = input.trim() || (mediaUrls.length > 0 ? "[image]" : "");
    setInput("");
    setPendingFiles([]);
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPreviews([]);

    if (text) {
      await sendMessage({ text });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {allMessages.map((msg) => {
          const isAssistant = msg.role === "assistant";
          // Determine the original DB role for this message
          const dbRole = msgRoles.current.get(msg.id);
          // "Own" = sent by the current user's role. Messages from useChat
          // (not in msgRoles) with role "user" are always own messages.
          // DB messages: own if dbRole matches userRole.
          const isOwnMessage = msg.role === "user" && (!dbRole || dbRole === userRole);
          // "Other party" = the other human in the deal (not AI)
          const isOtherParty = msg.role === "user" && dbRole && dbRole !== userRole;
          const otherPartyLabel = dbRole === "buyer" ? "Buyer" : dbRole === "seller" ? "Seller" : null;

          return (
            <div
              key={msg.id}
              className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isAssistant
                    ? "bg-zinc-100 text-zinc-700"
                    : isOtherParty
                      ? "bg-zinc-200 text-zinc-900"
                      : isOwnMessage
                        ? "bg-orange-500 text-white"
                        : "bg-zinc-200 text-zinc-900"
                }`}
              >
                {isAssistant && (
                  <div className="text-xs font-semibold mb-1 text-orange-600">Dealbay</div>
                )}
                {isOtherParty && otherPartyLabel && (
                  <div className="text-xs font-semibold mb-1 text-zinc-500">{otherPartyLabel}</div>
                )}
                {/* Render parts */}
                {msg.parts.map((part, i) => {
                  if (part.type === "text" && part.text) {
                    const cleanText = part.text
                      .replace(/<command>.*?<\/command>/g, "")
                      .replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "")
                      .trim();
                    if (!cleanText) return null;
                    return <MarkdownText key={i}>{cleanText}</MarkdownText>;
                  }

                  // Tool parts
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const p = part as any;
                  const isToolReady = p.state === "output-available" || p.state === "input-available";

                  // Deposit tool (buyer only)
                  if (p.type === "tool-requestDeposit" && isToolReady && userRole === "buyer" && (onDeposit || onLogin)) {
                    const amountCents = p.output?.amount_cents ?? p.input?.amount_cents;
                    if (!amountCents) return null;
                    return (
                      <DepositPrompt
                        key={i}
                        amountCents={amountCents}
                        onDeposit={onDeposit || (() => {})}
                        disabled={disabled}
                        loading={depositLoading}
                        authenticated={authenticated}
                        onLogin={onLogin}
                        dealStatus={dealStatus}
                        isLatest={msg.id === lastDepositMsgId}
                      />
                    );
                  }

                  // Transfer tool (seller only)
                  if (p.type === "tool-confirmTransfer" && isToolReady && userRole === "seller" && onTransfer) {
                    const method = p.output?.transfer_method ?? p.input?.transfer_method ?? transferMethod;
                    return (
                      <TransferPrompt
                        key={i}
                        transferMethod={method || ""}
                        onTransfer={onTransfer}
                        disabled={disabled}
                        loading={transferLoading}
                        dealStatus={dealStatus}
                        isLatest={msg.id === lastTransferMsgId}
                      />
                    );
                  }

                  // Receipt tool (buyer only)
                  if (p.type === "tool-confirmReceipt" && isToolReady && userRole === "buyer" && onConfirm && onDispute) {
                    const method = p.output?.transfer_method ?? p.input?.transfer_method ?? transferMethod;
                    return (
                      <ReceiptPrompt
                        key={i}
                        transferMethod={method || ""}
                        onConfirm={onConfirm}
                        onDispute={onDispute}
                        disabled={disabled}
                        confirmLoading={confirmLoading}
                        disputeLoading={disputeLoading}
                        dealStatus={dealStatus}
                        isLatest={msg.id === lastReceiptMsgId}
                      />
                    );
                  }

                  return null;
                })}
              </div>
            </div>
          );
        })}

        {/* Fallback deposit prompt */}
        {buyerOfferAccepted && dealStatus === "OPEN" && userRole === "buyer" && !lastDepositMsgId && dealPriceCents && (onDeposit || onLogin) && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-zinc-100 text-zinc-700">
              <div className="text-xs font-semibold mb-1 text-orange-600">Dealbay</div>
              <DepositPrompt
                amountCents={dealPriceCents}
                onDeposit={onDeposit || (() => {})}
                disabled={disabled}
                loading={depositLoading}
                authenticated={authenticated}
                onLogin={onLogin}
                dealStatus={dealStatus}
                isLatest={true}
              />
            </div>
          </div>
        )}

        {/* Fallback transfer prompt */}
        {dealStatus === "FUNDED" && userRole === "seller" && !lastTransferMsgId && onTransfer && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-zinc-100 text-zinc-700">
              <div className="text-xs font-semibold mb-1 text-orange-600">Dealbay</div>
              <TransferPrompt
                transferMethod={transferMethod || ""}
                onTransfer={onTransfer}
                disabled={disabled}
                loading={transferLoading}
                dealStatus={dealStatus}
                isLatest={true}
              />
            </div>
          </div>
        )}

        {/* Fallback receipt prompt */}
        {dealStatus === "TRANSFERRED" && userRole === "buyer" && !lastReceiptMsgId && onConfirm && onDispute && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-zinc-100 text-zinc-700">
              <div className="text-xs font-semibold mb-1 text-orange-600">Dealbay</div>
              <ReceiptPrompt
                transferMethod={transferMethod || ""}
                onConfirm={onConfirm}
                onDispute={onDispute}
                disabled={disabled}
                confirmLoading={confirmLoading}
                disputeLoading={disputeLoading}
                dealStatus={dealStatus}
                isLatest={true}
              />
            </div>
          </div>
        )}

        {/* Streaming indicator */}
        {isStreaming && allMessages[allMessages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-zinc-100 rounded-2xl px-4 py-2 text-sm text-zinc-400">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

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

      {/* Input */}
      {!disabled && canSend && (
        <form onSubmit={handleSubmit} className="border-t border-zinc-200 px-4 py-3 flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          {userId && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                pendingFiles.length > 0
                  ? "bg-orange-100 text-orange-600"
                  : "bg-zinc-100 text-zinc-400 hover:text-zinc-600"
              }`}
              disabled={isStreaming}
            >
              <Paperclip className="w-4 h-4" />
            </button>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder || "Type a message..."}
            className="flex-1 h-10 px-4 rounded-full bg-zinc-100 text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={(!input.trim() && pendingFiles.length === 0) || isStreaming}
            className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
}
