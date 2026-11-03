import { readFile, mkdir, writeFile } from 'node:fs/promises';

// Adapt the upstream service-worker entrypoint to Pages module syntax.
// Bindings are scoped to each request, never assigned to shared globals.
const upstream = await readFile(new URL('./movecar.js', import.meta.url), 'utf8');
const entrypoint = /^addEventListener\('fetch', event => \{\r?\n  event\.respondWith\(handleRequest\(event\.request\)\)\r?\n\}\)\r?\n/;
if (!entrypoint.test(upstream)) throw new Error('Upstream entrypoint changed; review the adapter.');
const source = upstream.replace(entrypoint, '');
const worker = `import { deliverNotification, hasNotificationProvider } from '../notifications.mjs';
import { createFollowUpCookie, getFollowUp, getSession } from '../follow-up.mjs';
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/follow-up') return getFollowUp(request, env);
    if (pathname === '/api/session') return getSession(request, env);
    const { MOVE_CAR_STATUS } = env;
    const sendNotification = notification => deliverNotification(env, notification);
    if (new URL(request.url).pathname === '/api/notify' && !hasNotificationProvider(env)) {
      return Response.json({ success: false, error: '车主尚未配置推送通知，请稍后再试。' }, { status: 503 });
    }
${source}
    const response = await handleRequest(request);
    if (pathname === '/api/notify' && request.method === 'POST' && response.ok) {
      const cookie = await createFollowUpCookie(env, Date.now(), request);
      if (cookie) response.headers.set('Set-Cookie', cookie);
      response.headers.set('Cache-Control', 'no-store');
    }
    return response;
  }
};
`;
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/_worker.js', import.meta.url), worker);
console.log('Built dist/_worker.js');
