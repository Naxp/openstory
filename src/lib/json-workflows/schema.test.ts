import { describe, expect, test } from 'bun:test';
import { workflowDefinitionSchema } from './schema';

describe('workflowDefinitionSchema', () => {
  test('validates a minimal manual workflow', () => {
    const def = {
      version: 1,
      name: 'Test Workflow',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [
        {
          id: 'step-1',
          type: 'action',
          action: 'get-sequence',
          inputs: { sequenceId: '{{context.sequenceId}}' },
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('validates an event-triggered workflow', () => {
    const def = {
      version: 1,
      name: 'Auto Motion',
      trigger: {
        type: 'event',
        event: 'generation.image:completed',
        filter: { status: 'completed' },
      },
      steps: [
        {
          id: 'get-frame',
          type: 'action',
          action: 'get-frame',
          inputs: { frameId: '{{trigger.frameId}}' },
        },
        {
          id: 'gen-motion',
          type: 'action',
          action: 'generate-motion',
          inputs: {
            imageUrl: '{{steps.get-frame.thumbnailUrl}}',
            prompt: '{{steps.get-frame.metadata.prompts.motion.fullPrompt}}',
          },
          dependsOn: ['get-frame'],
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('validates LLM steps', () => {
    const def = {
      version: 1,
      name: 'LLM Workflow',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [
        {
          id: 'analyze',
          type: 'llm',
          prompt: 'phase/scene-splitting-chat',
          variables: { script: '{{trigger.script}}' },
          model: 'anthropic/claude-haiku-4.5',
          outputSchema: 'scene-splitting',
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('validates conditional steps', () => {
    const def = {
      version: 1,
      name: 'Conditional Workflow',
      trigger: { type: 'manual', scope: 'frame' },
      steps: [
        {
          id: 'check',
          type: 'conditional',
          condition: '{{trigger.autoGenerate}} == true',
          then: [
            {
              id: 'gen',
              type: 'action',
              action: 'generate-image',
              inputs: { prompt: 'test' },
            },
          ],
          else: [
            {
              id: 'log-skip',
              type: 'action',
              action: 'log',
              inputs: { message: 'Skipped generation' },
            },
          ],
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('validates for-each steps', () => {
    const def = {
      version: 1,
      name: 'Batch Workflow',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [
        {
          id: 'list',
          type: 'action',
          action: 'list-frames',
          inputs: { sequenceId: '{{context.sequenceId}}' },
        },
        {
          id: 'loop',
          type: 'for-each',
          collection: '{{steps.list.frames}}',
          itemVariable: 'frame',
          steps: [
            {
              id: 'gen',
              type: 'action',
              action: 'generate-image',
              inputs: { frameId: '{{item.frame.id}}', prompt: 'test' },
            },
          ],
          maxConcurrency: 3,
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('validates parallel steps', () => {
    const def = {
      version: 1,
      name: 'Parallel Workflow',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [
        {
          id: 'parallel-gen',
          type: 'parallel',
          branches: [
            [
              {
                id: 'a',
                type: 'action',
                action: 'log',
                inputs: { message: 'branch A' },
              },
            ],
            [
              {
                id: 'b',
                type: 'action',
                action: 'log',
                inputs: { message: 'branch B' },
              },
            ],
          ],
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('validates workflow with inputs', () => {
    const def = {
      version: 1,
      name: 'With Inputs',
      trigger: { type: 'manual', scope: 'sequence' },
      inputs: {
        model: {
          type: 'string',
          required: true,
          description: 'AI model to use',
        },
        count: { type: 'number', default: 5 },
      },
      steps: [
        {
          id: 's1',
          type: 'action',
          action: 'log',
          inputs: { message: '{{inputs.model}}' },
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  test('rejects empty steps array', () => {
    const def = {
      version: 1,
      name: 'Empty',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
  });

  test('rejects wrong version', () => {
    const def = {
      version: 2,
      name: 'Bad Version',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [{ id: 's', type: 'action', action: 'log', inputs: {} }],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
  });

  test('rejects missing step id', () => {
    const def = {
      version: 1,
      name: 'No ID',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [{ type: 'action', action: 'log', inputs: {} }],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
  });

  test('rejects parallel with fewer than 2 branches', () => {
    const def = {
      version: 1,
      name: 'Bad Parallel',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [
        {
          id: 'p',
          type: 'parallel',
          branches: [
            [
              {
                id: 'a',
                type: 'action',
                action: 'log',
                inputs: { message: 'only one' },
              },
            ],
          ],
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
  });

  test('validates deeply nested control flow', () => {
    const def = {
      version: 1,
      name: 'Nested',
      trigger: { type: 'manual', scope: 'sequence' },
      steps: [
        {
          id: 'outer-loop',
          type: 'for-each',
          collection: '{{trigger.scenes}}',
          itemVariable: 'scene',
          steps: [
            {
              id: 'inner-cond',
              type: 'conditional',
              condition: '{{item.scene.hasThumbnail}} == false',
              then: [
                {
                  id: 'inner-parallel',
                  type: 'parallel',
                  branches: [
                    [
                      {
                        id: 'gen-img',
                        type: 'action',
                        action: 'generate-image',
                        inputs: { prompt: 'test' },
                      },
                    ],
                    [
                      {
                        id: 'gen-llm',
                        type: 'llm',
                        prompt: 'Describe this scene',
                        variables: {},
                      },
                    ],
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = workflowDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });
});
