// Single source of truth for "are we recording fixtures or replaying them?".
// Both aimock-server.ts (openrouter) and fal-handler.ts gate on E2E_RECORDING,
// and `t()` scales per-action Playwright timeouts so live LLM streaming + fal
// queue calls don't trip waits sized for replay-only latency.

export const E2E_RECORDING = process.env.E2E_RECORD === '1';

const RECORDING_TIMEOUT_MULTIPLIER = 10;

export const t = (ms: number): number =>
  E2E_RECORDING ? ms * RECORDING_TIMEOUT_MULTIPLIER : ms;
