/**
 * Element Vision Helper
 *
 * Describes an uploaded element image using a vision-capable LLM.
 * Bypasses the TanStack AI adapter (which wraps plain text chat) and
 * calls OpenRouter's chat/completions endpoint directly so we can pass
 * multimodal content.
 */

import { getEnv } from '#env';
import { z } from 'zod';

const VISION_MODEL = 'anthropic/claude-sonnet-4.6';

const responseSchema = z.object({
  description: z.string().min(1),
  consistencyTag: z.string().min(1),
});

export type ElementDescription = z.infer<typeof responseSchema>;

export type DescribeElementInput = {
  imageUrl: string;
  filename: string;
  token: string;
  /** Override OpenRouter API key (team-provided) */
  openRouterApiKey?: string;
};

/**
 * Build the multimodal user message for the vision LLM.
 * Exported for testing.
 */
export function buildVisionMessages(
  token: string,
  filename: string,
  imageUrl: string
): Array<{
  role: 'system' | 'user';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}> {
  const system = `You are a visual reference describer. You will be shown a single image that will serve as a canonical reference for an element (logo, product, screenshot, or similar object) in a film/video production. Your job is to describe what the image visually contains so that AI image generators can later reproduce the element faithfully across scenes.

Your output MUST be strict JSON with two fields:
- "description": 60-120 words. Describe shape, proportions, colors, text rendered on the element (verbatim), finish/material, any distinguishing marks, and how it is oriented. Do NOT describe background, lighting, camera angle, or the overall photograph — only the element itself.
- "consistencyTag": A lowercase slug (3-6 words joined by hyphens) capturing the element's visual identity for reuse in prompts (e.g. "red-hex-brand-logo", "silver-metal-water-bottle").

Return ONLY the JSON object. No prose, no markdown fences.`;

  const userText = `Element token: ${token}
Uploaded filename: ${filename}

Describe the element in the image below.`;

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];
}

const choiceSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }).optional(),
      })
    )
    .optional(),
});

function extractChoiceContent(json: unknown): string | undefined {
  const parsed = choiceSchema.safeParse(json);
  if (!parsed.success) return undefined;
  return parsed.data.choices?.[0]?.message?.content;
}

export async function describeElementImage(
  input: DescribeElementInput
): Promise<ElementDescription> {
  const env = getEnv();
  const apiKey = input.openRouterApiKey ?? env.OPENROUTER_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.VITE_APP_URL || 'http://localhost:3000',
      'X-Title': env.VITE_APP_NAME || 'OpenStory',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: buildVisionMessages(
        input.token,
        input.filename,
        input.imageUrl
      ),
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Element vision call failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`
    );
  }

  const json: unknown = await response.json();
  const content = extractChoiceContent(json);
  if (!content) {
    throw new Error('Element vision returned empty response');
  }

  const parsed = responseSchema.parse(JSON.parse(content));
  return parsed;
}
