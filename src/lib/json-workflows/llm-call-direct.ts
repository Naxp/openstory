/**
 * Direct LLM Call
 *
 * Thin wrapper around the existing LLM infrastructure for use in JSON workflows.
 * Unlike durableLLMCall (which needs a WorkflowContext), this executes directly
 * since the JSON workflow executor handles durability at the step level.
 */

import { createAdapter } from '@/lib/ai/create-adapter';
import {
  DEFAULT_ANALYSIS_MODEL,
  getAnalysisModelById,
  getContextWindow,
} from '@/lib/ai/models.config';
import type { ScopedDb } from '@/lib/db/scoped';
import { type ChatMessage, getChatPrompt } from '@/lib/prompts';
import { chat } from '@tanstack/ai';
import type { z } from 'zod';

type DirectLLMCallParams = {
  prompt: string;
  variables: Record<string, string>;
  modelId?: string;
  responseSchema?: z.ZodType;
  scopedDb: ScopedDb;
  sequenceId?: string;
};

/**
 * Check if prompt is a Langfuse key (contains "/" like "phase/scene-splitting-chat")
 * or an inline prompt string.
 */
function isPromptKey(prompt: string): boolean {
  return prompt.includes('/') && !prompt.includes(' ');
}

export async function durableLLMCallDirect(
  params: DirectLLMCallParams
): Promise<unknown> {
  const { prompt, variables, modelId, responseSchema, scopedDb, sequenceId } =
    params;

  const resolvedId = modelId ?? DEFAULT_ANALYSIS_MODEL;
  const model = getAnalysisModelById(resolvedId)?.id ?? DEFAULT_ANALYSIS_MODEL;

  // Resolve API key
  const openRouterApiKeyInfo = await scopedDb.apiKeys.resolveKey('openrouter');

  let messages: ChatMessage[];

  if (isPromptKey(prompt)) {
    // Langfuse prompt key — fetch template and compile with variables
    const result = await getChatPrompt(prompt, variables);
    messages = result.messages;
  } else {
    // Inline prompt — use as user message with variables interpolated
    let content = prompt;
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
    messages = [{ role: 'user', content }];
  }

  const adapter = createAdapter(model, openRouterApiKeyInfo.key);

  const systemPrompts: string[] = [];
  const chatMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }> = [];

  for (const msg of messages) {
    if (typeof msg.content !== 'string') {
      throw new Error(
        `JSON workflow LLM steps require text-only prompts; got multimodal content for role "${msg.role}"`
      );
    }
    if (msg.role === 'system') {
      systemPrompts.push(msg.content);
    } else {
      chatMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 300_000);

  try {
    const result = await chat({
      adapter,
      messages: chatMessages,
      systemPrompts,
      stream: false,
      maxTokens: Math.floor(getContextWindow(model) * 0.5),
      abortController,
      metadata: {
        observationName: 'json-workflow-llm',
        sessionId: sequenceId,
      },
      ...(responseSchema ? { outputSchema: responseSchema } : {}),
    });

    return responseSchema ? responseSchema.parse(result) : result;
  } finally {
    clearTimeout(timeout);
  }
}
