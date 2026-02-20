"use client";

import { PrivyProvider, usePrivy, useSigners } from "@privy-io/react-auth";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { base, baseSepolia } from "viem/chains";
import type { User } from "@/lib/types/database";
import { UserMenu } from "./user-menu";

const SERVER_SIGNER_QUORUM_ID = process.env.NEXT_PUBLIC_SERVER_SIGNER_ID || "mtot90ao7hbycjalg7f269it";

const appChain =
  process.env.NEXT_PUBLIC_CHAIN_ID === "84532" ? baseSepolia : base;

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  syncUser: (privyUser: any, accessToken: string) => Promise<void>;
}

const AppContext = createContext<AppContextType>({
  user: null,
  setUser: () => {},
  syncUser: async () => {},
});

export function useAppUser() {
  return useContext(AppContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const syncUser = useCallback(async (privyUser: any, accessToken: string) => {
    if (!privyUser) return;
    const phone = privyUser.phone?.number || null;
    const email = privyUser.email?.address || null;
    const walletAddress = privyUser.wallet?.address;

    // Extract Privy wallet ID from linked accounts (embedded wallet)
    const embeddedWallet = privyUser.linkedAccounts?.find(
      (a: any) => a.type === "wallet" && a.walletClientType === "privy"
    );
    const privyWalletId = embeddedWallet?.id || null;

    if (!phone && !email) return;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          phone,
          email,
          wallet_address: walletAddress || embeddedWallet?.address,
          privy_wallet_id: privyWalletId,
          name: user?.name,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch (e) {
      console.error("Failed to sync user:", e);
    }
  }, [user?.name]);

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ""}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined}
      config={{
        loginMethods: ["sms", "email", "passkey"],
        appearance: {
          theme: "light",
          accentColor: "#f97316",
        },
        defaultChain: appChain,
        supportedChains: [appChain],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <AppContext.Provider value={{ user, setUser, syncUser }}>
        <WalletSignerSetup />
        {children}
        <UserMenu />
      </AppContext.Provider>
    </PrivyProvider>
  );
}

/**
 * Ensures the user's embedded wallet has the server-deposit authorization key
 * as a signer. This enables server-side gas-sponsored transactions (deposits,
 * transfers, confirmations). Runs once after login when we detect the wallet
 * isn't delegated yet.
 */
function WalletSignerSetup() {
  const { authenticated, user: privyUser } = usePrivy();
  const { addSigners } = useSigners();
  const hasAttempted = useRef(false);

  useEffect(() => {
    if (!authenticated || !privyUser || hasAttempted.current) return;

    const embeddedWallet = privyUser.linkedAccounts?.find(
      (a: any) => a.type === "wallet" && a.walletClientType === "privy"
    ) as { address?: string; delegated?: boolean } | undefined;

    // Only add signer if wallet exists and isn't delegated yet
    if (!embeddedWallet?.address || embeddedWallet.delegated) return;

    hasAttempted.current = true;

    addSigners({
      address: embeddedWallet.address,
      signers: [{ signerId: SERVER_SIGNER_QUORUM_ID }],
    })
      .then(() => {
        console.log("[WalletSignerSetup] Server signer added to wallet");
      })
      .catch((err) => {
        console.error("[WalletSignerSetup] Failed to add signer:", err);
        // Reset so it can retry on next render
        hasAttempted.current = false;
      });
  }, [authenticated, privyUser, addSigners]);

  return null;
}
