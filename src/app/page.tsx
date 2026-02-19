import Link from "next/link";
import { Shield, Zap, MessageSquare } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-md w-full text-center space-y-6">
          <h1 className="text-4xl font-bold tracking-tight">
            Sell your tickets safely.
          </h1>
          <p className="text-lg text-zinc-500">
            AI-powered escrow for peer-to-peer ticket sales. Zero fees. No scams.
          </p>

          <Link
            href="/sell"
            className="inline-flex items-center justify-center w-full h-14 rounded-2xl bg-orange-500 text-white font-semibold text-lg hover:bg-orange-600 transition-colors"
          >
            Start selling
          </Link>

          <p className="text-sm text-zinc-400">
            Already have a deal?{" "}
            <Link href="/sell" className="text-orange-500 font-medium hover:underline">
              Check your deal status
            </Link>
          </p>
        </div>

        {/* Features */}
        <div className="max-w-md w-full mt-16 space-y-6">
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold">Escrow protection</h3>
              <p className="text-sm text-zinc-500">
                Funds locked on-chain until tickets are confirmed received. No trust required.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold">First to deposit wins</h3>
              <p className="text-sm text-zinc-500">
                Share one link. Multiple buyers can view. First deposit claims the tickets.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold">AI-managed disputes</h3>
              <p className="text-sm text-zinc-500">
                If something goes wrong, AI collects evidence and makes a fair ruling. No middleman.
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
