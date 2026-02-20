"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Copy, Check, X } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { MarkdownText } from "@/components/markdown-text";
import { AuthGate } from "@/components/auth-gate";
import { NamePrompt } from "@/components/name-prompt";
import { useAppUser } from "@/components/providers";

export default function SellPage() {
  return (
    <AuthGate autoLogin>
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
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
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
  const router = useRouter();
  const [dealLink, setDealLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [toastDismissed, setToastDismissed] = useState(false);
  const searchParams = useSearchParams();
  const prefillSent = useRef(false);

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
      // Check if the AI response contains a createDeal tool call or legacy <deal_data>
      const text = getMessageText(message.parts as Array<{ type: string; text?: string }>);
      const hasCreateDealTool = message.parts.some(
        (p: { type: string }) => p.type === "tool-createDeal"
      );
      const hasDealData = text.includes("<deal_data>");

      if ((hasCreateDealTool || hasDealData) && user?.id) {
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
            // Auto-navigate to the deal page so the seller can see their listing
            const url = new URL(data.deal_link);
            router.push(url.pathname);
          }
        }
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-send prefilled description from landing page ?q= param
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !prefillSent.current && user) {
      prefillSent.current = true;
      sendMessage({ text: q });
    }
  }, [searchParams, user, sendMessage]);

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
    (platform: "facebook" | "reddit" | "x" | "instagram") => {
      if (!dealLink) return;
      const encoded = encodeURIComponent(dealLink);
      const text = encodeURIComponent(shareText);
      const urls: Record<string, string> = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
        reddit: `https://www.reddit.com/submit?url=${encoded}&title=${text}`,
        x: `https://x.com/intent/tweet?url=${encoded}&text=${text}`,
        instagram: `https://www.instagram.com/`,
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
      <div className="pt-3">
        <NamePrompt />
      </div>

      {/* Centered layout: user message / input / agent message */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        {/* Latest user message (above input) */}
        <div className="w-full min-h-[60px] flex items-end justify-end">
          {latestUserContent && (
            <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-emerald-600 text-white transition-all duration-300">
              <MarkdownText>{latestUserContent}</MarkdownText>
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
            className="flex-1 h-12 px-5 rounded-full bg-zinc-100 text-sm outline-none focus:ring-2 focus:ring-emerald-600/50 transition-shadow"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition-colors disabled:opacity-50"
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
              <div className="text-xs font-semibold mb-1 text-emerald-700">
                Dealbay
              </div>
              <MarkdownText>{latestAssistantContent}</MarkdownText>
            </div>
          ) : null}
        </div>
      </div>

      {/* Deal link toast (slides up from bottom, dismissible) */}
      {dealLink && !toastDismissed && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border border-zinc-200 rounded-2xl p-4 shadow-xl z-50 animate-[slideInUp_0.3s_ease-out]">
          <div className="flex items-start justify-between mb-2">
            <p className="text-sm font-semibold text-green-700">Your deal link is ready!</p>
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
            <button onClick={() => shareTo("reddit")} className="flex-1 h-9 rounded-xl bg-[#FF4500] text-white flex items-center justify-center hover:bg-[#E03D00] transition-colors" title="Reddit">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
            </button>
            <button onClick={() => shareTo("x")} className="flex-1 h-9 rounded-xl bg-black text-white flex items-center justify-center hover:bg-zinc-800 transition-colors" title="X">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </button>
            <button onClick={() => shareTo("instagram")} className="flex-1 h-9 rounded-xl bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#F77737] text-white flex items-center justify-center hover:opacity-90 transition-opacity" title="Instagram">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
