# Zipline Centralized Call Center Hub — V4

A Chromebook-first internal operations platform for the Centralized Call Center. It combines live communications, trusted knowledge, shift operations, durable decisions, team learning, acknowledgements, user administration, reporting, and audit history in one Netlify-hosted application.

## What changed in V4

V4 is a security and operations architecture upgrade, not just a visual refresh.

### Security
- HttpOnly, Secure, SameSite=Strict session cookies instead of browser `localStorage` session tokens.
- CSRF protection on state-changing requests.
- Login/signup/reset rate limiting and account lockout windows.
- Work-email verification with one-time tokens. Email delivery uses Resend when configured; Admin verification remains available as a fallback.
- Self-service reset links when email delivery is configured.
- Optional TOTP MFA for every user, including Admins.
- Server-side file validation using extension + file signatures; HTML, JavaScript and SVG uploads are rejected.
- Strict Content Security Policy and additional browser security headers.
- Passwords remain scrypt-hashed; plaintext passwords are never stored.

### Scalable data model
- Workspace data is split across independent Netlify Blob keys rather than rewriting one giant `workspace` object.
- Optimistic concurrency (`ETag`/`onlyIfMatch`) prevents silent last-write-wins overwrites.
- Authentication, per-user progress, content, binary files, rate limits and reminder state are stored separately.
- Scoped workspace reads and a paged-list API reduce unnecessary payloads; the frontend lazy-loads Admin and Decisions data.
- Mutations return only changed records instead of re-downloading the entire workspace.
- 20-second revision polling provides near-real-time refresh without continuous websocket overhead.

### Centralized Call Center operations
- Incident board with severity, status, owner, next action and due time.
- Structured shift handoffs.
- On-call / coverage roster.
- Critical/mandatory communication reminders through email (optional) and a Slack summary (optional).
- Supervisor reminder summaries for unacknowledged critical communications.
- Knowledge macros with one-click copy.
- Ranked server-side search.
- CSV user onboarding and bulk role/group changes.
- Archived-content filters and bulk archive actions.
- SOP comments and “flag as outdated” feedback.
- Calendar (.ics) export for learning due dates, review dates and roster entries.
- Print-friendly SOP/knowledge layouts.

### Learning / LMS
- Content Library with document upload, replace, archive, restore and permanent-delete controls.
- PDF, DOCX, PPTX, XLSX, PNG/JPG/GIF/WEBP, TXT/CSV and MP4 support (within configured size limit).
- Courses, modules, required/optional learning, individual and Call Center group assignment, due dates and progress.
- Resource open tracking: first opened, last opened and open count.
- Quiz bank, single-answer, multiple-select and true/false questions, randomized questions, pass marks and max attempts.
- Automatic grading, explanations and learning analytics.
- CSV reports for learning, acknowledgements, quizzes, document opens and incidents.

### UX / accessibility / branding
- Zipline-violet light and dark themes with a top-bar toggle.
- Self-hosted Zipline visual assets; no dependency on public marketing CDN URLs at runtime.
- Static image-led brand moments instead of continuously autoplaying videos, reducing Chromebook CPU/GPU use.
- SVG icon system instead of Unicode symbols.
- PWA manifest, local icons and service worker for the app shell.
- Mid-size Chromebook/tablet breakpoint, mobile navigation and improved compact grids.
- Unsaved-editor confirmation and local draft recovery for text fields.
- Stacking accessible toasts, `aria-live` status regions, labelled modal controls and skip-to-content navigation.
- Separate offline/retry state instead of treating network errors as authentication failures.

### Engineering quality
- Readable modular frontend (`app.js`, `api-client.js`, `ui.js`).
- Backend routes split by auth, content, learning, operations and Admin concerns.
- ESLint + Prettier configuration.
- Node test suite covering visibility/targeting, password hashing, TOTP and unsafe uploads.
- GitHub Actions validation before merge/deploy.

## Deploy to Netlify

1. Replace the contents of your existing GitHub repository with this complete project.
2. Keep the repository Private.
3. Netlify remains connected to the repository and will deploy automatically.
4. `netlify.toml` points Netlify Functions to `netlify/functions` and runs the validation suite before publishing.

The first V4 request performs a one-time migration from the earlier Hub stores. Existing V3 users, communications, knowledge, courses and tracked progress are preserved where the previous data is available. Because V4 moves sessions from `localStorage` to secure HttpOnly cookies, existing users will need to sign in once after the V4 deployment.

## Required Netlify environment variables

Set these once in **Project configuration → Environment variables**:

| Variable | Recommended value |
|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | Your initial Admin work email |
| `ALLOWED_EMAIL_DOMAINS` | `flyzipline.com` |
| `REQUIRE_ADMIN_APPROVAL` | `true` |
| `APP_BASE_URL` | Your production Netlify/custom-domain URL |

### Email verification + self-service password reset

V4 requires email verification by default. To deliver verification links, reset links and email reminders automatically, configure:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | Approved sender, e.g. `Call Center Hub <hub@your-domain>` |

If email delivery is not configured, new accounts can still be manually email-verified by an Admin before activation.

Set `EMAIL_VERIFICATION_REQUIRED=false` only for a controlled test environment. It is not recommended for production.

### Optional operational notifications

| Variable | Purpose |
|---|---|
| `SLACK_WEBHOOK_URL` | Slack incoming-webhook URL for critical/reminder summaries |
| `SUPERVISOR_EMAILS` | Comma-separated supervisor emails for reminder summaries |
| `ACK_REMINDER_HOURS` | Delay before unacknowledged Critical/High reminders; default `2` |

The `reminders.mjs` Netlify Scheduled Function runs hourly.

### Optional security/storage tuning

| Variable | Default | Purpose |
|---|---:|---|
| `SESSION_DAYS` | `14` | Session duration (capped at 90 days) |
| `MAX_UPLOAD_MB` | `8` | Max file upload size (capped at 12 MB) |

## Roles

- **Viewer**: read/search communications and knowledge, acknowledge mandatory items, use assigned Learning, provide knowledge feedback.
- **Editor**: Viewer permissions plus create/edit owned communications/knowledge/decisions and manage incidents/handoffs. Editor-created durable content enters the approval queue.
- **Admin**: all Editor permissions plus user roles/status, Call Center groups, approvals, roster, Learning Administration, reports, audit trail and permanent deletion controls.

Users cannot promote themselves. At least one active Admin must remain.

## CSV user import

From **Admin → Users → Import CSV**, use headers such as:

```csv
name,email,role,groups
Alex Example,alex@flyzipline.com,viewer,Day Shift;Support
```

Group names are separated by semicolons. Imported accounts are invitations; the employee claims the account by signing up with that email and choosing their own password.

## File safety

Uploaded files are validated on the server. Executable web formats such as HTML, JS and SVG are intentionally rejected. Do not change the allow-list without reviewing browser execution and content-sniffing risks.

## Development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run validate
```

This runs syntax checks, ESLint and the Node test suite.

## Architecture

```text
Browser
  ├─ app.js                 UI, rendering and workflows
  ├─ api-client.js          Cookie/CSRF-aware API client
  └─ ui.js                  accessibility, formatting, export helpers

Netlify Functions
  ├─ api.mjs                small request router
  ├─ reminders.mjs          hourly reminders
  └─ lib/
      ├─ routes-auth.mjs
      ├─ routes-content.mjs
      ├─ routes-learning.mjs
      ├─ routes-operations.mjs
      ├─ routes-admin.mjs
      ├─ security.mjs
      ├─ store.mjs
      ├─ workspace.mjs
      ├─ notify.mjs
      └─ domain.mjs
```

## Production note

This version substantially hardens the pilot, but any internal system handling sensitive company information should still follow Zipline’s internal security review, identity, retention, logging and data-classification requirements before broad production rollout.


## Brand asset fallback behavior

The Hub now prefers Zipline-hosted public brand assets for the logo and primary hero image. Bundled files under `assets/` remain in the project as local fallbacks. If an official remote asset cannot be reached, the interface automatically falls back to the bundled local copy, so branding does not disappear during an external CDN/network problem. PWA icons remain local by design.
