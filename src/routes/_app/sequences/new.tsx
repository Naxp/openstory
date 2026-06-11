import { BillingGateDialog } from '@/components/billing/billing-gate-dialog';
import { PageContainer } from '@/components/layout/page-container';
import { ScriptView } from '@/components/script/script-view';
import { useBillingGate } from '@/hooks/use-billing-gate';
import { useUser } from '@/hooks/use-user';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { Route as ScenesRoute } from '@/routes/_app/sequences/$id/scenes';

const BILLING_PROMPT_KEY = 'openstory:billing-prompt-dismissed';
const BILLING_PROMPT_EXPIRY_DAYS = 1;

function wasBillingPromptDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(BILLING_PROMPT_KEY);
  if (!raw) return false;
  const expiry = Number(raw);
  if (Date.now() > expiry) {
    localStorage.removeItem(BILLING_PROMPT_KEY);
    return false;
  }
  return true;
}

function dismissBillingPrompt() {
  const expiry = Date.now() + BILLING_PROMPT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(BILLING_PROMPT_KEY, String(expiry));
}

export const Route = createFileRoute('/_app/sequences/new')({
  component: NewSequencePage,
  staticData: {
    breadcrumb: [
      { label: 'Sequences', to: '/sequences' },
      { label: 'New sequence' },
    ],
  },
});

function NewSequencePage() {
  const navigate = useNavigate();
  // Session is prefetched in _app/route.tsx beforeLoad, so this is settled on
  // first render — no flash for signed-in users.
  const { data: user } = useUser();
  const { needsBillingSetup, hasFalKey, hasOpenRouterKey, stripeEnabled } =
    useBillingGate();
  const [billingOpen, setBillingOpen] = useState(false);

  // Clear billing return flag when user is back on this page
  useEffect(() => {
    localStorage.removeItem('openstory:billing-return');
  }, []);

  useEffect(() => {
    if (needsBillingSetup && !wasBillingPromptDismissed()) {
      setBillingOpen(true);
    }
  }, [needsBillingSetup]);

  const handleSuccess = useCallback(
    (sequenceIds: string[]) => {
      const [firstId] = sequenceIds;
      if (firstId) {
        // Navigate to storyboard page after successful generation
        void navigate({
          to: ScenesRoute.to,
          params: { id: firstId },
        });
      }
    },
    [navigate]
  );

  return (
    <div className="h-full">
      <BillingGateDialog
        open={billingOpen}
        onOpenChange={(open) => {
          setBillingOpen(open);
          if (!open) dismissBillingPrompt();
        }}
        hasFalKey={hasFalKey}
        hasOpenRouterKey={hasOpenRouterKey}
        stripeEnabled={stripeEnabled}
        context="onboarding"
      />
      <PageContainer maxWidth="narrow" fullHeight>
        {!user && (
          <h1 className="text-center text-2xl font-semibold tracking-tight">
            Tell your whole story
          </h1>
        )}
        <ScriptView loading={false} onSuccess={handleSuccess} />
      </PageContainer>
    </div>
  );
}
