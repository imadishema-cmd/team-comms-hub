import { ensureMigrated } from './lib/store.mjs';
import { json } from './lib/security.mjs';
import { handleAuth } from './lib/routes-auth.mjs';
import { handleContent } from './lib/routes-content.mjs';
import { handleLearning } from './lib/routes-learning.mjs';
import { handleOperations } from './lib/routes-operations.mjs';
import { handleAdmin } from './lib/routes-admin.mjs';

function routePath(req) {
  const url = new URL(req.url);
  return url.pathname
    .replace(/^\/api\/?/, '')
    .replace(/^\/\.netlify\/functions\/api\/?/, '')
    .replace(/^\//, '');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  try {
    await ensureMigrated();
    const path = routePath(req);
    const url = new URL(req.url);

    const handlers = [handleAuth, handleAdmin, handleLearning, handleOperations, handleContent];
    for (const routeHandler of handlers) {
      const response = await routeHandler(req, path, url);
      if (response) return response;
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    console.error(error);
    const headers = {};
    if (error?.retryAfter) headers['retry-after'] = String(error.retryAfter);
    return json({ error: error?.message || 'Server error.' }, error?.status || 500, headers);
  }
}
