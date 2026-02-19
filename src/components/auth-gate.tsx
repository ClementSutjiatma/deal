"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { useAppUser } from "./providers";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AuthGate({ children, fallback }: Props) {
  const { ready, authenticated, user: privyUser, login, getAccessToken } = usePrivy();
  const { user, syncUser } = useAppUser();

  useEffect(() => {
    async function doSync() {
      if (authenticated && privyUser && !user) {
        const token = await getAccessToken();
        if (token) {
          syncUser(privyUser, token);
        }
      }
    }
    doSync();
  }, [authenticated, privyUser, user, syncUser, getAccessToken]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      fallback || (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
          <p className="text-zinc-500">Sign in to continue</p>
          <button
            onClick={login}
            className="h-12 px-8 rounded-2xl bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors"
          >
            Sign in
          </button>
        </div>
      )
    );
  }

  return <>{children}</>;
}
