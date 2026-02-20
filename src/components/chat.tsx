"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/client";
import { Send, Paperclip, X } from "lucide-react";
import { DepositPrompt } from "@/components/deposit-prompt";
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
}

/** Convert a Supabase Message to AI SDK UIMessage format */
function dbMessageToUIMessage(msg: Message): UIMessage {
  const meta = msg.metadata as Record<string, unknown> | null;
  const depositCents = meta?.deposit_request_cents as number | undefined;

  // Build parts array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  // Clean deposit tags from content for display
  const cleanContent = msg.content
    .replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "")
    .replace(/<command>.*?<\/command>/g, "")
    .trim();

  if (cleanContent) {
    parts.push({ type: "text", text: cleanContent });
  }

  // If this AI message had a deposit request, add a tool part
  if (msg.role === "ai" && depositCents) {
    parts.push({
      type: "tool-requestDeposit",
      toolCallId: `legacy-${msg.id}`,
      state: "output-available",
      input: { amount_cents: depositCents },
      output: { amount_cents: depositCents },
    });
  }

  return {
    id: msg.id,
    role: msg.role === "ai" ? "assistant" : "user",
    parts: parts.length > 0 ? parts : [{ type: "text", text: "" }],
  } as UIMessage;
}

export function Chat({
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
}: Props) {
  const { getAccessToken } = usePrivy();
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // Track known message IDs to avoid duplicates between useChat and realtime
  const knownMsgIds = useRef(new Set<string>());

  // Build transport only when we have what we need.
  // IMPORTANT: Buyers must have a conversationId before sending messages,
  // otherwise the server creates a new conversation and loses history.
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

  // Fetch initial messages from Supabase
  useEffect(() => {
    async function fetchMessages() {
      if (userRole === "buyer" && !conversationId) return;

      const params = new URLSearchParams();
      if (conversationId) params.set("conversation_id", conversationId);

      const headers: Record<string, string> = {};
      const token = accessToken || await getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/deals/${dealId}/messages?${params.toString()}`, { headers });
      if (res.ok) {
        const data: Message[] = await res.json();

        // Convert to UIMessages
        const uiMsgs = data.map(dbMessageToUIMessage);
        setInitialMessages(uiMsgs);

        // Track IDs
        data.forEach((m) => knownMsgIds.current.add(m.id));

        // Check for deposit requests in existing messages
        if (onDepositRequest) {
          for (const msg of data) {
            const meta = msg.metadata as Record<string, unknown> | null;
            if (meta?.deposit_request_cents) {
              onDepositRequest(meta.deposit_request_cents as number);
            }
          }
        }
      } else {
        setInitialMessages([]);
      }
    }
    fetchMessages();
  }, [dealId, userId, conversationId, accessToken, dealStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // useChat for streaming AI responses
  const chatOptions = useMemo(() => ({
    ...(transport ? { transport } : {}),
    ...(initialMessages ? { messages: initialMessages } : {}),
    onFinish: ({ message }: { message: UIMessage }) => {
      // Check for deposit tool parts in the finished message
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
    },
  }), [transport, initialMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  const { messages: aiMessages, sendMessage, status } = useChat(chatOptions);

  const isStreaming = status === "streaming" || status === "submitted";

  // Subscribe to realtime for messages from OTHER users (seller/buyer messages, system messages)
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

          // Skip messages we already know about
          if (knownMsgIds.current.has(newMsg.id)) return;

          // Skip AI messages that came through useChat streaming (they're already in aiMessages).
          // But ALLOW server-inserted AI messages (e.g. deposit confirmation, system messages)
          // which don't come through the stream. We can tell by checking a short delay —
          // if the message appears while we're NOT streaming, it's server-inserted.
          if (newMsg.role === "ai") {
            // For the current user who triggered the AI response via chat,
            // the streaming response is already in aiMessages. Skip to avoid duplicates.
            // But for the OTHER party (e.g. seller viewing chat after buyer deposits),
            // these server-inserted AI messages need to show up.
            // Simple heuristic: if this user's role matches the current chat stream user,
            // skip (the streaming response handles it). Otherwise, allow it through.
            // Actually, the safest approach: always allow AI messages through realtime
            // and deduplicate in the merge step below.
            knownMsgIds.current.add(newMsg.id);
            setRealtimeMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            // Check for deposit request
            if (onDepositRequest) {
              const meta = newMsg.metadata as Record<string, unknown> | null;
              if (meta?.deposit_request_cents) {
                onDepositRequest(meta.deposit_request_cents as number);
              }
            }
            return;
          }

          // Skip messages sent by current user — useChat handles these optimistically
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

  // Find the last deposit message for isLatest tracking
  const lastDepositMsgId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (msg.role === "assistant") {
        for (const part of msg.parts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((part as any).type === "tool-requestDeposit") {
            return msg.id;
          }
        }
      }
    }
    return null;
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

  // Show loading spinner until initial messages are loaded
  if (initialMessages === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {allMessages.map((msg) => {
          const isOwnMessage = msg.role === "user";
          const isAssistant = msg.role === "assistant";

          return (
            <div
              key={msg.id}
              className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isAssistant
                    ? "bg-zinc-100 text-zinc-700"
                    : isOwnMessage
                      ? "bg-orange-500 text-white"
                      : "bg-zinc-200 text-zinc-900"
                }`}
              >
                {isAssistant && (
                  <div className="text-xs font-semibold mb-1 text-orange-600">Dealbay</div>
                )}
                {/* Render parts */}
                {msg.parts.map((part, i) => {
                  if (part.type === "text" && part.text) {
                    // Strip any <command> or <deposit_request> tags from rendered text
                    const cleanText = part.text
                      .replace(/<command>.*?<\/command>/g, "")
                      .replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "")
                      .trim();
                    if (!cleanText) return null;
                    return <MarkdownText key={i}>{cleanText}</MarkdownText>;
                  }

                  // Tool part: requestDeposit
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const p = part as any;
                  if (
                    p.type === "tool-requestDeposit" &&
                    (p.state === "output-available" || p.state === "input-available") &&
                    userRole === "buyer" &&
                    (onDeposit || onLogin)
                  ) {
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

                  return null;
                })}
              </div>
            </div>
          );
        })}

        {/* Fallback deposit prompt: show when offer is accepted but no tool call in messages */}
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
