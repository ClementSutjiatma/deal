import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

const COINBASE_TOKEN_URL =
  "https://api.developer.coinbase.com/onramp/v1/token";

/**
 * POST /api/offramp
 * Generates a Coinbase offramp URL so users can sell USDC for fiat.
 *
 * Body: { address: string, amount: string, userId: string }
 * Returns: { url: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { address, amount, userId } = body as {
    address?: string;
    amount?: string;
    userId?: string;
  };

  if (!address || !amount) {
    return NextResponse.json(
      { error: "Missing address or amount" },
      { status: 400 }
    );
  }

  // Map env vars (same pattern as faucet)
  if (!process.env.CDP_API_KEY_ID && process.env.COINBASE_API_KEY_ID) {
    process.env.CDP_API_KEY_ID = process.env.COINBASE_API_KEY_ID;
  }
  if (!process.env.CDP_API_KEY_SECRET && process.env.COINBASE_API_KEY_SECRET) {
    process.env.CDP_API_KEY_SECRET = process.env.COINBASE_API_KEY_SECRET;
  }

  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;

  if (!apiKeyId || !apiKeySecret) {
    return NextResponse.json(
      { error: "CDP API keys not configured" },
      { status: 500 }
    );
  }

  try {
    // 1. Generate JWT for Coinbase API authentication
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: "POST",
      requestHost: "api.developer.coinbase.com",
      requestPath: "/onramp/v1/token",
    });

    // 2. Generate session token
    const tokenRes = await fetch(COINBASE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        addresses: [{ address, blockchains: ["base"] }],
        assets: ["USDC"],
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Coinbase session token error:", tokenRes.status, err);
      return NextResponse.json(
        { error: "Failed to generate session token" },
        { status: 502 }
      );
    }

    const { token } = (await tokenRes.json()) as { token: string };

    // 3. Build offramp URL
    const redirectUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://deal-bay.vercel.app";

    const params = new URLSearchParams({
      sessionToken: token,
      defaultAsset: "USDC",
      defaultNetwork: "base",
      presetCryptoAmount: amount,
      defaultCashoutMethod: "ACH_BANK_ACCOUNT",
      redirectUrl,
      ...(userId ? { partnerUserRef: userId } : {}),
    });

    const url = `https://pay.coinbase.com/v3/sell/input?${params.toString()}`;

    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Offramp request failed";
    console.error("Offramp error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
