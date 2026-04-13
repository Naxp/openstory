/**
 * Langfuse Observability Integration
 * OpenTelemetry-based tracing for LLM and media generation
 */

import { getEnv } from '#env';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { PostHogTraceExporter } from '@posthog/ai/otel';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';

let processor: LangfuseSpanProcessor | null = null;
let posthogProcessor: BatchSpanProcessor | null = null;
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
  const spanProcessors: SpanProcessor[] = [];

  // Langfuse
  const langfusePublicKey = env.LANGFUSE_PUBLIC_KEY;
  const langfuseSecretKey = env.LANGFUSE_SECRET_KEY;

  if (langfusePublicKey && langfuseSecretKey) {
    processor = new LangfuseSpanProcessor({
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      baseUrl: env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    });
    spanProcessors.push(processor);
    console.log('[Tracing] Langfuse enabled');
  }

  // PostHog LLM observability
  const posthogToken = env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (posthogToken) {
    const host = env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
    posthogProcessor = new BatchSpanProcessor(
      new PostHogTraceExporter({ apiKey: posthogToken, host })
    );
    spanProcessors.push(posthogProcessor);
    console.log('[Tracing] PostHog LLM observability enabled');
  }

  if (spanProcessors.length === 0) {
    console.log('[Tracing] Disabled - no providers configured');
    return;
  }

  sdk = new NodeSDK({ spanProcessors });
  sdk.start();
  console.log(
    '[Tracing] Initialized with %d provider(s)',
    spanProcessors.length
  );
}

/**
 * Flush all pending traces to Langfuse.
 * Call at the end of request handling in serverless environments.
 */
export async function flushTracing(): Promise<void> {
  const flushes: Promise<void>[] = [];
  if (processor) flushes.push(processor.forceFlush());
  if (posthogProcessor) flushes.push(posthogProcessor.forceFlush());
  await Promise.all(flushes);
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
