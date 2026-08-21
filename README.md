# Zipline Centralized Call Center Hub - V3

A Chromebook-first internal communications, knowledge and learning hub for the Centralized Call Center team. It runs on Netlify and uses Netlify Blobs for persistence.

## V3 highlights

- Email/password self-sign-up and sign-in
- First account becomes Admin (or set `BOOTSTRAP_ADMIN_EMAIL` to reserve bootstrap admin)
- Viewer, Editor and Admin roles; Admins can promote/demote users
- Optional admin approval for new accounts (`REQUIRE_ADMIN_APPROVAL=true`)
- Optional email-domain restriction (`ALLOWED_EMAIL_DOMAINS=flyzipline.com`)
- Communications with mandatory acknowledgement, pinning, targeting, approval workflow, review/expiry dates and audit history
- Knowledge/SOP pages with version history and review queue
- Decisions log
- Centralized Call Center groups and group assignments
- Learning center inspired by modern LMS workflows: courses, modules, document uploads, open tracking, completion, due dates, quizzes, question bank, attempts, pass marks and analytics
- Personal notification center and dashboard
- CSV reporting
- Archive/retention controls
- Zipline-purple visual system using only official Zipline-hosted brand imagery

## Upgrade from V2

V3 continues to read the existing `team-comms-hub-v1` content store, so V2 updates/knowledge/decisions are preserved. Authentication moves to a new protected auth store.

Replace the top-level files and `netlify/functions/api.mjs` in GitHub. Netlify will redeploy automatically.

### First sign-up

If no user account exists, the first successful registration becomes an Admin. For a safer bootstrap, set this Netlify environment variable before anyone signs up:

`BOOTSTRAP_ADMIN_EMAIL=your.work.email@company.com`

Then only that email can claim the first Admin account.

### Optional environment variables

- `ALLOWED_EMAIL_DOMAINS=flyzipline.com` - comma-separated allowed sign-up domains
- `REQUIRE_ADMIN_APPROVAL=true` - all accounts after bootstrap remain pending until approved
- `SESSION_DAYS=14` - session lifetime, defaults to 14 days
- `MAX_UPLOAD_MB=4` - learning document upload limit, defaults to 4 MB

No environment variable needs to be re-entered after each deployment.

## Important security note

This is a functional internal pilot architecture, not a replacement for enterprise SSO/IAM. Before storing highly sensitive information, route authentication through your organization's approved identity platform and complete a security review.

## Brand sources

The UI references imagery hosted by Zipline's official public website / brand pages only. No third-party brand imagery is included.


## V3.1 polish
- Notifications are now dismissed persistently when opened, with a Clear all action.
- Added official Zipline-hosted imagery/video and purposefully fast view/card transitions inspired by Zipline's current public brand system.
- Motion respects prefers-reduced-motion.
