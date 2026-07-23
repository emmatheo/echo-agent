/**
 * lib/football-tools.ts
 * ------------------------------------------------------------------
 * The football "knowledge" layer. This is the set of structured
 * workflows the agent's brain can call. It is deliberately isolated
 * from Claude and from HTTP so it can be reused by:
 *   - lib/agent.ts        (Claude tool-use)
 *   - lib/mcp-server.ts   (standalone MCP server for other agents)
 *
 * Data is loaded once from /data/*.json at module init.
 * ------------------------------------------------------------------
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Match, Player } from "../types";

/* ------------------------------------------------------------------ *
 * Data loading (server-side only)
 * ------------------------------------------------------------------ */

const DATA_DIR = join(process.cwd(), "data");

function loadJson<T>(file: string): T {
  const raw = readFileSync(join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw) as T;
}

// `_meta` may be present in the files; strip it out of the arrays.
interface MatchesFile {
  _meta?: unknown;
  matches: Match[];
}
interface PlayersFile {
  _meta?: unknown;
  players: Player[];
}

const MATCHES: Match[] = loadJson<MatchesFile>(
  "worldcup-2026-matches.json",
).matches;
const PLAYERS: Player[] = loadJson<PlayersFile>("players.json").players;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const norm = (s: string) => s.trim().toLowerCase();

function matchInvolves(m: Match, team: string): boolean {
  const t = norm(team);
  return norm(m.home.team).includes(t) || norm(m.away.team).includes(t);
}

/* ------------------------------------------------------------------ *
 * Tool implementations
 * Each returns plain JSON-serialisable data. Reasoning stays with the
 * model; these tools only retrieve and shape ground-truth data.
 * ------------------------------------------------------------------ */

export function searchMatches(args: {
  team?: string;
  stage?: string;
  date?: string;
  limit?: number;
}) {
  let results = MATCHES.slice();
  if (args.team) results = results.filter((m) => matchInvolves(m, args.team!));
  if (args.stage)
    results = results.filter((m) => norm(m.stage).includes(norm(args.stage!)));
  if (args.date)
    results = results.filter((m) => m.date.startsWith(args.date!.trim()));

  const limit = Math.min(args.limit ?? 10, 25);
  return results.slice(0, limit).map((m) => ({
    id: m.id,
    stage: m.stage,
    date: m.date,
    fixture: `${m.home.team} ${m.home.goals}-${m.away.goals} ${m.away.team}`,
    venue: `${m.venue}, ${m.city}`,
    status: m.status,
    summary: m.summary,
  }));
}

export function getMatch(args: { matchId: string }) {
  const m = MATCHES.find((x) => norm(x.id) === norm(args.matchId));
  if (!m) return { error: `No match found with id "${args.matchId}".` };
  return m;
}

export function getPlayer(args: { query: string }) {
  const q = norm(args.query);
  const p =
    PLAYERS.find((x) => norm(x.id) === q) ??
    PLAYERS.find((x) => norm(x.name) === q) ??
    PLAYERS.find((x) => norm(x.name).includes(q));
  if (!p) return { error: `No player found matching "${args.query}".` };
  return p;
}

export function scoutTeam(args: { team: string }) {
  const t = norm(args.team);
  const squad = PLAYERS.filter((p) => norm(p.country).includes(t));
  if (squad.length === 0)
    return { error: `No players found for team "${args.team}".` };

  const teamMatches = MATCHES.filter((m) => matchInvolves(m, args.team));
  const goalsFor = teamMatches.reduce((acc, m) => {
    return (
      acc +
      (norm(m.home.team).includes(t) ? m.home.goals : m.away.goals)
    );
  }, 0);

  return {
    team: args.team,
    playersInDataset: squad.length,
    keyPlayers: squad
      .slice()
      .sort((a, b) => b.worldCup2026.rating - a.worldCup2026.rating)
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        position: p.position,
        club: p.club,
        rating: p.worldCup2026.rating,
        goals: p.worldCup2026.goals,
        assists: p.worldCup2026.assists,
        traits: p.traits,
      })),
    tournamentForm: {
      matchesInDataset: teamMatches.length,
      goalsFor,
      recentResults: teamMatches
        .slice(-5)
        .map(
          (m) => `${m.home.team} ${m.home.goals}-${m.away.goals} ${m.away.team}`,
        ),
    },
  };
}

export function comparePlayers(args: { playerA: string; playerB: string }) {
  const a = getPlayer({ query: args.playerA });
  const b = getPlayer({ query: args.playerB });
  return { playerA: a, playerB: b };
}

/**
 * what_if is a retrieval helper: it gathers the ground-truth context a
 * scenario needs (the match and/or the players named). Claude then reasons
 * over that context. This keeps speculation grounded in real data.
 */
export function whatIfContext(args: {
  matchId?: string;
  teams?: string[];
  players?: string[];
}) {
  return {
    match: args.matchId ? getMatch({ matchId: args.matchId }) : undefined,
    teams: (args.teams ?? []).map((t) => scoutTeam({ team: t })),
    players: (args.players ?? []).map((p) => getPlayer({ query: p })),
    note: "Use this factual context to reason about the hypothetical. Be explicit that any projection is speculative.",
  };
}

/* ------------------------------------------------------------------ *
 * Tool catalogue (Anthropic tool-use schema).
 * The same catalogue is exposed over MCP by lib/mcp-server.ts.
 * ------------------------------------------------------------------ */

export const FOOTBALL_TOOLS = [
  {
    name: "search_matches",
    description:
      "Search 2026 World Cup matches by team, stage (e.g. 'Group A', 'Final'), and/or date (YYYY-MM-DD). Returns concise fixtures with scores and summaries.",
    input_schema: {
      type: "object" as const,
      properties: {
        team: { type: "string", description: "Team/country name (partial ok)." },
        stage: { type: "string", description: "Tournament stage." },
        date: { type: "string", description: "Date prefix, e.g. 2026-06-15." },
        limit: { type: "number", description: "Max results (default 10)." },
      },
    },
  },
  {
    name: "get_match",
    description:
      "Get the full detail for one match by id: stats (xG, possession, shots), lineups/formations, and the timeline of events.",
    input_schema: {
      type: "object" as const,
      properties: { matchId: { type: "string" } },
      required: ["matchId"],
    },
  },
  {
    name: "get_player",
    description:
      "Look up a single player by name or id: profile, club, position, market value, and 2026 World Cup stats.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Player name or id." } },
      required: ["query"],
    },
  },
  {
    name: "scout_team",
    description:
      "Scouting report for a national team: key players (by rating), tournament form and recent results from the dataset.",
    input_schema: {
      type: "object" as const,
      properties: { team: { type: "string" } },
      required: ["team"],
    },
  },
  {
    name: "compare_players",
    description: "Side-by-side comparison of two players' profiles and stats.",
    input_schema: {
      type: "object" as const,
      properties: {
        playerA: { type: "string" },
        playerB: { type: "string" },
      },
      required: ["playerA", "playerB"],
    },
  },
  {
    name: "what_if_context",
    description:
      "Gather factual context (a match and/or named teams and players) to ground a hypothetical 'what-if' scenario before reasoning about it.",
    input_schema: {
      type: "object" as const,
      properties: {
        matchId: { type: "string" },
        teams: { type: "array", items: { type: "string" } },
        players: { type: "array", items: { type: "string" } },
      },
    },
  },
] as const;

export type FootballToolName = (typeof FOOTBALL_TOOLS)[number]["name"];

/** Dispatch a tool call by name. Never throws — returns an error object. */
export function runFootballTool(name: string, input: unknown): unknown {
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "search_matches":
        return searchMatches(
          args as {
            team?: string;
            stage?: string;
            date?: string;
            limit?: number;
          },
        );
      case "get_match":
        return getMatch(args as { matchId: string });
      case "get_player":
        return getPlayer(args as { query: string });
      case "scout_team":
        return scoutTeam(args as { team: string });
      case "compare_players":
        return comparePlayers(args as { playerA: string; playerB: string });
      case "what_if_context":
        return whatIfContext(
          args as { matchId?: string; teams?: string[]; players?: string[] },
        );
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: `Tool "${name}" failed: ${(err as Error).message}` };
  }
}

/** Small stats surface for health checks / the GET route. */
export function datasetStats() {
  return { matches: MATCHES.length, players: PLAYERS.length };
}

/* ------------------------------------------------------------------ *
 * Landing-page board data (used by GET /api/analyze -> right rail).
 * Read-only, cheap, no model call.
 * ------------------------------------------------------------------ */

export function recentResults(limit = 5) {
  return MATCHES.filter((m) => m.status === "completed")
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      stage: m.stage,
      date: m.date,
      home: m.home.team,
      homeGoals: m.home.goals,
      away: m.away.team,
      awayGoals: m.away.goals,
    }));
}

export function topScorers(limit = 5) {
  return PLAYERS.slice()
    .sort((a, b) => b.worldCup2026.goals - a.worldCup2026.goals)
    .slice(0, limit)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      country: p.country,
      club: p.club,
      goals: p.worldCup2026.goals,
      assists: p.worldCup2026.assists,
    }));
}
