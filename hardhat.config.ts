import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: process.env.PLATFORM_WALLET_PRIVATE_KEY
        ? [process.env.PLATFORM_WALLET_PRIVATE_KEY]
        : [],
    },
    base: {
      url: process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PLATFORM_WALLET_PRIVATE_KEY
        ? [process.env.PLATFORM_WALLET_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
