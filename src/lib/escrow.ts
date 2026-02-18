import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  parseUnits,
  type Address,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { USDC_DECIMALS, PLATFORM_FEE_BPS } from "./constants";

const ESCROW_ABI = [
  {
    inputs: [
      { name: "dealId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "feeBps", type: "uint256" },
      { name: "transferDeadline", type: "uint256" },
      { name: "confirmDeadline", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "dealId", type: "bytes32" }],
    name: "markTransferred",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "dealId", type: "bytes32" }],
    name: "confirm",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "dealId", type: "bytes32" }],
    name: "refund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "dealId", type: "bytes32" }],
    name: "autoRelease",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "dealId", type: "bytes32" }],
    name: "dispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "dealId", type: "bytes32" },
      { name: "favorBuyer", type: "bool" },
    ],
    name: "resolveDispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "bytes32" }],
    name: "deals",
    outputs: [
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "platformFeeBps", type: "uint256" },
      { name: "depositedAt", type: "uint256" },
      { name: "transferredAt", type: "uint256" },
      { name: "transferDeadline", type: "uint256" },
      { name: "confirmDeadline", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const chain =
  process.env.NEXT_PUBLIC_CHAIN_ID === "84532" ? baseSepolia : base;
const escrowAddress = process.env
  .NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS as Address;
const usdcAddress = process.env
  .NEXT_PUBLIC_USDC_CONTRACT_ADDRESS as Address;

export function dealIdToBytes32(dealUuid: string): `0x${string}` {
  return keccak256(toHex(dealUuid));
}

export function getPublicClient() {
  return createPublicClient({
    chain,
    transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  });
}

export function getPlatformWalletClient() {
  const account = privateKeyToAccount(
    process.env.PLATFORM_WALLET_PRIVATE_KEY as `0x${string}`
  );
  return createWalletClient({
    account,
    chain,
    transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  });
}

export async function resolveDisputeOnChain(
  dealUuid: string,
  favorBuyer: boolean
): Promise<string> {
  const walletClient = getPlatformWalletClient();
  const dealId = dealIdToBytes32(dealUuid);

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "resolveDispute",
    args: [dealId, favorBuyer],
  });

  return hash;
}

export async function triggerRefund(dealUuid: string): Promise<string> {
  const walletClient = getPlatformWalletClient();
  const dealId = dealIdToBytes32(dealUuid);

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "refund",
    args: [dealId],
  });

  return hash;
}

export async function triggerAutoRelease(dealUuid: string): Promise<string> {
  const walletClient = getPlatformWalletClient();
  const dealId = dealIdToBytes32(dealUuid);

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "autoRelease",
    args: [dealId],
  });

  return hash;
}

export async function getDealOnChain(dealUuid: string) {
  const publicClient = getPublicClient();
  const dealId = dealIdToBytes32(dealUuid);

  const result = await publicClient.readContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "deals",
    args: [dealId],
  });

  return result;
}

export function getDepositParams(
  dealUuid: string,
  sellerAddress: Address,
  priceCents: number,
  transferDeadlineSeconds: number,
  confirmDeadlineSeconds: number
) {
  return {
    escrowAddress,
    usdcAddress,
    dealId: dealIdToBytes32(dealUuid),
    seller: sellerAddress,
    amount: parseUnits(String(priceCents / 100), USDC_DECIMALS),
    feeBps: BigInt(PLATFORM_FEE_BPS),
    transferDeadline: BigInt(transferDeadlineSeconds),
    confirmDeadline: BigInt(confirmDeadlineSeconds),
    escrowAbi: ESCROW_ABI,
    erc20Abi: ERC20_ABI,
  };
}
