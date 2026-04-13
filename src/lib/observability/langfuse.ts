/**
 * Langfuse Observability Integration
 * OpenTelemetry-based tracing for LLM and media generation
 */

import { getEnv } from '#env';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';

let processor: LangfuseSpanProcessor | null = null;
let sdk: NodeSDK | null = null;

/** Whether Langfuse is enabled — derived from both keys being set. */
export function isLangfuseEnabled(): boolean {
  const env = getEnv();
  return !!env.LANGFUSE_PUBLIC_KEY && !!env.LANGFUSE_SECRET_KEY;
}

/** Whether Langfuse prompt management is enabled (fetch prompts from Langfuse API). */
export function isLangfusePromptsEnabled(): boolean {
  const env = getEnv();
  return isLangfuseEnabled() && env.LANGFUSE_PROMPTS_ENABLED === 'true';
}

/**
 * Initialize Langfuse tracing.
 * Call once at module load before any traced operations.
 * Silently skips if credentials are not configured.
 */
export function initTracing(): void {
  const env = getEnv();
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.log('[Langfuse] Tracing disabled - credentials not configured');
    return;
  }

  processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  });

  sdk = new NodeSDK({
    spanProcessors: [processor],
  });

  sdk.start();
  console.log('[Langfuse] Tracing initialized');
}

/**
 * Flush all pending traces to Langfuse.
 * Call at the end of request handling in serverless environments.
 */
export async function flushTracing(): Promise<void> {
  if (processor) {
    await processor.forceFlush();
  }
}

/**
 * Record a completed workflow trace to Langfuse.
 * Call inside context.run() to ensure it only runs once (durable step).
 *
 * @param traceName - Name for the trace (e.g., 'analyzeScriptWorkflow')
 * @param input - Input data that was passed to the workflow
 * @param output - Output data produced by the workflow
 * @param sequenceId - Used as the Langfuse sessionId to group traces
 * @param userId - Optional user ID for user attribution
 * @param options - Optional model and durationMs for the trace
 */
export async function recordWorkflowTrace<TInput, TOutput>(
  traceName: string,
  input: TInput,
  output: TOutput,
  sequenceId: string,
  userId: string | undefined,
  model?: string,
  startTime?: Date
): Promise<void> {
  await propagateAttributes(
    {
      sessionId: sequenceId,
      ...(userId && { userId }),
      ...(model && {
        tags: model ? [`model:${model}`] : [],
        metadata: {
          ...(model && { model: model }),
        },
      }),
    },
    async () => {
      await startActiveObservation(
        traceName,
        async (generation) => {
          generation.update({
            input,
            output: typeof output === 'object' ? output : { result: output },
            ...(model && { model: model }),
            ...(startTime && { completionStartTime: startTime }),
          });
          // Note: Do NOT call .end() here - startActiveObservation ends automatically
        },
        { asType: 'generation', ...(startTime && { startTime }) }
      );
    }
  );
}

/**
 * Prompt reference for Langfuse trace linking.
 * Compatible with TextPromptClient and ChatPromptClient from @langfuse/client.
 * Must include at minimum: name, version, isFallback (additional properties allowed).
 */
export type PromptReference = {
  name: string;
  version: number;
  isFallback: boolean;
};
