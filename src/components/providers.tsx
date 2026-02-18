"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User } from "@/lib/types/database";

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  syncUser: (privyUser: any) => Promise<void>;
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

  const syncUser = useCallback(async (privyUser: any) => {
    if (!privyUser) return;
    const phone = privyUser.phone?.number;
    const walletAddress = privyUser.wallet?.address;
    if (!phone) return;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privy_user_id: privyUser.id,
          phone,
          wallet_address: walletAddress,
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
      config={{
        loginMethods: ["sms"],
        appearance: {
          theme: "light",
          accentColor: "#f97316",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <AppContext.Provider value={{ user, setUser, syncUser }}>
        {children}
      </AppContext.Provider>
    </PrivyProvider>
  );
}
