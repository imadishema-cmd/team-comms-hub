import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const STORE_NAME = 'team-comms-hub-v1';
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const seed = {
  updates: [
    {
      id: 'welcome-update',
      title: 'Team Communication Hub is live',
      summary: 'Use this space for time-sensitive updates, operational changes, and decisions that the team needs to find later.',
      category: 'Announcement', priority: 'High', status: 'Active', owner: 'Comms Hub Admin',
      createdAt: new Date().toISOString(), reviewDate: '', link: ''
    }
  ],
  docs: [
    { id: 'doc-escalation', title: 'Escalation Process', type: 'SOP', owner: 'Operations', status: 'Active', updatedAt: new Date().toISOString(), reviewDate: '', content: 'Document the current escalation path here. Keep the owner and review date current.' },
    { id: 'doc-weekly', title: 'Weekly Operating Rhythm', type: 'Reference', owner: 'Team Lead', status: 'Active', updatedAt: new Date().toISOString(), reviewDate: '', content: 'Capture recurring meetings, reporting cadence, and important weekly checkpoints here.' }
  ],
  decisions: [
    { id: 'decision-example', decision: 'Use the hub as the durable source of truth for team-wide operational communications.', owner: 'Team Lead', reason: 'Reduce information loss across chat, email, and meetings.', impact: 'Important changes should be entered here and linked from chat.', status: 'Active', createdAt: new Date().toISOString(), reviewDate: '' }
  ]
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}
function unauthorized() { return json({ error: 'Invalid access code.' }, 401); }
function checkAccess(req) {
  const expected = process.env.TEAM_ACCESS_CODE;
  if (!expected) return true;
  const supplied = req.headers.get('x-team-access-code') || '';
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function readData(store) {
  const current = await store.get('workspace', { type: 'json', consistency: 'strong' });
  if (current) return current;
  await store.setJSON('workspace', seed);
  return seed;
}

export default async (req) => {
  if (!checkAccess(req)) return unauthorized();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/^\.netlify\/functions\/api\/?/, '');
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  let data = await readData(store);

  if (req.method === 'GET' && (path === '' || path === 'data')) return json(data);

  if (req.method === 'POST' && path === 'item') {
    const body = await req.json();
    const collection = body.collection;
    if (!['updates','docs','decisions'].includes(collection)) return json({ error: 'Invalid collection.' }, 400);
    const item = { ...body.item, id: body.item?.id || crypto.randomUUID() };
    if (collection === 'updates' && !item.createdAt) item.createdAt = new Date().toISOString();
    if (collection === 'docs') item.updatedAt = new Date().toISOString();
    if (collection === 'decisions' && !item.createdAt) item.createdAt = new Date().toISOString();
    data[collection] = [item, ...data[collection]];
    await store.setJSON('workspace', data);
    return json({ item, data }, 201);
  }

  if (req.method === 'PUT' && path === 'item') {
    const body = await req.json();
    const { collection, item } = body;
    if (!['updates','docs','decisions'].includes(collection) || !item?.id) return json({ error: 'Invalid request.' }, 400);
    const idx = data[collection].findIndex(x => x.id === item.id);
    if (idx < 0) return json({ error: 'Item not found.' }, 404);
    const updated = { ...data[collection][idx], ...item };
    if (collection === 'docs') updated.updatedAt = new Date().toISOString();
    data[collection][idx] = updated;
    await store.setJSON('workspace', data);
    return json({ item: updated, data });
  }

  if (req.method === 'DELETE' && path === 'item') {
    const body = await req.json();
    const { collection, id } = body;
    if (!['updates','docs','decisions'].includes(collection) || !id) return json({ error: 'Invalid request.' }, 400);
    data[collection] = data[collection].filter(x => x.id !== id);
    await store.setJSON('workspace', data);
    return json({ ok: true, data });
  }

  return json({ error: 'Not found.' }, 404);
};
