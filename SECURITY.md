# Security notes

- Keep this repository private.
- Never commit Netlify environment values or API keys.
- Use `ALLOWED_EMAIL_DOMAINS`, Admin approval and email verification in production.
- Require MFA for Admins operationally; V4 supports TOTP MFA in the user profile.
- Uploaded web-executable formats (HTML, JS, SVG) are intentionally rejected.
- Report suspected access-control, data-leakage or authentication issues before continuing rollout.
- Review Netlify access, deployment logs, audit trail retention and organizational data-classification requirements before broad use.
