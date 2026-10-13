/**
 * Model tier → model id. The ONLY place model ids appear (CLAUDE.md §7.4).
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
