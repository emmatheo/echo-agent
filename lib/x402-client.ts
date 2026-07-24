"use client";

/**
 * lib/x402-client.ts
 * Client-side wallet + x402 payment plumbing for the browser.
 *  - Connects an injected Injective-EVM wallet (MetaMask / Rabby) via viem.
 *  - Adds/switches to Injective EVM (chain 1776) if needed.
 *  - Premium requests pay via @injectivelabs/x402's own client (the same
 *    package that quotes the 402 server-side), signed by a demo agent wallet.
 */

import { createInjectiveClient } from "@injectivelabs/x402/client";
import { createWalletClient, custom, type WalletClient } from "viem";

// NEXT_PUBLIC_* vars are inlined at build time, so the deploy environment
// (e.g. Render) controls which chain the wallet flow targets. Defaults are
// Injective EVM MAINNET (1776); set the vars for TESTNET (1439).
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_INJ_CHAIN_ID ?? 1776);

export const INJECTIVE_EVM_CLIENT = {
  chainIdDecimal: CHAIN_ID,
  chainIdHex: "0x" + CHAIN_ID.toString(16),
  chainName:
    process.env.NEXT_PUBLIC_INJ_CHAIN_NAME ??
    (CHAIN_ID === 1776 ? "Injective" : "Injective Testnet"),
  rpcUrls: [
    process.env.NEXT_PUBLIC_INJ_RPC_URL ??
      "https://sentry.evm-rpc.injective.network/",
  ],
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  blockExplorerUrls: [
    process.env.NEXT_PUBLIC_INJ_EXPLORER_URL ??
      "https://blockscout.injective.network",
  ],
  usdcAddress:
    process.env.NEXT_PUBLIC_USDC_ADDRESS ??
    "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
  bridgeUrl:
    process.env.NEXT_PUBLIC_INJ_BRIDGE_URL ?? "https://bridge.injective.network",
} as const;

const injectiveChain = {
  id: INJECTIVE_EVM_CLIENT.chainIdDecimal,
  name: INJECTIVE_EVM_CLIENT.chainName,
  nativeCurrency: INJECTIVE_EVM_CLIENT.nativeCurrency,
  rpcUrls: { default: { http: INJECTIVE_EVM_CLIENT.rpcUrls } },
} as const;

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (payload: unknown) => void) => void;
  removeListener?: (
    event: string,
    handler: (payload: unknown) => void,
  ) => void;
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
  const switchToChain = () =>
    provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: INJECTIVE_EVM_CLIENT.chainIdHex }],
    });

  try {
    await switchToChain();
  } catch (switchErr) {
    // Wallets disagree on how they report "chain not added": MetaMask uses
    // code 4902, others use different codes or only a message. If the user
    // outright rejected the request, respect that; otherwise try adding the
    // chain (which in most wallets also switches to it), then switch again.
    const code = (switchErr as { code?: number }).code;
    if (code === 4001) throw switchErr; // user rejected

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
    await switchToChain();
  }
}

export interface ConnectedWallet {
  address: `0x${string}`;
  walletClient: WalletClient;
}

function buildWallet(provider: Eip1193, address: string): ConnectedWallet {
  const walletClient = createWalletClient({
    account: address as `0x${string}`,
    chain: injectiveChain,
    transport: custom(provider as never),
  });
  return { address: address as `0x${string}`, walletClient };
}

export async function connectWallet(): Promise<ConnectedWallet> {
  const provider = getProvider();

  // Ask for the account picker first so a returning user can choose a
  // different account. Not all wallets implement wallet_requestPermissions;
  // fall through silently and let eth_requestAccounts handle it.
  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (err) {
    // 4001 = user rejected the picker; treat that as cancelling the connect.
    if ((err as { code?: number }).code === 4001) throw err;
  }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts?.length) throw new Error("No account authorised.");

  await ensureInjectiveChain(provider);

  return buildWallet(provider, accounts[0]);
}

/**
 * Forget the connection app-side and ask the wallet to revoke the site's
 * account permission (supported by MetaMask; best-effort elsewhere), so the
 * next connect shows the account picker again.
 */
export async function disconnectWallet(): Promise<void> {
  try {
    await getProvider().request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Wallet doesn't support revocation — app-side forget is all we can do.
  }
}

/**
 * Re-assert the configured Injective chain (used right before payment, in
 * case the user switched networks after connecting).
 */
export async function ensureWalletChain(): Promise<void> {
  await ensureInjectiveChain(getProvider());
}

/**
 * Track wallet-side account changes (switching account, disconnecting from
 * the wallet UI). Returns an unsubscribe function. `onChange` receives the
 * new ConnectedWallet, or null when no account remains authorised.
 */
export function watchWallet(
  onChange: (wallet: ConnectedWallet | null) => void,
): () => void {
  let provider: Eip1193;
  try {
    provider = getProvider();
  } catch {
    return () => {};
  }
  if (!provider.on) return () => {};

  const handler = (payload: unknown) => {
    const accounts = (payload as string[]) ?? [];
    onChange(accounts.length ? buildWallet(provider, accounts[0]) : null);
  };
  provider.on("accountsChanged", handler);
  return () => provider.removeListener?.("accountsChanged", handler);
}

/**
 * Payment-aware fetch using @injectivelabs/x402's own client — the same
 * package that quotes the 402 on the server, so requester and quoter always
 * speak the same protocol dialect.
 *
 * x402 is agent-native: payments are signed by a payer key, not an injected
 * wallet popup. The demo "agent wallet" key comes from
 * NEXT_PUBLIC_PAYER_PRIVATE_KEY (build-time inlined). Fund it with a little
 * testnet USDC; it needs no gas (the facilitator settles on-chain).
 * TESTNET ONLY: anything in NEXT_PUBLIC_* ships in the JS bundle, so never
 * put a mainnet key here.
 */
const PAYER_PRIVATE_KEY = process.env.NEXT_PUBLIC_PAYER_PRIVATE_KEY;

export function makePaidFetch(_walletClient: WalletClient) {
  if (!PAYER_PRIVATE_KEY) {
    throw new Error(
      "Premium demo payments need NEXT_PUBLIC_PAYER_PRIVATE_KEY (a testnet agent wallet holding USDC) set at build time.",
    );
  }
  const client = createInjectiveClient({
    privateKey: PAYER_PRIVATE_KEY as `0x${string}`,
  });
  return (input: RequestInfo | URL, init?: RequestInit) => {
    // The x402 client wants an absolute URL; resolve app-relative paths.
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(raw, globalThis.location?.origin).href;
    return client.fetch(url, init);
  };
}

export function shortAddress(addr?: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
