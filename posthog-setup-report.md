<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the OpenStory TanStack Start application. Client-side tracking is provided via `PostHogProvider` in the root route, server-side tracking via a singleton `posthog-node` client, and user identification fires on OTP verification. A Vite dev-server proxy routes PostHog ingestion through `/ingest` locally; the production Cloudflare Workers deployment uses the PostHog host directly. Exception capture (`capture_exceptions: true`) is enabled globally.

| Event | Description | File |
|---|---|---|
| `user_otp_requested` | User submitted email to request a sign-in OTP | `src/components/auth/auth-form.tsx` |
| `user_google_sign_in_started` | User clicked "Continue with Google" to begin OAuth | `src/components/auth/auth-form.tsx` |
| `user_signed_in` | User verified OTP and completed sign-in; triggers `posthog.identify()` | `src/components/auth/verify-form.tsx` |
| `sequence_generated` | User submitted the script form and triggered AI sequence generation | `src/components/script/script-view.tsx` |
| `script_enhanced` | User triggered AI script enhancement before generating | `src/components/script/script-view.tsx` |
| `motion_generation_started` | User started batch motion/video generation for a sequence | `src/components/scenes/scenes-view.tsx` |
| `credits_topup_started` | User clicked "Top up" to initiate a Stripe checkout | `src/components/settings/billing-settings.tsx` |
| `auto_topup_enabled` | User enabled the auto top-up feature | `src/components/settings/billing-settings.tsx` |
| `gift_code_redeemed` | User successfully redeemed a gift code for credits | `src/routes/gift/$code.tsx` |
| `credits_added` | **Server-side** — Stripe webhook confirmed a successful payment | `src/routes/api/billing/webhook.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/379578/dashboard/1459363)
- **Sign-in Funnel** — OTP requested → signed in: [View insight](https://us.posthog.com/project/379578/insights/wpiesdKS)
- **Sign-up to First Sequence Funnel** — signed in → sequence generated (7-day window): [View insight](https://us.posthog.com/project/379578/insights/feUTEAeX)
- **Credits Top-Up Conversion Funnel** — top-up started → credits confirmed: [View insight](https://us.posthog.com/project/379578/insights/LNL4UXY6)
- **Sequence & Script Activity** — daily sequences generated + scripts enhanced: [View insight](https://us.posthog.com/project/379578/insights/MW9k7bpt)
- **Revenue Events Trend** — daily top-ups started, credits added, and gift codes redeemed: [View insight](https://us.posthog.com/project/379578/insights/oGIuTzxI)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
