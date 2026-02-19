import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

/**
 * POST /api/faucet
 * Claims testnet ETH or USDC via the CDP Faucet API.
 * Only works on Base Sepolia (testnet).
 *
 * Body: { address: string, token: "eth" | "usdc" }
 */
export async function POST(req: NextRequest) {
  // Only allow on testnet
  if (process.env.NEXT_PUBLIC_CHAIN_ID !== "84532") {
    return NextResponse.json(
      { error: "Faucet is only available on testnet" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { address, token } = body as {
    address?: string;
    token?: string;
  };

  if (!address || !token) {
    return NextResponse.json(
      { error: "Missing address or token" },
      { status: 400 }
    );
  }

  if (token !== "eth" && token !== "usdc") {
    return NextResponse.json(
      { error: "Token must be 'eth' or 'usdc'" },
      { status: 400 }
    );
  }

  // Map env vars for CDP SDK
  if (!process.env.CDP_API_KEY_ID && process.env.COINBASE_API_KEY_ID) {
    process.env.CDP_API_KEY_ID = process.env.COINBASE_API_KEY_ID;
  }
  if (!process.env.CDP_API_KEY_SECRET && process.env.COINBASE_API_KEY_SECRET) {
    process.env.CDP_API_KEY_SECRET = process.env.COINBASE_API_KEY_SECRET;
  }

  try {
    const cdp = new CdpClient();

    const result = await cdp.evm.requestFaucet({
      address: address as `0x${string}`,
      network: "base-sepolia",
      token,
    });

    return NextResponse.json({
      transactionHash: result.transactionHash,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Faucet request failed";
    console.error("Faucet error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
