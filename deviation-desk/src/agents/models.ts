/**
 * Model tier → model id, effort and price. The ONLY place model ids appear (CLAUDE.md §7.4).
 * Override per environment with MODEL_FAST / MODEL_STANDARD / MODEL_DEEP.
 * Check current ids at https://platform.claude.com/docs/en/about-claude/models/overview
 */
import type { ModelTier } from "./contract";

const DEFAULTS: Record<ModelTier, string> = {
  fast: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
};

export function modelFor(tier: ModelTier): string {
  const fromEnv = {
    fast: process.env.MODEL_FAST,
    standard: process.env.MODEL_STANDARD,
    deep: process.env.MODEL_DEEP,
  }[tier];
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULTS[tier];
}

export type Effort = "low" | "medium" | "high";

// Set explicitly: Opus 5.5 and Haiku 5.5 default to medium, Sonnet 5.5 to high.
const EFFORT: Record<ModelTier, Effort> = {
  fast: "low",
  standard: "medium",
  deep: "high",
};

export function effortFor(tier: ModelTier): Effort {
  return EFFORT[tier];
}

// Server-side refusal fallback (`fallbacks: "default"`) exists for these models only; Haiku has none.
const SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function supportsServerFallback(model: string): boolean {
  return SERVER_FALLBACK.has(model);
}

/** USD per million tokens. Cache writes (5-minute TTL) cost 1.25 × input. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model];
  // Without a price the per-incident budget cannot be enforced, so refuse to guess.
  if (!price) throw new Error(`No price for model "${model}". Add it to PRICES in src/agents/models.ts.`);
  const perToken = (usd: number) => usd / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input * 1.25) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    usage.outputTokens * perToken(price.output)
  );
}
