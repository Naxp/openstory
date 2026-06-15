import { GitHubIcon } from '@/components/icons/github-icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getForkEnabledFn } from '@/functions/fork';
import { SITE_CONFIG } from '@/lib/marketing/constants';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { zodValidator } from '@tanstack/zod-adapter';
import {
  CircleCheck,
  Cloud,
  GitFork,
  KeyRound,
  LoaderCircle,
  Rocket,
  TriangleAlert,
} from 'lucide-react';
import { z } from 'zod';

const title = `Fork & Deploy — ${SITE_CONFIG.name}`;
const description = `Fork ${SITE_CONFIG.name} into your own GitHub account and deploy it to your own Cloudflare account in a few clicks.`;

const searchSchema = z.object({
  step: z.enum(['deploying']).optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute('/_marketing/fork')({
  component: ForkPage,
  validateSearch: zodValidator(searchSchema),
  loader: async () => await getForkEnabledFn(),
  head: () => ({
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: `${SITE_CONFIG.url}/fork` },
      { name: 'twitter:title', content: title },
    ],
  }),
});

const STEPS = [
  {
    icon: GitHubIcon,
    title: 'Connect GitHub',
    body: 'Authorize with GitHub. We create a real fork of this repository in your account — linked to upstream, so you can pull future updates.',
  },
  {
    icon: Cloud,
    title: 'Connect Cloudflare',
    body: 'Authorize with Cloudflare. Your fork uses the token to provision a D1 database and R2 buckets on your account.',
  },
  {
    icon: Rocket,
    title: 'Deploy & open',
    body: "Your fork's CI builds and deploys to Cloudflare Workers, then you open the app on your own workers.dev domain.",
  },
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  disabled:
    'Fork & deploy is not configured on this instance yet. Use the manual deploy option below.',
  github_state: 'GitHub sign-in could not be verified. Please try again.',
  github_fork: 'We could not create the fork. Please try again.',
  cloudflare_state:
    'Cloudflare sign-in could not be verified. Please start over.',
  cloudflare_deploy:
    'We connected your accounts but could not start the deploy. Please try again.',
};

function StepIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
      {children}
    </span>
  );
}

type ForkStatus = {
  step: 'idle' | 'deploying';
  forkUrl?: string;
  workerUrl?: string;
  run?: {
    status: string | null;
    conclusion: string | null;
    htmlUrl: string;
  } | null;
};

function DeployProgress() {
  const { data } = useQuery<ForkStatus>({
    queryKey: ['fork-status'],
    queryFn: async () => {
      const res = await fetch('/api/fork/status');
      if (!res.ok) throw new Error('status check failed');
      return res.json();
    },
    refetchInterval: (query) =>
      query.state.data?.run?.conclusion ? false : 4000,
  });

  const run = data?.run;
  const done = run?.conclusion === 'success';
  const failed = run?.conclusion != null && run.conclusion !== 'success';
  const target = data?.workerUrl ?? data?.forkUrl;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <StepIcon>
          {done ? (
            <CircleCheck className="size-4" />
          ) : failed ? (
            <TriangleAlert className="size-4" />
          ) : (
            <LoaderCircle className="size-4 animate-spin" />
          )}
        </StepIcon>
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">
            {done
              ? 'Your copy is live'
              : failed
                ? 'Deploy needs attention'
                : 'Deploying your fork…'}
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            {done
              ? 'Your fork built and deployed to Cloudflare Workers.'
              : failed
                ? 'The deploy workflow did not finish successfully. Check the logs on GitHub.'
                : 'We forked the repo and started its deploy workflow. This takes a few minutes — this page updates automatically.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {done && target && (
          <Button size="lg" asChild>
            <a href={target} target="_blank" rel="noopener noreferrer">
              <Rocket />
              Open your app
            </a>
          </Button>
        )}
        {data?.run && (
          <Button variant="outline" asChild>
            <a
              href={data.run.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View deploy logs
            </a>
          </Button>
        )}
        {data?.forkUrl && (
          <Button variant="ghost" asChild>
            <a href={data.forkUrl} target="_blank" rel="noopener noreferrer">
              <GitHubIcon className="size-4" />
              Your fork
            </a>
          </Button>
        )}
      </div>
    </section>
  );
}

function ForkPage() {
  const { enabled } = Route.useLoaderData();
  const { step, error } = Route.useSearch();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-12 px-6 py-32">
      <header className="flex flex-col gap-4">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <GitFork className="size-6" />
        </span>
        <h1 className="font-heading text-4xl font-bold tracking-tight">
          Fork &amp; deploy your own {SITE_CONFIG.name}
        </h1>
        <p className="text-lg leading-relaxed text-muted-foreground">
          {SITE_CONFIG.name} is open source. Fork it into your GitHub account
          and run your own copy on Cloudflare — your code, your database, your
          account.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            {ERROR_MESSAGES[error] ?? 'Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      {step === 'deploying' ? (
        <DeployProgress />
      ) : (
        <>
          <ol className="flex flex-col gap-6">
            {STEPS.map(({ icon: Icon, title: stepTitle, body }) => (
              <li key={stepTitle} className="flex items-start gap-4">
                <StepIcon>
                  <Icon className="size-4" />
                </StepIcon>
                <div className="flex flex-col gap-1">
                  <h2 className="font-semibold">{stepTitle}</h2>
                  <p className="leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {enabled ? (
            <div className="flex flex-col items-start gap-3">
              <Button size="lg" asChild>
                <a href="/api/fork/github/start">
                  <GitFork />
                  Fork &amp; deploy
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">
                You&rsquo;ll authorize GitHub, then Cloudflare. We only use the
                access to fork the repo and deploy it to your account.
              </p>
            </div>
          ) : (
            <Alert>
              <TriangleAlert />
              <AlertTitle>One-click fork isn&rsquo;t set up here</AlertTitle>
              <AlertDescription>
                This instance hasn&rsquo;t configured the GitHub and Cloudflare
                OAuth apps. You can still deploy manually with the{' '}
                <a
                  href="/docs/deployment/cloudflare"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Cloudflare deployment guide
                </a>
                .
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      <div className="flex items-start gap-4 rounded-lg border bg-muted/50 p-4">
        <StepIcon>
          <KeyRound className="size-4" />
        </StepIcon>
        <div className="flex flex-col gap-1 text-sm leading-relaxed">
          <p className="font-medium">After it deploys: add your AI keys</p>
          <p className="text-muted-foreground">
            Generation needs a fal.ai key and an OpenRouter key. Add them per
            team from Settings &rarr; API Keys in your deployed copy, or
            server-wide with{' '}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
              wrangler secret put
            </code>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
