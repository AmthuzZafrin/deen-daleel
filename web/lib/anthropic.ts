import Anthropic from "@anthropic-ai/sdk";

import { env } from "./env";

const globalForAnthropic = globalThis as unknown as {
  __deenAnthropic?: Anthropic;
};

export function anthropic(): Anthropic {
  if (!globalForAnthropic.__deenAnthropic) {
    globalForAnthropic.__deenAnthropic = new Anthropic({
      apiKey: env.anthropicApiKey,
    });
  }
  return globalForAnthropic.__deenAnthropic;
}

export const MODEL = "claude-opus-5";

/**
 * `max_tokens` bounds thinking *and* visible text together, and thinking is on
 * by default on Opus 5. A budget sized only to the prose truncates answers
 * mid-sentence once the model thinks for any length.
 */
export const MAX_TOKENS = 16_000;

/**
 * Start at `high` and sweep down against evals/ before lowering permanently.
 * This is the main latency and cost lever; on Opus 5 `medium` is often
 * indistinguishable on synthesis work like this.
 */
export const EFFORT = (process.env.DEEN_EFFORT ?? "high") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
