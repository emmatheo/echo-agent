# Echo Agent ⚽🤖

Autonomous **football intelligence agent** for the **Injective Global Cup**.
Chat with an AI analyst about the 2026 World Cup and beyond. Basic answers are
free; **detailed analysis is paid per-request with 0.02 USDC over x402** on
Injective EVM.

Built on three required Injective technologies, used meaningfully:

| Requirement | How Echo Agent uses it |
| --- | --- |
| **MCP Server + Agent Skills** | A football **Agent Skill** (`skills/football-agent.md`) drives the brain, and the same structured workflows are exposed as a real **MCP server** (`lib/mcp-server.ts`) any client can consume. |
| **x402** | `POST /api/analyze?tier=premium` is gated by the **official `@injectivelabs/x402` middleware** — real 402 quote → wallet payment → facilitator verify + settle → response. Not mocked. |
| **CCTP / USDC** | Payments are **native, CCTP-enabled USDC** on Injective EVM. `GET /api/analyze` returns chain params + a **bridge/top-up link** so the UI can add the network and fund the wallet. |

> **Frontend note:** this repo is the **backend** (API routes, lib, skill, data).
> Drop your own `app/page.tsx` chat UI in — the client contract is documented below.

---

## Architecture

```
Browser (page.tsx)                Next.js API (App Router, Node runtime)
──────────────────                ─────────────────────────────────────
 chat + wallet  ──POST /api/analyze──►  route.ts
   (viem/wagmi)                          │  tier=free ─────────────► agent.ts ──► Claude + tools
   X-PAYMENT hdr                         │                                        (loads skill,
                                         │  tier=premium ─► x402.ts               calls football-tools)
                                         │     (official @injectivelabs/x402       │
                                         │      middleware, adapted to App Router) │
                                         │     402 quote / verify+settle           │
                                         └───────────────► agent.ts (premium) ─────┘

Shared brain:  football-tools.ts  ──►  also served over MCP by  mcp-server.ts
```

**Files**

| File | Role |
| --- | --- |
| `app/api/analyze/route.ts` | Endpoint. Free path, x402-gated premium path, discovery `GET`. |
| `lib/x402.ts` | Runs the official Injective x402 middleware inside App Router. |
| `lib/injective.ts` | Chain params, USDC address, price (`0.02 USDC = "20000"`), bridge link. |
| `lib/agent.ts` | Claude tool-use loop; loads the Agent Skill; free vs premium contract. |
| `lib/football-tools.ts` | Structured workflows over the JSON data (shared by agent + MCP). |
| `lib/mcp-server.ts` | Standalone MCP server exposing the same tools + the skill resource. |
| `skills/football-agent.md` | The Agent Skill (the brain's knowledge + output contracts). |
| `data/*.json` | 2026 World Cup matches + players (illustrative sample data). |
| `types.ts` | Shared types. |

---

## Setup

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env.local        # then fill in LLM_API_KEY, PAY_TO_ADDRESS,
                                  # and X402_FACILITATOR_URL

# 3. run
npm run dev                       # http://localhost:3000
```

Required env: `LLM_API_KEY` (free Gemini key from https://aistudio.google.com), `PAY_TO_ADDRESS`, `X402_FACILITATOR_URL`.
Chain defaults to Injective EVM **mainnet** (chain ID 1776); override in
`.env.local` for testnet (1439). See `.env.example`.

---

## Client contract (for your `page.tsx`)

### Discovery
```ts
const cfg = await fetch("/api/analyze").then(r => r.json());
// cfg.x402.price -> { amount:"20000", displayAmount:"0.02 USDC", asset, payTo, network }
// cfg.chain      -> add-network params + bridgeUrl for the "Top up USDC" button
```

### Free answer
```ts
await fetch("/api/analyze", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "How did France look in the group stage?", tier: "free" }),
});
// 200 -> { ok:true, answer, toolCalls, tier:"free", ... }
```

### Premium answer (x402)
1. **First request** (no payment) returns **HTTP 402** with the price quote:
   ```jsonc
   {
     "ok": false,
     "code": "payment_required",
     "accepts": [ /* standard x402 payment requirements from the middleware */ ],
     "payment": { "amount": "20000", "displayAmount": "0.02 USDC", "asset": "0xa00C…235a",
                  "payTo": "0x…", "network": "eip155:1776", "chain": { /* bridge, rpc … */ } }
   }
   ```
2. Client signs a USDC transfer with its Injective-EVM wallet and **retries the
   same POST** with the base64 **`X-PAYMENT`** header. Use the reference x402
   client (see the Injective demo at `agents.injective.com/x402`) or `viem` +
   the x402 client helpers to build the header.
3. On success you get **200** + an **`X-PAYMENT-RESPONSE`** receipt header and:
   ```jsonc
   { "ok": true, "answer": "…detailed analysis…", "tier": "premium",
     "paymentReceipt": "<base64>", "toolCalls": [ … ] }
   ```

**Wallet:** connect an Injective-EVM wallet with `viem`/`wagmi`
(`chainId 1776`, RPC `https://sentry.evm-rpc.injective.network/`). If the user
has no USDC, link `cfg.chain.bridgeUrl` (CCTP top-up).

---

## MCP server (the portable brain)

The football workflows are also a standalone MCP server:

```bash
npm run mcp        # stdio
```

Register with Claude Desktop (`claude_desktop_config.json`):
```jsonc
{
  "mcpServers": {
    "echo-agent-football": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/echo-agent/lib/mcp-server.ts"]
    }
  }
}
```
Exposes tools (`search_matches`, `get_match`, `get_player`, `scout_team`,
`compare_players`, `what_if_context`) and the skill as resource
`echo://skill/football-agent`.

---

## Design notes & honest caveats

- **Settlement timing.** `injectivePaymentMiddleware` verifies **and settles**
  before the handler runs, so payment clears just before the agent responds. The
  route wraps the agent in try/catch and returns the receipt if generation fails
  after payment (so the user can be retried/credited). For strict *settle-only-
  after-a-successful-response* semantics, swap `lib/x402.ts` for the `withX402`
  route wrapper from `@x402/next` — noted inline in that file.
- **Express→App Router adapter.** `lib/x402.ts` runs the official Express-style
  middleware against a minimal req/res shim so no protocol logic is re-implemented
  or mocked. If a future library version changes its req/res surface, the adapter
  is the one place to adjust.
- **Sample data.** `data/*.json` is **illustrative** (fabricated scorelines/xG)
  for the demo. Swap in a real feed without touching the agent — the tools are
  the only thing that read the files.

## ⚠️ Supply-chain security

In **July 2026**, `@injectivelabs/sdk-ts@1.20.21` was compromised (and 17 sibling
packages pinned to it) to exfiltrate wallet keys. **Do not use 1.20.21** — use
`>=1.20.23`. After `npm install`, run:

```bash
npm ls @injectivelabs/sdk-ts     # confirm nothing resolves to 1.20.21
```

Never put a real private key or mnemonic in this server. Payments are signed
**client-side** by the user's wallet; the backend only verifies/settles receipts
via the facilitator.

---

## Frontend (chat UI)

The chat UI lives in `app/page.tsx` (a client component) with a matchday look
adapted from the brief: near-black canvas, gold accent, condensed poster
headlines.

**Design system**
- **Palette:** ink `#0B0B0D`, carbon `#141417`, gold `#C9A24B`, bright gold
  `#E7C877`, bone `#EDEBE6` — see `tailwind.config.ts`.
- **Type (strict, loaded via `next/font`):** **Anton** for condensed uppercase
  headlines, **Inter** for all UI/body, **Roboto Mono** for scores/xG/USDC.
  Swap Anton for Oswald in `app/layout.tsx` if you prefer a lighter display.
- **Motion:** every button carries a gold "ribbon" sweep + tactile press
  (`components/magicui/shimmer-button.tsx`); full confetti
  (`components/magicui/confetti.ts`) is reserved for wins — wallet connected and
  premium payment settled — so it reads like a goal celebration, not noise.
  A rotating `BorderBeam` marks the premium surface. Respects
  `prefers-reduced-motion`.

**Wallet + x402 (client)** — `lib/x402-client.ts`
- Connects an injected Injective-EVM wallet (MetaMask/Rabby) via `viem`, adding
  chain `1776` if needed.
- Premium sends go through `wrapFetchWithPayment` from `x402-fetch`, so the
  402 → sign (EIP-3009) → retry-with-`X-PAYMENT` flow is handled by the official
  client lib. A `maxValue` cap (0.05 USDC) protects the user from a bad quote.
- Free sends use plain `fetch`. The right rail (Results + Golden Boot) is fed by
  `GET /api/analyze`.

**Hero image:** add your own licensed `hero.png` to `/public` (see
`public/README.txt`). The reference photo is a real player in club/brand kit and
isn't included.

### Instant preview
Open **`preview.html`** in any browser (double-click) to see the exact look and
interactions — sample prompts, tier toggle, ribbon buttons, and the confetti
celebration — with mock data and no build step. It's a visual stand-in; the
shipped `app/page.tsx` is wired to the live agent + real x402 payments.

### Frontend deps (already in package.json)
`framer-motion`, `canvas-confetti`, `x402-fetch`, `viem`, `lucide-react`,
`tailwindcss` + `clsx`/`tailwind-merge`.
