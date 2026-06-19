# Multi-shot render — e2e fixture status (#910)

#910 flipped the scene-split LLM call from the old 1-shot
`sceneSplittingResultSchema` to `sceneWithShotsResultSchema` (each scene now
owns a `shots[]` array), and added a multi-shot RENDER path (Seedance prose /
Kling `multi_prompt`, writing `scenes.video*`). The recorded aimock fixtures
predate this, so the full-pipeline e2e needs attention.

## What was done in this PR (no real keys available)

`recorded/openrouter/script-analyze/script-analyze.json` was the only fixture
whose **shape** the schema flip breaks (the LLM response must now carry
`scenes[].shots[]`). It was transformed in place to the new shape as a faithful
**1-shot-per-scene** conversion (one shot derived from each existing scene's
own fields), and verified to `safeParse` against `sceneWithShotsResultSchema`.
This keeps the existing single-shot full-pipeline e2e green:

- `renderStrategy` stays NULL/`per-shot` for these single-shot scenes, so the
  render path is byte-for-byte today's per-shot path (the regression guard).
- Image/motion fixtures (fal `flux-2-turbo`, `nano-banana-2-edit`, motion
  models) are UNAFFECTED — they key on the per-shot visual/motion prompt, which
  is unchanged for a single shot.

## What still needs a real `E2E_RECORD=1` pass

To get **multi-shot** coverage (a scene with >1 shot rendered in ONE call on a
capable model), re-record with real keys:

```bash
OPENROUTER_KEY=… FAL_KEY=… E2E_RECORD=1 bun test:e2e:full
```

This must use a script that genuinely splits a scene into multiple shots (e.g. a
beat with an explicit "Cut to…" / sequential framings), and a capable video
model (`seedance_v2` or `kling_v3_pro`), so the recorder captures:

1. `recorded/openrouter/script-analyze/*` — a scene with a real multi-shot
   `shots[]` (not the synthesized 1-shot conversion).
2. `recorded/fal/<seedance|kling>/*` — the **multi-shot render request** shape:
   - Seedance: a single `prompt` weaving `Shot 1: … Shot 2: …` prose (no
     "Single continuous shot, no cuts." guard).
   - Kling: the `multi_prompt` array + `shot_type:'customize'` (+ `elements` /
     `end_image_url` advisory keyframes).
3. `recorded/openrouter/visual-prompts/*` and `motion-prompts/*` — now one entry
   PER SHOT (N images + N motion prompts for an N-shot scene).

Until that re-record lands, the e2e exercises the single-shot path only; the
multi-shot render layer is covered by unit tests
(`assemble-multishot-motion.test.ts`, `build-model-input.test.ts` multi-shot
branches, `motion-batch-jobs.test.ts` `groupShotsForRender`,
`resolve-playable-clips.test.ts`).
