import type { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    baseSepolia: {
      type: "http",
      url: "https://sepolia.base.org",
    },
    base: {
      type: "http",
      url: process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org",
    },
  },
};

export default config;
