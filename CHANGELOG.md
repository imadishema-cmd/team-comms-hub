# Changelog

## V4.0.0

- Replaced browser-stored bearer sessions with HttpOnly cookie sessions and CSRF protection.
- Added login/signup/reset throttling, lockouts, email verification tokens, optional email delivery, and TOTP MFA.
- Added strict CSP/security headers and hardened file validation.
- Split the former monolithic workspace storage into independent content/auth/progress/file stores with optimistic concurrency.
- Added scoped reads, paged list endpoint, incremental mutation responses, and revision polling.
- Added incidents, shift handoffs, and on-call/coverage roster.
- Added optional email/Slack notifications plus hourly reminder/escalation job.
- Added knowledge macros, comments, outdated flags, print styling, calendar export, ranked search, highlighting, bulk actions and archived views.
- Added communication/knowledge attachments.
- Expanded Learning Content Library upload/replace/archive/delete controls and course builder inline uploads.
- Added light/dark themes, self-hosted Zipline imagery, SVG icons, PWA metadata/service worker and responsive refinements.
- Added accessible status/toast patterns, skip navigation, loading/offline states and unsaved-change protection.
- Added ESLint, Prettier, tests and GitHub Actions validation.

- Updated brand asset loading to prefer official Zipline-hosted logo/hero assets while retaining bundled local fallbacks.
