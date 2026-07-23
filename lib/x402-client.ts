"use client";

/**
 * lib/x402-client.ts
 * Client-side wallet + x402 payment plumbing for the browser.
 *  - Connects an injected Injective-EVM wallet (MetaMask / Rabby) via viem.
 *  - Adds/switches to Injective EVM (chain 1776) if needed.
 *  - Uses the official x402 helper `wrapFetchWithPayment` so the
 *    402 -> sign (EIP-3009) -> retry-with-X-PAYMENT flow is handled by the lib.
 * Payment is signed CLIENT-SIDE by the user's wallet. No keys touch our server.
 */

import { createWalletClient, custom, type WalletClient } from "viem";
import { wrapFetchWithPayment } from "x402-fetch";

export const INJECTIVE_EVM_CLIENT = {
  chainIdDecimal: 1776,
  chainIdHex: "0x6f0",
  chainName: "Injective",
  rpcUrls: ["https://sentry.evm-rpc.injective.network/"],
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  blockExplorerUrls: ["https://blockscout.injective.network"],
  usdcAddress: "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
  bridgeUrl: "https://bridge.injective.network",
} as const;

const injectiveChain = {
  id: INJECTIVE_EVM_CLIENT.chainIdDecimal,
  name: INJECTIVE_EVM_CLIENT.chainName,
  nativeCurrency: INJECTIVE_EVM_CLIENT.nativeCurrency,
  rpcUrls: { default: { http: INJECTIVE_EVM_CLIENT.rpcUrls } },
} as const;

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getProvider(): Eip1193 {
  const eth = (globalThis as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) {
    throw new Error(
      "No EVM wallet found. Install MetaMask or Rabby, then reconnect.",
    );
  }
  return eth;
}

async function ensureInjectiveChain(provider: Eip1193) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: INJECTIVE_EVM_CLIENT.chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: INJECTIVE_EVM_CLIENT.chainIdHex,
            chainName: INJECTIVE_EVM_CLIENT.chainName,
            rpcUrls: INJECTIVE_EVM_CLIENT.rpcUrls,
            nativeCurrency: INJECTIVE_EVM_CLIENT.nativeCurrency,
            blockExplorerUrls: INJECTIVE_EVM_CLIENT.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export interface ConnectedWallet {
  address: `0x${string}`;
  walletClient: WalletClient;
}

export async function connectWallet(): Promise<ConnectedWallet> {
  const provider = getProvider();
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts?.length) throw new Error("No account authorised.");

  await ensureInjectiveChain(provider);

  const walletClient = createWalletClient({
    account: accounts[0] as `0x${string}`,
    chain: injectiveChain,
    transport: custom(provider as never),
  });

  return { address: accounts[0] as `0x${string}`, walletClient };
}

/**
 * Payment-aware fetch bound to the connected wallet. `maxValue` caps the quote
 * (0.05 USDC ceiling for a 0.02 USDC service) to protect the user.
 */
export function makePaidFetch(walletClient: WalletClient) {
  const MAX_USDC_ATOMIC = BigInt(50_000);
  return wrapFetchWithPayment(
    fetch,
    walletClient as never,
    MAX_USDC_ATOMIC as never,
  );
}

export function shortAddress(addr?: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
