/**
 * Output Schema Registry
 *
 * Maps schema names (used in LLM step `outputSchema` field) to existing Zod schemas.
 * This allows JSON workflow definitions to reference response schemas by name
 * without embedding schema definitions in the JSON.
 */

import {
  characterExtractionResultSchema,
  locationExtractionResultSchema,
  locationMatchResponseSchema,
  motionPromptGenerationResultSchema,
  musicDesignResultSchema,
  sceneSplittingResultSchema,
  talentMatchResponseSchema,
  visualPromptGenerationResultSchema,
} from '@/lib/ai/response-schemas';
import type { z } from 'zod';

const registry = new Map<string, z.ZodType>([
  ['scene-splitting', sceneSplittingResultSchema],
  ['character-extraction', characterExtractionResultSchema],
  ['location-extraction', locationExtractionResultSchema],
  ['talent-matching', talentMatchResponseSchema],
  ['location-matching', locationMatchResponseSchema],
  ['visual-prompt', visualPromptGenerationResultSchema],
  ['motion-prompt', motionPromptGenerationResultSchema],
  ['music-design', musicDesignResultSchema],
]);

export function getOutputSchema(name: string): z.ZodType | undefined {
  return registry.get(name);
}

export function getSchemaNames(): string[] {
  return Array.from(registry.keys());
}
