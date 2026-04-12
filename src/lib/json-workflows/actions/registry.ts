/**
 * Action Registry
 *
 * Central registry mapping action names to their definitions.
 * Actions are looked up by name during workflow execution.
 */

import type { ActionDefinition } from './types';
import { dataActions } from './data-actions';
import { generationActions } from './generation-actions';
import { utilityActions } from './utility-actions';

const allActions: ActionDefinition[] = [
  ...dataActions,
  ...generationActions,
  ...utilityActions,
];

const registry = new Map<string, ActionDefinition>(
  allActions.map((action) => [action.name, action])
);

export function getAction(name: string): ActionDefinition | undefined {
  return registry.get(name);
}

export function getActionNames(): string[] {
  return Array.from(registry.keys());
}

export function getActionDefinitions(): ActionDefinition[] {
  return Array.from(registry.values());
}
