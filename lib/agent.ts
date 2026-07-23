/**
 * lib/agent.ts
 * ------------------------------------------------------------------
 * The agent's brain: Anthropic Claude + the football Agent Skill +
 * the football tools (structured workflows).
 *
 *  - Loads skills/football-agent.md as the Agent Skill (system prompt).
 *  - Registers the football tools from lib/football-tools.ts.
 *  - Runs a tool-use loop until Claude produces a final answer.
 *  - Free vs Premium changes model, tool budget, and output contract.
 *
 * The SAME tools are also exposed over MCP (lib/mcp-server.ts), so the
 * "brain" is portable: another agent or Claude Desktop can consume it.
 * ------------------------------------------------------------------
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResult, Tier, ToolCallTrace } from "../types";
import { FOOTBALL_TOOLS, runFootballTool } from "./football-tools";

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

// Construct the client lazily. Building at module top level would run the
// Anthropic constructor at import time (e.g. during `next build` page-data
// collection), which throws when ANTHROPIC_API_KEY is absent at build time.
// Deferring to first use keeps the module safe to import without the key.
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY, // required
    });
  }
  return _anthropic;
}

// Free tier: fast + cheap. Premium: strongest reasoning. Both overridable.
const FREE_MODEL = process.env.FREE_MODEL ?? "claude-sonnet-5";
const PREMIUM_MODEL = process.env.PREMIUM_MODEL ?? "claude-opus-4-8";

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

  const system = buildSystemPrompt(tier);
  const toolTrace: ToolCallTrace[] = [];

  // Seed the conversation with any prior chat history + the new query.
  const messages: Anthropic.MessageParam[] = [
    ...(params.history ?? []).map((h) => ({
      role: h.role,
      content: h.content,
    })),
    { role: "user" as const, content: query },
  ];

  let finalText = "";
  let lastUsage: AgentResult["usage"];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Once the tool budget is spent, stop offering tools so the model wraps up.
    const toolsExhausted = toolTrace.length >= maxTools;

    const response = await getAnthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(toolsExhausted
        ? {}
        : { tools: FOOTBALL_TOOLS as unknown as Anthropic.Tool[] }),
    });

    lastUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };

    // Collect any text the model emitted this turn.
    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    // If the model didn't ask for tools, we're done.
    if (response.stop_reason !== "tool_use") break;

    // Execute every requested tool and feed results back.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map(
      (tu) => {
        toolTrace.push({ name: tu.name, input: tu.input });
        const result = runFootballTool(tu.name, tu.input);
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        };
      },
    );

    messages.push({ role: "user", content: toolResults });
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
