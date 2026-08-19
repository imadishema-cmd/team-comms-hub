# Zipline Team Comms Hub — V2

A Chromebook-friendly internal communications hub deployed on Netlify. V2 keeps the existing Netlify Blobs store (`team-comms-hub-v1`) so data created in V1 remains available after deployment.

## What V2 adds

- Reader/editor access modes
- Read acknowledgements on updates
- Edit and delete controls restricted to editors
- Audit/activity trail
- Per-item revision history stored in Blobs
- Related resource links (Google Drive, Docs, tickets, etc.)
- Review queue and unread/review dashboard metric
- Search across updates, knowledge, and decisions
- Official Zipline logo/photography references sourced only from Zipline-owned web properties
- Visual direction aligned to Zipline's public site: warm cream surfaces, high-contrast black, vivid orange-red, rounded cards, large direct headlines

## Netlify deployment

Push these files to the same GitHub repository. Netlify will redeploy automatically.

The required server function must remain at:

`netlify/functions/api.mjs`

## Access control (important before sensitive use)

In Netlify → Project configuration → Environment variables, add:

- `TEAM_EDITOR_CODE` — editors can create, edit, and delete
- `TEAM_VIEW_CODE` — readers can browse and acknowledge updates

For backwards compatibility, an existing `TEAM_ACCESS_CODE` is treated as an editor code.

If no access variables are configured, the app remains in pilot mode and grants editor access. Configure the codes before storing sensitive internal content.

## Official brand assets used

The UI references media served by Zipline's official website and brand-guidelines page only:

- Zipline logo thumbnail from Zipline's official Logos & Brand Guidelines page
- Zipline drone imagery from Zipline's official Solutions for Governments page

No third-party stock photography or non-Zipline logo assets are included.
