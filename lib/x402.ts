/**
 * lib/x402.ts
 * ------------------------------------------------------------------
 * REAL x402 payment enforcement for the premium tier, using the
 * OFFICIAL Injective library:  @injectivelabs/x402/middleware.
 *
 * WHY AN ADAPTER?
 * The library ships `injectivePaymentMiddleware` as an EXPRESS-style
 * middleware `(req, res, next) => ...`. Next.js App Router route
 * handlers speak the Web Fetch `Request`/`Response` API instead.
 * `runInjectiveX402` below is a tiny, well-contained adapter that:
 *   1. builds a minimal Express-shaped `req`/`res` from a Web `Request`,
 *   2. runs the official middleware against them,
 *   3. reports back either "paid" (middleware called next()) or the
 *      402 `Response` the middleware produced.
 *
 * This keeps ALL protocol logic (402 quoting, facilitator /verify and
 * /settle, receipt headers) inside the official library — we do not
 * re-implement or mock any of it.
 *
 * PROTOCOL RECAP (handled by the middleware):
 *   1. Client POSTs with no payment            -> 402 + price quote
 *   2. Client signs a USDC transfer, retries with the X-PAYMENT header
 *   3. Middleware verifies + settles via the facilitator, calls next()
 *   4. We run the agent and return 200 + X-PAYMENT-RESPONSE receipt
 *
 * SETTLEMENT-TIMING NOTE (read before production):
 * `injectivePaymentMiddleware` verifies AND settles before handing off
 * to the handler. So payment settles slightly before the agent runs.
 * We therefore wrap the agent call in try/catch (see the route) and, if
 * the agent fails post-payment, we return a clear error + the receipt so
 * the user can be credited/retried. If you want strict "settle only
 * AFTER a successful (<400) response" semantics, swap this adapter for
 * the `withX402` route wrapper from `@x402/next` (see README).
 * ------------------------------------------------------------------
 */

// The official Injective x402 middleware.
// npm i @injectivelabs/x402   (pin the version — see README security note)
import { injectivePaymentMiddleware } from "@injectivelabs/x402/middleware";

import {
  INJECTIVE_EVM,
  PAY_TO_ADDRESS,
  PREMIUM_PRICE_ATOMIC,
  PROTECTED_ROUTE,
  X402_FACILITATOR_PRIVATE_KEY,
  X402_FACILITATOR_URL,
  X402_NETWORK,
  buildPaymentInfo,
} from "./injective";

/* ------------------------------------------------------------------ *
 * Configure the official middleware ONCE at module load.
 *
 * Shape matches the Injective docs exactly:
 *   { 'POST /api/analyze': { accepts: [{ network, asset, amount }] } }
 * `amount` is in USDC's smallest unit (6 decimals): 0.02 USDC = "20000".
 * ------------------------------------------------------------------ */
// Build the middleware lazily. Running the factory at module top level would
// execute it at import time (e.g. during `next build` page-data collection),
// which can throw before any request is served. Deferring to first use keeps
// the module safe to import.
let _injectiveMiddleware: ReturnType<typeof injectivePaymentMiddleware> | null =
  null;

// Element type of a route's `accepts` array, derived from the middleware's
// own signature so it always matches the installed library version without
// depending on the library exporting the type by name.
type RoutePaymentOption = NonNullable<
  Parameters<typeof injectivePaymentMiddleware>[0][string]["accepts"]
>[number];

type MiddlewareOptions = Parameters<typeof injectivePaymentMiddleware>[1];

/**
 * The middleware requires exactly one of:
 *  - facilitatorUrl: a remote facilitator service, or
 *  - facilitator:    inline settlement in this process, signing with the
 *                    X402_FACILITATOR_PRIVATE_KEY wallet (needs INJ for gas).
 */
function facilitatorOptions(): MiddlewareOptions {
  if (X402_FACILITATOR_URL) {
    return { facilitatorUrl: X402_FACILITATOR_URL };
  }
  if (X402_FACILITATOR_PRIVATE_KEY) {
    return {
      facilitator: {
        privateKey: X402_FACILITATOR_PRIVATE_KEY as `0x${string}`,
      } as NonNullable<MiddlewareOptions["facilitator"]>,
    };
  }
  throw new Error(
    "Set X402_FACILITATOR_PRIVATE_KEY (inline settlement) or X402_FACILITATOR_URL (remote facilitator) to enable premium payments.",
  );
}

function getInjectiveMiddleware() {
  if (!_injectiveMiddleware) {
    _injectiveMiddleware = injectivePaymentMiddleware(
      {
        [PROTECTED_ROUTE]: {
          // Required by the library's RoutePaymentConfig.
          description: "Echo Agent — detailed premium football analysis",
          accepts: [
            {
              network: X402_NETWORK, // "eip155:1776"
              asset: INJECTIVE_EVM.usdcAddress, // native USDC on Injective EVM
              amount: PREMIUM_PRICE_ATOMIC, // "20000"
              // Some library versions accept a payTo / description here; the
              // middleware falls back to its own defaults if unsupported.
              payTo: PAY_TO_ADDRESS,
              description: "Echo Agent — detailed premium football analysis",
            } as unknown as RoutePaymentOption,
          ],
        },
      },
      facilitatorOptions(),
    );
  }
  return _injectiveMiddleware;
}

/* ------------------------------------------------------------------ *
 * Minimal Express req/res shims.
 * We only implement the surface x402 middleware actually touches:
 * method, url/path, headers, and the response terminators.
 * ------------------------------------------------------------------ */

type NextFn = (err?: unknown) => void;

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

/** Build a lowercase header bag from a Web Request. */
function headerBag(req: Request): Record<string, string> {
  const bag: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    bag[key.toLowerCase()] = value;
  });
  return bag;
}

/**
 * Run the official Injective x402 middleware against a Web Request.
 *
 * @returns
 *   { paid: true, headers } when the middleware authorised the request
 *   (payment verified + settled). `headers` includes the X-PAYMENT-RESPONSE
 *   receipt to forward on the eventual 200 response.
 *
 *   { paid: false, response } when the middleware short-circuited with a
 *   402 (no/invalid payment). `response` is a ready-to-return Web Response.
 */
export async function runInjectiveX402(
  request: Request,
): Promise<
  | { paid: true; headers: Record<string, string> }
  | { paid: false; response: Response }
> {
  const url = new URL(request.url);
  const headers = headerBag(request);

  const captured: CapturedResponse = { status: 200, headers: {}, body: null };
  let responded = false;
  let passed = false;

  // --- Express-ish request shim -----------------------------------
  const reqShim: Record<string, unknown> = {
    method: request.method,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    baseUrl: "",
    path: url.pathname,
    protocol: url.protocol.replace(":", ""),
    hostname: url.hostname,
    headers,
    // Express helpers some middlewares use:
    get: (name: string) => headers[name.toLowerCase()],
    header: (name: string) => headers[name.toLowerCase()],
  };

  // --- Express-ish response shim ----------------------------------
  const setHeader = (name: string, value: unknown) => {
    captured.headers[name] = String(value);
  };

  const finish = (body?: unknown) => {
    if (body !== undefined && body !== null) {
      captured.body =
        typeof body === "string" ? body : JSON.stringify(body);
    }
    responded = true;
  };

  const resShim: Record<string, unknown> = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      captured.status = code;
      (this as { statusCode: number }).statusCode = code;
      return this;
    },
    set(name: string | Record<string, string>, value?: string) {
      if (typeof name === "object") {
        for (const [k, v] of Object.entries(name)) setHeader(k, v);
      } else {
        setHeader(name, value);
      }
      return this;
    },
    header(name: string, value: string) {
      setHeader(name, value);
      return this;
    },
    setHeader,
    getHeader: (name: string) => captured.headers[name],
    json(payload: unknown) {
      setHeader("content-type", "application/json");
      finish(payload);
      return this;
    },
    send(payload: unknown) {
      finish(payload);
      return this;
    },
    end(payload?: unknown) {
      finish(payload);
      return this;
    },
  };

  const next: NextFn = (err) => {
    if (err) throw err;
    passed = true;
  };

  // --- Run the official middleware --------------------------------
  await Promise.resolve(
    (getInjectiveMiddleware() as unknown as (
      req: unknown,
      res: unknown,
      next: NextFn,
    ) => unknown)(reqShim, resShim, next),
  );

  // Give an async middleware a microtask to settle if it resolved
  // before calling its terminator (defensive).
  if (!passed && !responded) {
    await new Promise((r) => setTimeout(r, 0));
  }

  if (passed) {
    // Payment verified + settled. Forward any receipt header the
    // middleware set (e.g. X-PAYMENT-RESPONSE) to the final response.
    return { paid: true, headers: captured.headers };
  }

  // Middleware short-circuited — most likely a 402. Rebuild it as a Web
  // Response, and enrich a 402 body with our PaymentInfo (chain + bridge)
  // so the chat UI can render "Pay" + "Top up USDC" without guessing.
  const status = captured.status || 402;
  const headersOut = new Headers(captured.headers);

  let body = captured.body;
  if (status === 402) {
    let parsed: Record<string, unknown> = {};
    if (body) {
      try {
        parsed = JSON.parse(body);
      } catch {
        /* keep raw text if middleware sent non-JSON */
      }
    }
    body = JSON.stringify({
      ok: false,
      code: "payment_required",
      error: "Premium analysis requires a 0.02 USDC payment via x402.",
      // Standard x402 fields from the middleware (accepts, x402Version…)
      ...parsed,
      // Convenience block for the client (chain params + bridge link).
      payment: buildPaymentInfo(),
    });
    headersOut.set("content-type", "application/json");
  }

  return {
    paid: false,
    response: new Response(body, { status, headers: headersOut }),
  };
}
