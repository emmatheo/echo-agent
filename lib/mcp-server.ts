/**
 * lib/mcp-server.ts
 * ------------------------------------------------------------------
 * Standalone MCP server for Echo Agent.
 *
 * This makes the "brain" genuinely MCP-native and portable: the exact
 * same football workflows the web agent uses are exposed over the Model
 * Context Protocol so ANY MCP client (Claude Desktop, another agent,
 * an x402 buyer, ...) can consume them.
 *
 *   Tools:     search_matches, get_match, get_player, scout_team,
 *              compare_players, what_if_context
 *   Resource:  echo://skill/football-agent  (the Agent Skill markdown)
 *
 * Run it over stdio:
 *     npx tsx lib/mcp-server.ts
 *
 * Register it with Claude Desktop (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "echo-agent-football": {
 *         "command": "npx",
 *         "args": ["tsx", "/absolute/path/echo-agent/lib/mcp-server.ts"]
 *       }
 *     }
 *   }
 * ------------------------------------------------------------------
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOOTBALL_TOOLS, runFootballTool } from "./football-tools";

const SKILL_URI = "echo://skill/football-agent";

const server = new Server(
  { name: "echo-agent-football", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

/* ---- Tools -------------------------------------------------------- */

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: FOOTBALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = runFootballTool(req.params.name, req.params.arguments ?? {});
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

/* ---- Resource: the Agent Skill ------------------------------------ */

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: SKILL_URI,
      name: "Football Agent Skill",
      description: "Workflows, output contracts and guardrails for football analysis.",
      mimeType: "text/markdown",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri !== SKILL_URI) {
    throw new Error(`Unknown resource: ${req.params.uri}`);
  }
  const text = readFileSync(
    join(process.cwd(), "skills", "football-agent.md"),
    "utf-8",
  );
  return { contents: [{ uri: SKILL_URI, mimeType: "text/markdown", text }] };
});

/* ---- Boot --------------------------------------------------------- */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so we never corrupt the stdio protocol stream on stdout.
  console.error("[echo-agent] MCP server ready on stdio");
}

main().catch((err) => {
  console.error("[echo-agent] MCP server fatal:", err);
  process.exit(1);
});
