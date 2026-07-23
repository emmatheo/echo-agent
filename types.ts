/**
 * types.ts
 * ------------------------------------------------------------------
 * Shared type definitions for Echo Agent (Injective Global Cup).
 *
 * Kept framework-agnostic so it can be imported from API routes,
 * the agent, the football tools, and the standalone MCP server.
 * ------------------------------------------------------------------
 */

/** Which service tier a request is asking for. */
export type Tier = "free" | "premium";

/* ------------------------------------------------------------------ *
 * Domain data (shape of /data/*.json)
 * ------------------------------------------------------------------ */

export interface MatchEvent {
  minute: number;
  type: "goal" | "own_goal" | "penalty_goal" | "yellow" | "red" | "sub" | "var";
  team: string;
  player: string;
  detail?: string;
}

export interface TeamMatchStats {
  team: string;
  goals: number;
  xg: number; // expected goals
  possession: number; // 0-100
  shots: number;
  shotsOnTarget: number;
  passAccuracy: number; // 0-100
  formation: string;
}

export interface Match {
  id: string;
  competition: string; // e.g. "FIFA World Cup 2026"
  stage: string; // "Group A", "Round of 32", "Final", ...
  date: string; // ISO date
  venue: string;
  city: string;
  status: "scheduled" | "completed";
  home: TeamMatchStats;
  away: TeamMatchStats;
  events: MatchEvent[];
  summary: string; // short human-readable recap
}

export interface PlayerStats {
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  xg: number;
  xa: number; // expected assists
  passAccuracy: number;
  dribblesPer90?: number;
  tacklesPer90?: number;
  rating: number; // average match rating 0-10
}

export interface Player {
  id: string;
  name: string;
  country: string;
  club: string;
  position: "GK" | "DF" | "MF" | "FW";
  age: number;
  foot: "left" | "right" | "both";
  marketValueEur: number;
  worldCup2026: PlayerStats;
  traits: string[]; // scouting descriptors
}

/* ------------------------------------------------------------------ *
 * Agent I/O
 * ------------------------------------------------------------------ */

export interface AnalyzeRequest {
  query: string;
  tier?: Tier; // defaults to "free"
  /** Optional conversation history so the chat UI can send context. */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface ToolCallTrace {
  name: string;
  input: unknown;
}

export interface AgentResult {
  tier: Tier;
  answer: string;
  toolCalls: ToolCallTrace[];
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Standard success envelope returned by POST /api/analyze. */
export interface AnalyzeResponse extends AgentResult {
  ok: true;
  /** Present only on a settled premium request (base64 x402 receipt). */
  paymentReceipt?: string;
}

/** Standard error envelope. */
export interface ErrorResponse {
  ok: false;
  error: string;
  code:
    | "bad_request"
    | "payment_required"
    | "payment_failed"
    | "agent_error"
    | "server_error";
  /** For payment_required: everything the client needs to pay / top up. */
  payment?: PaymentInfo;
}

/* ------------------------------------------------------------------ *
 * x402 / payment
 * ------------------------------------------------------------------ */

export interface PaymentInfo {
  scheme: "exact";
  network: string; // "eip155:1776"
  asset: string; // USDC contract on Injective EVM
  /** Amount in the asset's smallest unit (USDC = 6 decimals). */
  amount: string;
  /** Human-friendly amount, e.g. "0.02 USDC". */
  displayAmount: string;
  /** Where the payment is sent. */
  payTo: string;
  /** Everything a wallet needs to add Injective EVM + top up USDC. */
  chain: InjectiveChainInfo;
}

export interface InjectiveChainInfo {
  chainName: string;
  chainIdDecimal: number; // 1776
  chainIdHex: string; // 0x6f0
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  usdcAddress: string;
  usdcDecimals: number;
  /** Link to bridge / CCTP top-up flow for USDC. */
  bridgeUrl: string;
}
