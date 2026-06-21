import { BillingGateDialog } from '@/components/billing/billing-gate-dialog';
import { OpenStoryLogo } from '@/components/icons/openstory-logo';
import { PageContainer } from '@/components/layout/page-container';
import { ScriptView } from '@/components/script/script-view';
import { SampleVideoShowcase } from '@/components/style/sample-video-showcase';
import { useBillingGate } from '@/hooks/use-billing-gate';
import { useStyles } from '@/hooks/use-styles';
import { useUser } from '@/hooks/use-user';
import { briefForStyle } from '@/lib/style/brief-for-style';
import { styleSlug } from '@/lib/style/style-slug';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
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

// `style` carries a sample style's id from the showcase/gallery "Try this
// style" links (#956); the composer seeds its brief + style from it. Optional,
// no default — a bare /sequences/new must stay a bare URL (no 307 rewrite).
const searchSchema = z.object({
  style: z.string().optional(),
});

export const Route = createFileRoute('/_app/sequences/new')({
  validateSearch: searchSchema,
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
  const { style: styleParam } = Route.useSearch();
  // Session is prefetched in _app/route.tsx beforeLoad, so this is settled on
  // first render — no flash for signed-in users.
  const { data: user } = useUser();

  // Sample-style prefill (#956): the showcase/gallery "Try this style" links
  // carry `?style=<slug>` (the same human-readable slug the style's assets live
  // under). Resolve it to a style, snapshot its one-liner brief + id into local
  // state, then immediately strip the param. Snapshotting (rather than reading
  // the param on every render) means a later reload or in-place login can't
  // re-seed over the user's edits — the saved draft owns persistence from then
  // on. The brief is derived here so the URL only carries the slug; settings
  // (models, aspect ratio) follow once the style is selected.
  const { data: styles } = useStyles();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [seed, setSeed] = useState<{ script: string; styleId: string } | null>(
    null
  );
  useEffect(() => {
    if (!styleParam || !styles) return;
    const match = styles.find((s) => styleSlug(s.name) === styleParam);
    if (match) {
      try {
        setSeed({
          script: briefForStyle({
            name: match.name,
            category: match.category,
          }),
          styleId: match.id,
        });
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        // Unmapped style — leave the composer blank rather than seed nothing.
      }
    }
    // Clear the param whether or not it resolved, so it can't re-fire on reload.
    void navigate({ to: Route.to, search: {}, replace: true });
  }, [styleParam, styles, navigate]);

  // Remount the composer when a seed lands so a same-page click (showcase below
  // the composer) re-initialises it from the chosen style.
  const composerKey = seed ? `seed:${seed.styleId}` : 'blank';
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

  const billingGate = (
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
  );

  // Signed-in: the script box fills the screen. Logged-out: lead with the logo
  // and tagline, then show a scrollable showcase of canonical style samples
  // below the script box (#956).
  if (user) {
    return (
      <div className="h-full">
        {billingGate}
        <PageContainer maxWidth="narrow" fullHeight>
          <ScriptView
            key={composerKey}
            loading={false}
            onSuccess={handleSuccess}
            initialScript={seed?.script}
            initialStyleId={seed?.styleId}
          />
        </PageContainer>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {billingGate}
      <PageContainer maxWidth="narrow" padding="spacious">
        <div className="flex flex-col items-center gap-4">
          <OpenStoryLogo size="xl" />
          <h1 className="text-center text-2xl font-semibold tracking-tight">
            Tell your whole story
          </h1>
        </div>
        <ScriptView
          key={composerKey}
          loading={false}
          onSuccess={handleSuccess}
          initialScript={seed?.script}
          initialStyleId={seed?.styleId}
        />
        <SampleVideoShowcase />
      </PageContainer>
    </div>
  );
}
