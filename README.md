# Zipline Team Comms Hub

A Chromebook-friendly, Netlify-hosted internal communications hub inspired by Zipline's public website: bold typography, warm off-white surfaces, strong red accents, rounded UI, and concise copy.

## What is included

- Shared real-time updates feed
- Living knowledge pages / SOPs / FAQs / project context
- Decision log
- Search across all content
- Review-date queue
- Priority and status filtering
- Create, edit, and delete from the browser
- Responsive Chromebook/mobile UI
- Persistent shared data using Netlify Blobs (no separate database account)
- Optional shared access code

## Deploy on Netlify (recommended: Git import)

1. Put this folder in a GitHub repository.
2. In Netlify choose **Add new project → Import an existing project**.
3. Select the repository.
4. Netlify reads `netlify.toml`; accept the defaults and deploy.
5. Optional security: in **Project configuration → Environment variables**, add `TEAM_ACCESS_CODE` with a strong shared code, then redeploy.

No database setup is required. Netlify Blobs is created automatically on first use.

## Local preview (optional)

```bash
npm install
npm run dev
```

## Important security note

The optional access code is appropriate for a lightweight internal pilot, but it is not enterprise SSO. For a production deployment containing sensitive company information, put the site behind your organization's approved identity layer or Netlify's enterprise SSO/access controls.

## Branding note

This project uses original UI code and text-only branding inspired by the visual direction of Zipline's public website. It does not bundle proprietary Zipline image or font assets.
