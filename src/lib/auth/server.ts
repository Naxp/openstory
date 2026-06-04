/**
 * Server-side authentication utilities for BetterAuth
 * Provides session management for Server Actions and API routes
 */

import { createIsomorphicFn, createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { authClient } from './client';
import { getAuth } from './config';

/**
 * Get the current session from server context
 * Works in Server Actions, API routes, and Server Components
 */
export const getSessionFn = createIsomorphicFn()
  .server(async () => {
    const headers = getRequestHeaders();
    const sessionData = await getAuth().api.getSession({
      headers: headers,
    });
    return sessionData ?? null;
  })
  .client(async () => {
    const { data: sessionData, error } = await authClient.getSession();

    // A *failed* session lookup must not be conflated with "no session" —
    // returning null here would make every consumer treat a signed-in user
    // as anonymous (wrong data, bogus /login redirects) and hide the error.
    if (error) {
      throw new Error(
        `Failed to fetch session: ${error.message ?? error.statusText}`,
        { cause: error }
      );
    }

    return sessionData ?? null;
  });

/**
 * Get the current user from server context
 * Returns null if not authenticated
 */
export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const headers = getRequestHeaders();
    const session = await getAuth().api.getSession({
      headers: headers,
    });
    return session?.user;
  }
);

/**
 * Sign out the current user
 */
export const signOutFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const headers = getRequestHeaders();
    return getAuth().api.signOut({ headers: headers });
  }
);
