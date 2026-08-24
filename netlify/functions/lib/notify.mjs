import { arr, clean } from './domain.mjs';

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({ to, subject, html, text }) {
  if (!emailConfigured()) return { skipped: true };
  const recipients = arr(to).length ? arr(to) : [to];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: recipients.filter(Boolean),
      subject: clean(subject, 300),
      html,
      text,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email delivery failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return { ok: true };
}

export async function sendSlack(text) {
  if (!process.env.SLACK_WEBHOOK_URL) return { skipped: true };
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: clean(text, 3500) }),
  });
  if (!response.ok) throw new Error(`Slack notification failed (${response.status}).`);
  return { ok: true };
}

export async function notifyCriticalUpdate(update, users) {
  const targetEmails = users.map(user => user.email).filter(Boolean);
  const tasks = [];
  if (targetEmails.length && emailConfigured()) {
    for (const address of targetEmails) {
      tasks.push(sendEmail({
        to: address,
        subject: `[${update.priority || 'Update'}] ${update.title}`,
        text: `${update.title}\n\n${update.summary || update.details || ''}\n\nOpen the Centralized Call Center Hub to review${update.mandatory ? ' and acknowledge' : ''}.`,
        html: `<h2>${escapeHtml(update.title)}</h2><p>${escapeHtml(update.summary || update.details || '')}</p><p>Open the Centralized Call Center Hub to review${update.mandatory ? ' and acknowledge' : ''}.</p>`,
      }));
    }
  }
  tasks.push(sendSlack(`*${update.priority || 'Update'} — ${update.title}*\n${update.summary || ''}${update.mandatory ? '\nAcknowledgement required.' : ''}`));
  await Promise.allSettled(tasks);
}

export function verificationLink(token, email) {
  const base = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}/?verify=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

export function resetLink(token, email) {
  const base = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}/?reset=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
