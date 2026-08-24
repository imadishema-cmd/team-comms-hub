# Upgrade from V3.x to V4

1. Download the full V4 ZIP and extract it.
2. In GitHub, replace the contents of the existing `team-comms-hub` repository with the V4 project.
3. Keep the repository **Private**.
4. Preserve your existing Netlify project and its environment variables.
5. Add `APP_BASE_URL` to your Netlify environment variables before enabling email verification/reset delivery.
6. If you want automatic verification/reset/reminder emails, add `RESEND_API_KEY` and `EMAIL_FROM`.
7. Optional: add `SLACK_WEBHOOK_URL`, `SUPERVISOR_EMAILS`, and `ACK_REMINDER_HOURS`.
8. Commit to GitHub. Netlify will deploy automatically.
9. Wait for the production deploy to show **Published**.
10. Force-refresh the site once with `Ctrl + Shift + R`.
11. Sign in again. V4 deliberately moves sessions into secure HttpOnly cookies, so old V3 browser sessions do not carry over.
12. Test one harmless communication, acknowledgement, file upload, Learning course, incident, and notification before inviting the wider team.

The V4 migration runs automatically on first request and copies existing V3 data into the new storage layout.
