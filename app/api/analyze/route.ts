/**
 * app/api/analyze/route.ts
 * ------------------------------------------------------------------
 * Echo Agent's single endpoint.
 *
 *   POST /api/analyze   -> run the football agent
 *                          - tier "free"    : answer immediately
 *                          - tier "premium" : x402-gated (0.02 USDC)
 *   GET  /api/analyze    -> service metadata (price, chain params,
 *                          bridge link, dataset size) for the UI
 *
 * PREMIUM FLOW (real x402 via @injectivelabs/x402):
 *   1. First POST with no payment  -> runInjectiveX402 returns a 402
 *      response (price quote + accepts[] + chain/bridge info).
 *   2. Client signs a USDC transfer, retries with the X-PAYMENT header.
 *   3. The official middleware verifies + settles via the facilitator.
 *   4. We run the premium agent and return 200 + the X-PAYMENT-RESPONSE
 *      receipt header.
 *
 * Runs on the Node.js runtime: needs `fs` (data + skill) and the
 * Express-style x402 middleware.
 * ------------------------------------------------------------------
 */

import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "../../../lib/agent";
import {
  datasetStats,
  recentResults,
  topScorers,
} from "../../../lib/football-tools";
import {
  INJECTIVE_EVM,
  PAY_TO_ADDRESS,
  PREMIUM_PRICE_USDC,
  X402_NETWORK,
  buildPaymentInfo,
} from "../../../lib/injective";
import { runInjectiveX402 } from "../../../lib/x402";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ErrorResponse,
  Tier,
} from "../../../types";

export const runtime = "nodejs";
// Never cache: every request is dynamic (payment + live model call).
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ *
 * GET — discovery / config for the chat UI + wallet connect
 * ------------------------------------------------------------------ */

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "Echo Agent — autonomous football intelligence",
    tiers: {
      free: "Concise answers — no payment.",
      premium: `Detailed analysis — ${PREMIUM_PRICE_USDC} USDC via x402.`,
    },
    x402: {
      network: X402_NETWORK,
      price: buildPaymentInfo(),
    },
    chain: INJECTIVE_EVM, // lets the UI add the network + link the bridge
    dataset: datasetStats(),
    // Live-ish board for the landing rail (no model call).
    board: {
      results: recentResults(5),
      scorers: topScorers(5),
    },
  });
}

/* ------------------------------------------------------------------ *
 * POST — the agent
 * ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  // --- 1. Parse + validate the body -------------------------------
  let body: AnalyzeRequest;
  try {
    body = (await request.json()) as AnalyzeRequest;
  } catch {
    return err(400, {
      ok: false,
      code: "bad_request",
      error: "Request body must be valid JSON.",
    });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return err(400, {
      ok: false,
      code: "bad_request",
      error: "Field 'query' is required.",
    });
  }
  const tier: Tier = body.tier === "premium" ? "premium" : "free";

  // Fail fast with a clear message if the model key is missing.
  if (!process.env.LLM_API_KEY && !process.env.GEMINI_API_KEY) {
    return err(500, {
      ok: false,
      code: "server_error",
      error: "Server is missing LLM_API_KEY (or GEMINI_API_KEY).",
    });
  }

  // --- 2. FREE tier: answer immediately ---------------------------
  if (tier === "free") {
    try {
      const result = await runAgent({ query, tier, history: body.history });
      return NextResponse.json<AnalyzeResponse>({ ok: true, ...result });
    } catch (e) {
      return agentError(e);
    }
  }

  // --- 3. PREMIUM tier: enforce x402 payment first ----------------
  // Fail fast with a clear message on server misconfiguration. Without a
  // real receiving address, settled payments would go to the zero address.
  // (X402_FACILITATOR_URL is optional — the middleware has a built-in
  // default facilitator when it isn't set.)
  if (/^0x0{40}$/i.test(PAY_TO_ADDRESS)) {
    return err(500, {
      ok: false,
      code: "server_error",
      error:
        "Server is missing PAY_TO_ADDRESS (the wallet that receives premium payments).",
    });
  }

  let gate: Awaited<ReturnType<typeof runInjectiveX402>>;
  try {
    gate = await runInjectiveX402(request);
  } catch (e) {
    // Facilitator down / malformed payment header / verify failure.
    return err(402, {
      ok: false,
      code: "payment_failed",
      error:
        "Payment could not be verified or settled: " +
        (e as Error).message +
        ". Ensure your wallet holds USDC on Injective EVM and retry.",
      payment: buildPaymentInfo(),
    });
  }

  // Not paid yet — return the middleware's 402 (enriched with chain info).
  if (!gate.paid) {
    return gate.response;
  }

  // --- 4. Paid + settled: run the premium agent -------------------
  try {
    const result = await runAgent({ query, tier, history: body.history });

    const res = NextResponse.json<AnalyzeResponse>({
      ok: true,
      ...result,
      paymentReceipt: gate.headers["x-payment-response"],
    });
    // Forward the x402 settlement receipt header(s) to the client.
    for (const [k, v] of Object.entries(gate.headers)) res.headers.set(k, v);
    return res;
  } catch (e) {
    // IMPORTANT: payment already settled but the agent failed. Return the
    // receipt so the user can be credited/retried rather than losing funds.
    const payload: ErrorResponse = {
      ok: false,
      code: "agent_error",
      error:
        "Your payment settled, but analysis failed to generate. Keep this receipt and retry: " +
        (e as Error).message,
    };
    const res = NextResponse.json(payload, { status: 502 });
    if (gate.headers["x-payment-response"]) {
      res.headers.set("x-payment-response", gate.headers["x-payment-response"]);
    }
    return res;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function err(status: number, payload: ErrorResponse) {
  return NextResponse.json(payload, { status });
}

function agentError(e: unknown) {
  return err(502, {
    ok: false,
    code: "agent_error",
    error: "The agent failed to generate a response: " + (e as Error).message,
  });
}
