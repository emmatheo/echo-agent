/**
 * lib/injective.ts
 * ------------------------------------------------------------------
 * Single source of truth for Injective EVM chain parameters and the
 * x402 payment configuration used by Echo Agent.
 *
 * All values below are Injective EVM MAINNET. They were taken from the
 * official Injective docs:
 *   - EVM network info: https://docs.injective.network/developers-evm/network-information
 *   - x402 guide:        https://docs.injective.network/developers-ai/x402
 *
 * Chain ID 1776 (0x6f0) maps to the native chain `injective-1`.
 * USDC on Injective EVM is native + CCTP-enabled (6 decimals).
 * ------------------------------------------------------------------
 */

import type { InjectiveChainInfo } from "../types";

/**
 * Injective EVM mainnet. The frontend uses this to `wallet_addEthereumChain`
 * and to render the "top up USDC" / bridge link (CCTP requirement).
 *
 * For TESTNET, override via env (see .env.example): chainId 1439,
 * rpc https://k8s.testnet.json-rpc.injective.network/
 */
export const INJECTIVE_EVM: InjectiveChainInfo = {
  chainName: process.env.INJ_CHAIN_NAME ?? "Injective",
  chainIdDecimal: Number(process.env.INJ_CHAIN_ID ?? 1776),
  chainIdHex: "0x" + Number(process.env.INJ_CHAIN_ID ?? 1776).toString(16), // 0x6f0
  rpcUrl:
    process.env.INJ_RPC_URL ?? "https://sentry.evm-rpc.injective.network/",
  explorerUrl:
    process.env.INJ_EXPLORER_URL ?? "https://blockscout.injective.network",
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  // Native, CCTP-enabled USDC on Injective EVM (6 decimals).
  usdcAddress:
    process.env.USDC_ADDRESS ??
    "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
  usdcDecimals: 6,
  // CCTP / bridge entry point for easy USDC top-up.
  bridgeUrl: process.env.INJ_BRIDGE_URL ?? "https://bridge.injective.network",
};

/** x402 network identifier for Injective EVM (CAIP-2 style). */
export const X402_NETWORK = `eip155:${INJECTIVE_EVM.chainIdDecimal}`; // "eip155:1776"

/** Premium price for a detailed analysis: 0.02 USDC. */
export const PREMIUM_PRICE_USDC = 0.02;

/**
 * Same price expressed in the smallest USDC unit (6 decimals).
 * 0.02 * 10^6 = 20000. The x402 middleware expects the amount as a string.
 */
export const PREMIUM_PRICE_ATOMIC = Math.round(
  PREMIUM_PRICE_USDC * 10 ** INJECTIVE_EVM.usdcDecimals,
).toString(); // "20000"

/** Wallet that receives premium payments. MUST be set in production. */
export const PAY_TO_ADDRESS =
  process.env.PAY_TO_ADDRESS ?? "0x0000000000000000000000000000000000000000";

/**
 * Injective x402 facilitator URL. The facilitator abstracts RPC, gas,
 * signature verification and on-chain settlement away from this server.
 * Provided by env so you can point at testnet vs mainnet facilitators.
 */
export const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "";

/** The x402-gated route (method + path) this server protects. */
export const PROTECTED_ROUTE = "POST /api/analyze";

/**
 * Convenience: a fully-formed PaymentInfo object handed back to the client
 * inside a 402 response so the chat UI can render "Pay 0.02 USDC" and a
 * "Top up via bridge" button without hardcoding anything.
 */
export function buildPaymentInfo() {
  return {
    scheme: "exact" as const,
    network: X402_NETWORK,
    asset: INJECTIVE_EVM.usdcAddress,
    amount: PREMIUM_PRICE_ATOMIC,
    displayAmount: `${PREMIUM_PRICE_USDC} USDC`,
    payTo: PAY_TO_ADDRESS,
    chain: INJECTIVE_EVM,
  };
}
