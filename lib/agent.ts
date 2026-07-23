/**
 * lib/agent.ts
 * ------------------------------------------------------------------
 * The agent's brain: an OpenAI-compatible chat model + the football
 * Agent Skill + the football tools (structured workflows).
 *
 *  - Loads skills/football-agent.md as the Agent Skill (system prompt).
 *  - Registers the football tools from lib/football-tools.ts.
 *  - Runs a tool-use loop until the model produces a final answer.
 *  - Free vs Premium changes model, tool budget, and output contract.
 *
 * Talks to any OpenAI-compatible /chat/completions endpoint via fetch
 * (no SDK dependency). Defaults to Google's Gemini free tier; Groq,
 * OpenRouter, and Mistral work by overriding LLM_BASE_URL + models.
 *
 * The SAME tools are also exposed over MCP (lib/mcp-server.ts), so the
 * "brain" is portable: another agent or Claude Desktop can consume it.
 * ------------------------------------------------------------------
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResult, Tier, ToolCallTrace } from "../types";
import { FOOTBALL_TOOLS, runFootballTool } from "./football-tools";

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

// Any OpenAI-compatible endpoint. Default: Gemini's free-tier compat layer.
//   Gemini:     https://generativelanguage.googleapis.com/v1beta/openai
//   Groq:       https://api.groq.com/openai/v1
//   OpenRouter: https://openrouter.ai/api/v1
//   Mistral:    https://api.mistral.ai/v1
const LLM_BASE_URL = (
  process.env.LLM_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai"
).replace(/\/$/, "");

// Read at request time (not module top level) so `next build` never needs it.
function getApiKey(): string {
  const key = process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing LLM_API_KEY (or GEMINI_API_KEY) env var.");
  }
  return key;
}

// Free tier: fast + generous free quota. Premium: strongest reasoning.
const FREE_MODEL = process.env.FREE_MODEL ?? "gemini-2.5-flash";
const PREMIUM_MODEL = process.env.PREMIUM_MODEL ?? "gemini-2.5-pro";

// Tool-use loop safety limits.
const FREE_MAX_TOOLS = 2;
const PREMIUM_MAX_TOOLS = 8;
const MAX_TURNS = 12; // hard ceiling on model<->tool round-trips

// Load the Agent Skill once. This is the football "knowledge + workflows".
const SKILL = readFileSync(
  join(process.cwd(), "skills", "football-agent.md"),
  "utf-8",
);

/* ------------------------------------------------------------------ *
 * Minimal OpenAI-compatible wire types (only what we use)
 * ------------------------------------------------------------------ */

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

interface WireCompletion {
  choices: {
    message: WireMessage;
    finish_reason: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// FOOTBALL_TOOLS uses the { name, description, input_schema } shape; the
// OpenAI wire format nests the same JSON schema under function.parameters.
const WIRE_TOOLS = FOOTBALL_TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema as unknown as Record<string, unknown>,
  },
}));

async function chatCompletion(body: Record<string, unknown>): Promise<WireCompletion> {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${detail}`.trim());
  }
  return (await res.json()) as WireCompletion;
}

/* ------------------------------------------------------------------ *
 * Prompt assembly
 * ------------------------------------------------------------------ */

function buildSystemPrompt(tier: Tier): string {
  const tierBlock =
    tier === "premium"
      ? `## Active tier: PREMIUM (payment settled via x402)
The user has paid 0.02 USDC for a DETAILED analysis. Deliver the full
premium contract from the skill: use multiple tools to gather evidence,
include the numbers (xG, possession, ratings, market value), give tactical
depth, projections/what-ifs where relevant, and a clear structured answer.`
      : `## Active tier: FREE
Give a solid but CONCISE answer (a short paragraph, a few key facts). Use at
most one tool. Do NOT produce the full premium breakdown. If the user would
clearly benefit from deep tactical analysis, projections, or multi-match
evidence, end with ONE short line noting that a detailed premium analysis
(0.02 USDC via x402) is available — no hard sell.`;

  return `${SKILL}\n\n---\n\n${tierBlock}`;
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

export async function runAgent(params: {
  query: string;
  tier: Tier;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<AgentResult> {
  const { query, tier } = params;
  const model = tier === "premium" ? PREMIUM_MODEL : FREE_MODEL;
  const maxTools = tier === "premium" ? PREMIUM_MAX_TOOLS : FREE_MAX_TOOLS;
  const maxTokens = tier === "premium" ? 2000 : 700;

  const toolTrace: ToolCallTrace[] = [];

  // Seed the conversation: system prompt + any prior history + the query.
  const messages: WireMessage[] = [
    { role: "system", content: buildSystemPrompt(tier) },
    ...(params.history ?? []).map(
      (h): WireMessage => ({ role: h.role, content: h.content }),
    ),
    { role: "user", content: query },
  ];

  let finalText = "";
  let lastUsage: AgentResult["usage"];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Once the tool budget is spent, stop offering tools so the model wraps up.
    const toolsExhausted = toolTrace.length >= maxTools;

    const response = await chatCompletion({
      model,
      max_tokens: maxTokens,
      messages,
      ...(toolsExhausted ? {} : { tools: WIRE_TOOLS }),
    });

    if (response.usage) {
      lastUsage = {
        input_tokens: response.usage.prompt_tokens ?? 0,
        output_tokens: response.usage.completion_tokens ?? 0,
      };
    }

    const msg = response.choices[0]?.message;
    if (!msg) break;

    if (msg.content) finalText = msg.content.trim();

    // If the model didn't ask for tools, we're done.
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) break;

    // Execute every requested tool and feed results back.
    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      toolTrace.push({ name: tc.function.name, input });
      const result = runFootballTool(tc.function.name, input);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!finalText) {
    finalText =
      "I couldn't complete the analysis this time. Please rephrase your question.";
  }

  return {
    tier,
    answer: finalText,
    toolCalls: toolTrace,
    model,
    usage: lastUsage,
  };
}
