"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Copy, Check, X } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { NamePrompt } from "@/components/name-prompt";
import { ListingsDropdown } from "@/components/listings-dropdown";
import { useAppUser } from "@/components/providers";

export default function SellPage() {
  return (
    <AuthGate>
      <SellChatGate />
    </AuthGate>
  );
}

/** Wait for user to load before rendering chat (transport needs auth token at construction) */
function SellChatGate() {
  const { user } = useAppUser();
  const { getAccessToken } = usePrivy();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    async function fetchToken() {
      const t = await getAccessToken();
      setToken(t);
    }
    if (user) {
      fetchToken();
    }
  }, [user, getAccessToken]);

  if (!user || !token) {
    return (
      <div className="flex flex-col h-screen max-w-lg mx-auto items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <SellChat accessToken={token} />;
}

/** Extract text content from a UIMessage's parts array */
function getMessageText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/** Strip <deal_data> tags from displayed text */
function cleanContent(text: string): string {
  return text.replace(/<deal_data>[\s\S]*?<\/deal_data>/g, "").trim();
}

function SellChat({ accessToken }: { accessToken: string }) {
  const { user } = useAppUser();
  const { getAccessToken } = usePrivy();
  const [dealLink, setDealLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [toastDismissed, setToastDismissed] = useState(false);

  const greeting = user?.name
    ? `Hey ${user.name}! What are you selling? Just describe it like you would in a Facebook post.`
    : "Hey! What are you selling? Just describe it like you would in a Facebook post.";

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/sell/chat",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    messages: [
      {
        id: "greeting",
        role: "assistant" as "assistant" | "user" | "system",
        parts: [{ type: "text" as const, text: greeting }],
      },
    ],
    onFinish: async ({ message }) => {
      // When the AI response finishes, check if it contains deal data
      const text = getMessageText(message.parts as Array<{ type: string; text?: string }>);
      if (text.includes("<deal_data>") && user?.id) {
        // Give the server a moment to create the deal in its onFinish callback
        await new Promise((r) => setTimeout(r, 1500));

        // Fetch the deal link with auth
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        const res = await fetch("/api/sell/deal-link", { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.deal_link) {
            setDealLink(data.deal_link);
          }
        }
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading || !user) return;
      const text = input.trim();
      setInput("");
      await sendMessage({ text });
    },
    [input, isLoading, user, sendMessage]
  );

  const copyLink = useCallback(async () => {
    if (!dealLink) return;
    await navigator.clipboard.writeText(dealLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [dealLink]);

  const shareText = "Check out this deal!";

  const shareTo = useCallback(
    (platform: "facebook" | "reddit" | "x" | "whatsapp") => {
      if (!dealLink) return;
      const encoded = encodeURIComponent(dealLink);
      const text = encodeURIComponent(shareText);
      const urls: Record<string, string> = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
        reddit: `https://www.reddit.com/submit?url=${encoded}&title=${text}`,
        x: `https://x.com/intent/tweet?url=${encoded}&text=${text}`,
        whatsapp: `https://wa.me/?text=${text}%20${encoded}`,
      };
      window.open(urls[platform], "_blank", "noopener,noreferrer");
    },
    [dealLink]
  );

  // Find the latest user and assistant messages
  const latestUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const latestAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");

  const latestUserContent = latestUserMsg
    ? cleanContent(getMessageText(latestUserMsg.parts as Array<{ type: string; text?: string }>))
    : null;
  const latestAssistantContent = latestAssistantMsg
    ? cleanContent(getMessageText(latestAssistantMsg.parts as Array<{ type: string; text?: string }>))
    : null;

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto px-4">
      {/* Top bar: name prompt + listings dropdown */}
      <div className="pt-3 flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <NamePrompt />
        </div>
        {user && <ListingsDropdown sellerId={user.id} />}
      </div>

      {/* Centered layout: user message / input / agent message */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        {/* Latest user message (above input) */}
        <div className="w-full min-h-[60px] flex items-end justify-end">
          {latestUserContent && (
            <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-orange-500 text-white transition-all duration-300">
              <div className="whitespace-pre-wrap">{latestUserContent}</div>
            </div>
          )}
        </div>

        {/* Input (always visible) */}
        <form
          onSubmit={handleSubmit}
          className="w-full flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={dealLink ? "Ask me anything..." : "Describe your tickets..."}
            className="flex-1 h-12 px-5 rounded-full bg-zinc-100 text-sm outline-none focus:ring-2 focus:ring-orange-500/50 transition-shadow"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="w-12 h-12 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Latest agent message (below input) */}
        <div className="w-full min-h-[60px] flex items-start justify-start">
          {isLoading && (!latestAssistantContent || messages[messages.length - 1]?.role === "user") ? (
            <div className="bg-zinc-100 rounded-2xl px-4 py-2 text-sm text-zinc-400">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          ) : latestAssistantContent ? (
            <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-zinc-100 text-zinc-700 transition-all duration-300">
              <div className="text-xs font-semibold mb-1 text-orange-600">
                AI Agent
              </div>
              <div className="whitespace-pre-wrap">{latestAssistantContent}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Deal link toast (slides up from bottom, dismissible) */}
      {dealLink && !toastDismissed && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border border-zinc-200 rounded-2xl p-4 shadow-xl z-50 animate-[slideInUp_0.3s_ease-out]">
          <div className="flex items-start justify-between mb-2">
            <p className="text-sm font-semibold text-green-700">🎉 Your deal link is ready!</p>
            <button
              onClick={() => setToastDismissed(true)}
              className="text-zinc-400 hover:text-zinc-600 transition-colors ml-2 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="bg-zinc-50 rounded-lg px-3 py-2 text-xs font-mono text-zinc-600 break-all mb-3">
            {dealLink}
          </div>
          <button
            onClick={copyLink}
            className="w-full h-9 rounded-xl bg-green-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors mb-2"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy link"}
          </button>
          <div className="flex gap-2">
            <button onClick={() => shareTo("facebook")} className="flex-1 h-9 rounded-xl bg-[#1877F2] text-white flex items-center justify-center hover:bg-[#1565C0] transition-colors" title="Facebook">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </button>
            <button onClick={() => shareTo("x")} className="flex-1 h-9 rounded-xl bg-black text-white flex items-center justify-center hover:bg-zinc-800 transition-colors" title="X">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </button>
            <button onClick={() => shareTo("reddit")} className="flex-1 h-9 rounded-xl bg-[#FF4500] text-white flex items-center justify-center hover:bg-[#E03D00] transition-colors" title="Reddit">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
            </button>
            <button onClick={() => shareTo("whatsapp")} className="flex-1 h-9 rounded-xl bg-[#25D366] text-white flex items-center justify-center hover:bg-[#1DA851] transition-colors" title="WhatsApp">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
