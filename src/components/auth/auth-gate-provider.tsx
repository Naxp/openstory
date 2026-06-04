/**
 * Auth Gate Provider
 *
 * Lets anonymous (logged-out) visitors browse the app shell while gating any
 * real action (generate, save, create…) behind a login prompt. Wrap a subtree
 * with <AuthGateProvider> and call `useAuthGate().requireAuth(action)` at the
 * point an action is triggered:
 *
 *   const { requireAuth } = useAuthGate();
 *   const onGenerate = () => {
 *     if (!requireAuth()) return; // logged out → opens login dialog, bails
 *     // …authenticated path…
 *   };
 *
 * The default context value (used when no provider is mounted, e.g. Storybook)
 * treats the user as authenticated and runs the action, so components that opt
 * into gating still work unchanged outside the app shell.
 */

import { AuthForm } from '@/components/auth/auth-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUser } from '@/hooks/use-user';
import { useRouterState } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type AuthGateContextValue = {
  /** Whether a session is present. */
  isAuthenticated: boolean;
  /**
   * Run `action` if authenticated. Otherwise open the login dialog and return
   * false so callers can bail. Returns true when the action was allowed to run.
   */
  requireAuth: (action?: () => void) => boolean;
  /** Open the login dialog directly. */
  openLogin: () => void;
};

const AuthGateContext = createContext<AuthGateContextValue>({
  isAuthenticated: true,
  requireAuth: (action) => {
    action?.();
    return true;
  },
  openLogin: () => {},
});

export function useAuthGate(): AuthGateContextValue {
  return useContext(AuthGateContext);
}

function isPreviewHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.host.includes('pr-');
}

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { data: user } = useUser();
  const isAuthenticated = !!user;
  const [open, setOpen] = useState(false);

  // Return the visitor to wherever they were after signing in so their
  // in-progress draft (persisted to localStorage) is restored.
  const redirectTo = useRouterState({
    select: (s) => s.location.href,
  });

  const openLogin = useCallback(() => setOpen(true), []);

  const requireAuth = useCallback(
    (action?: () => void) => {
      if (isAuthenticated) {
        action?.();
        return true;
      }
      setOpen(true);
      return false;
    },
    [isAuthenticated]
  );

  const value = useMemo(
    () => ({ isAuthenticated, requireAuth, openLogin }),
    [isAuthenticated, requireAuth, openLogin]
  );

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md border-none bg-transparent p-0 shadow-none [&>button]:hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Sign in to continue</DialogTitle>
          </DialogHeader>
          <AuthForm redirectTo={redirectTo} isPreview={isPreviewHost()} />
        </DialogContent>
      </Dialog>
    </AuthGateContext.Provider>
  );
}
