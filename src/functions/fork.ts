/**
 * Server functions for the public fork-and-deploy page.
 */

import { getForkConfig } from '@/lib/fork/config';
import { createServerFn } from '@tanstack/react-start';

/** Whether the operator has configured the OAuth apps that power /fork. */
export const getForkEnabledFn = createServerFn({ method: 'GET' }).handler(
  () => {
    return { enabled: getForkConfig().enabled };
  }
);
