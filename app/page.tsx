"use client";

import {
  ArrowUpRight,
  Loader2,
  Lock,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";
import * as React from "react";
import { fireBurst, fireRibbons } from "../components/magicui/confetti";
import {
  AnimatedShinyText,
  BorderBeam,
  LiveDot,
} from "../components/magicui/effects";
import { ShimmerButton } from "../components/magicui/shimmer-button";
import {
  connectWallet,
  INJECTIVE_EVM_CLIENT,
  makePaidFetch,
  shortAddress,
  type ConnectedWallet,
} from "../lib/x402-client";

/* ------------------------------------------------------------------ *
 * Types for the GET /api/analyze board payload
 * ------------------------------------------------------------------ */
interface BoardResult {
  id: string;
  stage: string;
  home: string;
  homeGoals: number;
  away: string;
  awayGoals: number;
}
interface BoardScorer {
  rank: number;
  name: string;
  country: string;
  goals: number;
  assists: number;
}
interface Config {
  x402: { price: { displayAmount: string } };
  chain: { bridgeUrl: string };
  board: { results: BoardResult[]; scorers: BoardScorer[] };
}

interface ChatMessage {
  role: "user" | "agent";
  content: string;
  tier?: "free" | "premium";
  receipt?: string;
}

const SAMPLES = [
  "Break down France 3-1 USA — what did the xG say?",
  "Scout Argentina: who wins them the tournament?",
  "Compare Mbappé and Vinícius Júnior at this World Cup.",
  "What if Mexico had converted their chances vs Argentina?",
];

/* ================================================================== */

export default function Page() {
  const [cfg, setCfg] = React.useState<Config | null>(null);
  const [wallet, setWallet] = React.useState<ConnectedWallet | null>(null);
  const [tier, setTier] = React.useState<"free" | "premium">("free");
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const chatRef = React.useRef<HTMLDivElement>(null);
  const logRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() =>
        setNotice("Couldn't load the match board. Is the API running?"),
      );
  }, []);

  React.useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  const price = cfg?.x402.price.displayAmount ?? "0.02 USDC";
  const bridgeUrl = cfg?.chain.bridgeUrl ?? INJECTIVE_EVM_CLIENT.bridgeUrl;

  function scrollToChat() {
    chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleConnect() {
    try {
      const w = await connectWallet();
      setWallet(w);
      fireBurst(0.9, 0.12);
      setNotice(null);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function send(text?: string) {
    const query = (text ?? input).trim();
    if (!query || busy) return;

    if (tier === "premium" && !wallet) {
      setNotice("Connect an Injective-EVM wallet to unlock premium analysis.");
      return;
    }

    setNotice(null);
    setMessages((m) => [...m, { role: "user", content: query, tier }]);
    setInput("");
    setBusy(true);

    try {
      const doFetch =
        tier === "premium" && wallet
          ? makePaidFetch(wallet.walletClient)
          : fetch;

      const res = await doFetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, tier }),
      });

      const receipt = res.headers.get("x-payment-response") ?? undefined;
      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Request failed (${res.status}).`);
      }

      if (tier === "premium") fireRibbons();

      setMessages((m) => [
        ...m,
        {
          role: "agent",
          content: data.answer,
          tier: data.tier,
          receipt: data.paymentReceipt ?? receipt,
        },
      ]);
    } catch (e) {
      const msg = (e as Error).message;
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          content:
            tier === "premium"
              ? `Payment or analysis didn't complete: ${msg}. No charge is kept for a failed premium request — check your USDC balance on Injective and try again.`
              : `Something went wrong: ${msg}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <a href="#" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-sm bg-gold font-display text-lg text-ink">
              EA
            </span>
            <span className="font-display text-lg tracking-tightest">
              Echo Agent
            </span>
          </a>
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
            {["Analyze", "Matches", "Scouting", "Pricing"].map((l) => (
              <a
                key={l}
                href="#chat"
                onClick={scrollToChat}
                className="transition-colors hover:text-bone"
              >
                {l}
              </a>
            ))}
          </nav>
          {wallet ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-line bg-carbon px-3 py-2 font-mono text-xs text-goldbright">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              {shortAddress(wallet.address)}
            </span>
          ) : (
            <ShimmerButton
              variant="ghost"
              onClick={handleConnect}
              className="py-2"
            >
              <Wallet className="h-4 w-4" /> Connect wallet
            </ShimmerButton>
          )}
        </div>
      </header>

      {/* ---------- Hero + rail ---------- */}
      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-12 lg:grid-cols-[1.55fr_1fr] lg:py-16">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-xl border border-line bg-carbon">
          {/* Image slot — drop your OWN licensed player shot at /public/hero.png */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-60"
            style={{
              backgroundImage:
                "linear-gradient(90deg,#0B0B0D 8%,rgba(11,11,13,0.55) 46%,rgba(11,11,13,0.1) 100%), url('/hero.png')",
            }}
          />
          <div className="pointer-events-none absolute -right-24 top-0 h-full w-64 rotate-12 bg-gradient-to-b from-gold/25 to-transparent blur-2xl" />

          <div className="relative z-10 flex min-h-[420px] flex-col justify-end p-8 md:min-h-[500px] md:p-10">
            <div className="mb-4 inline-flex items-center gap-2 self-start rounded-full border border-line bg-ink/60 px-3 py-1 text-[11px] font-semibold tracking-widest">
              <LiveDot />
              <AnimatedShinyText>
                LIVE · 2026 WORLD CUP INTELLIGENCE
              </AnimatedShinyText>
            </div>

            <h1 className="font-display text-5xl leading-[0.92] tracking-tightest md:text-7xl">
              Read the game
              <br />
              <span className="text-gold-grad">like an analyst</span>
            </h1>

            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              Echo Agent is an autonomous football analyst you chat with. Ask
              about any 2026 World Cup match, scout a team or player, or run a
              what-if. Basics are free — go deeper for {price}, paid per answer
              in USDC on Injective.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ShimmerButton onClick={scrollToChat}>
                <Sparkles className="h-4 w-4" /> Start analyzing
              </ShimmerButton>
              <ShimmerButton
                variant="ghost"
                onClick={() => {
                  setInput(SAMPLES[0]);
                  scrollToChat();
                }}
              >
                See a sample
              </ShimmerButton>
            </div>
          </div>
        </div>

        {/* Rail */}
        <div className="flex flex-col gap-6">
          <RailCard title="Results">
            <div className="divide-y divide-line">
              {(cfg?.board.results ?? []).map((r) => (
                <ScoreRow
                  key={r.id}
                  r={r}
                  onClick={() => {
                    setInput(
                      `Break down ${r.home} ${r.homeGoals}-${r.awayGoals} ${r.away}.`,
                    );
                    scrollToChat();
                  }}
                />
              ))}
              {!cfg && <SkeletonRows n={5} />}
            </div>
            <RailFooter label="Ask about any result" onClick={scrollToChat} />
          </RailCard>

          <RailCard title="Golden Boot race">
            <div className="divide-y divide-line">
              {(cfg?.board.scorers ?? []).map((s) => (
                <ScorerRow
                  key={s.name}
                  s={s}
                  onClick={() => {
                    setInput(`Scout ${s.name} — strengths, weaknesses, and fit.`);
                    scrollToChat();
                  }}
                />
              ))}
              {!cfg && <SkeletonRows n={5} />}
            </div>
            <RailFooter label="Scout a player" onClick={scrollToChat} />
          </RailCard>
        </div>
      </section>

      {/* ---------- Tier strip ---------- */}
      <section className="mx-auto grid max-w-7xl gap-4 px-5 pb-4 md:grid-cols-3">
        <TierCard
          eyebrow="Free"
          title="Basic answers"
          body="Quick, grounded takes on matches, players and matchups. No wallet, no cost."
        />
        <div className="relative overflow-hidden rounded-xl border border-gold/40 bg-panel p-6">
          <BorderBeam />
          <p className="font-display text-xs tracking-widest text-gold">
            Premium
          </p>
          <h3 className="mt-1 font-display text-2xl tracking-tightest">
            Detailed analysis
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Full analyst report — evidence, tactics, projections — settled on
            demand for{" "}
            <span className="font-mono text-goldbright">{price}</span> via x402.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
            <Lock className="h-3.5 w-3.5" /> Signed by your wallet · on-chain
            receipt
          </p>
        </div>
        <TierCard
          eyebrow="USDC · Injective EVM"
          title="Top up in seconds"
          body="Pay with native, CCTP-enabled USDC. Bridge in what you need."
          action={
            <a href={bridgeUrl} target="_blank" rel="noreferrer">
              <ShimmerButton variant="ghost" className="mt-1 py-2">
                Top up USDC <ArrowUpRight className="h-4 w-4" />
              </ShimmerButton>
            </a>
          }
        />
      </section>

      {/* ---------- Chat console ---------- */}
      <section
        id="chat"
        ref={chatRef}
        className="mx-auto max-w-7xl scroll-mt-20 px-5 py-10"
      >
        <div className="overflow-hidden rounded-xl border border-line bg-carbon">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              <LiveDot />
              <span className="font-display text-sm tracking-widest">
                Match console
              </span>
            </div>
            <div className="flex items-center rounded-md border border-line bg-ink p-1 text-sm">
              {(["free", "premium"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={`relative rounded px-3 py-1.5 capitalize transition-colors ${
                    tier === t
                      ? "bg-gold text-ink"
                      : "text-muted hover:text-bone"
                  }`}
                >
                  {t}
                  {t === "premium" && (
                    <span className="ml-1.5 font-mono text-[10px] opacity-80">
                      {price}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div ref={logRef} className="h-[420px] overflow-y-auto px-5 py-6">
            {messages.length === 0 ? (
              <EmptyState samples={SAMPLES} onPick={(s) => setInput(s)} />
            ) : (
              <div className="flex flex-col gap-5">
                {messages.map((m, i) => (
                  <Bubble key={i} m={m} />
                ))}
                {busy && (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-gold" />
                    {tier === "premium"
                      ? "Settling payment and running deep analysis…"
                      : "Reading the game…"}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-line px-5 py-4">
            {notice && (
              <p className="mb-3 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-goldbright">
                {notice}
              </p>
            )}
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask about a match, a player, or a matchup…"
                className="max-h-40 min-h-[46px] flex-1 resize-none rounded-md border border-line bg-ink px-4 py-3 text-sm text-bone placeholder:text-muted focus:border-gold/60 focus:outline-none"
              />
              <ShimmerButton onClick={() => send()} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </ShimmerButton>
            </div>
            <p className="mt-2 text-xs text-muted">
              {tier === "premium"
                ? wallet
                  ? `Premium · ${price} will be signed by ${shortAddress(wallet.address)} on send.`
                  : "Premium selected · connect a wallet to sign the payment."
                : "Free tier · press Enter to send, Shift+Enter for a new line."}
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="mx-auto max-w-7xl px-5 py-10 text-xs text-muted">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
          <span>
            Echo Agent · built for the Injective Global Cup · MCP + x402 + USDC
          </span>
          <span className="font-mono">Injective EVM · chain 1776</span>
        </div>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Presentational pieces
 * ------------------------------------------------------------------ */

function RailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-carbon">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-display text-sm tracking-widest text-bone">
          {title}
        </h2>
      </div>
      <div className="px-2 py-1">{children}</div>
    </div>
  );
}

function RailFooter({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center justify-between px-4 py-3 text-xs font-semibold tracking-wide text-gold transition-colors hover:text-goldbright"
    >
      {label}
      <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </button>
  );
}

function ScoreRow({ r, onClick }: { r: BoardResult; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-panel"
    >
      <span className="w-14 shrink-0 font-mono text-[10px] uppercase text-muted">
        {r.stage.replace("Group ", "Grp ")}
      </span>
      <span className="flex-1 truncate text-sm">{r.home}</span>
      <span className="rounded bg-ink px-2 py-0.5 font-mono text-sm tabular text-goldbright">
        {r.homeGoals}–{r.awayGoals}
      </span>
      <span className="flex-1 truncate text-right text-sm">{r.away}</span>
    </button>
  );
}

function ScorerRow({ s, onClick }: { s: BoardScorer; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-panel"
    >
      <span className="grid h-5 w-5 place-items-center rounded-sm bg-ink font-mono text-[11px] text-gold">
        {s.rank}
      </span>
      <span className="flex-1 truncate text-sm">{s.name}</span>
      <span className="truncate text-xs text-muted">{s.country}</span>
      <span className="font-mono text-sm tabular text-goldbright">
        {s.goals}
      </span>
    </button>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="h-3 w-full animate-pulse rounded bg-panel" />
        </div>
      ))}
    </>
  );
}

function TierCard({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-carbon p-6">
      <p className="font-display text-xs tracking-widest text-muted">
        {eyebrow}
      </p>
      <h3 className="mt-1 font-display text-2xl tracking-tightest">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  );
}

function EmptyState({
  samples,
  onPick,
}: {
  samples: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-4 animate-fadeUp">
      <p className="font-display text-2xl tracking-tightest text-bone">
        What do you want to know?
      </p>
      <p className="max-w-md text-sm text-muted">
        Try one of these, or ask your own. Switch to{" "}
        <span className="text-goldbright">Premium</span> for a full analyst
        breakdown.
      </p>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {samples.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group flex items-center justify-between gap-2 rounded-md border border-line bg-ink px-4 py-3 text-left text-sm text-bone transition-colors hover:border-gold/50"
          >
            {s}
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-gold" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fadeUp`}
    >
      <div
        className={`max-w-[85%] rounded-xl border px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "border-gold/30 bg-gold/10 text-bone"
            : "border-line bg-panel text-bone"
        }`}
      >
        {!isUser && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-sm bg-gold font-display text-[10px] text-ink">
              EA
            </span>
            <span className="font-display text-[11px] tracking-widest text-muted">
              Echo Agent
            </span>
            {m.tier === "premium" && (
              <span className="rounded-full border border-gold/40 px-2 py-0.5 font-mono text-[10px] text-goldbright">
                premium
              </span>
            )}
          </div>
        )}
        <div className="whitespace-pre-wrap">{m.content}</div>
        {m.receipt && (
          <p className="mt-2 truncate font-mono text-[10px] text-muted">
            receipt · {m.receipt.slice(0, 28)}…
          </p>
        )}
      </div>
    </div>
  );
}
