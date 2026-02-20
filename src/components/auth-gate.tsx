"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";
import { useAppUser } from "./providers";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Auto-open the Privy login modal instead of showing "Sign in to continue" */
  autoLogin?: boolean;
}

export function AuthGate({ children, fallback, autoLogin }: Props) {
  const { ready, authenticated, user: privyUser, login, getAccessToken } = usePrivy();
  const { user, syncUser } = useAppUser();
  const loginTriggered = useRef(false);

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

  // Auto-trigger Privy login modal when autoLogin is enabled
  useEffect(() => {
    if (autoLogin && ready && !authenticated && !loginTriggered.current) {
      loginTriggered.current = true;
      login();
    }
  }, [autoLogin, ready, authenticated, login]);

  // Reset trigger flag if user becomes authenticated (so re-logout works)
  useEffect(() => {
    if (authenticated) {
      loginTriggered.current = false;
    }
  }, [authenticated]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    if (autoLogin) {
      // Show a spinner while the Privy modal is opening
      return (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    return (
      fallback || (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
          <p className="text-zinc-500">Sign in to continue</p>
          <button
            onClick={login}
            className="h-12 px-8 rounded-2xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
          >
            Sign in
          </button>
        </div>
      )
    );
  }

  return <>{children}</>;
}
