import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createFollowUpCookie, getSession } from './follow-up.mjs';
import worker from './dist/_worker.js';

const start = 1800000000000;
function environment() {
  const values = new Map([['notify_status', 'waiting']]);
  return { PHONE_NUMBER: '15500000000', FOLLOW_UP_SECRET: 'session-test-secret', PUSHPLUS_TOKEN: 'test', MOVE_CAR_STATUS: { get: async key => values.get(key) || null, put: async (key, value) => values.set(key, value) } };
}
const request = (path, cookie) => new Request('https://movecar.example' + path, { headers: cookie ? { Cookie: cookie.split(';')[0] } : {} });

test('Session restoration authenticates the browser and reports elapsed time without revealing contact options', async () => {
  const env = environment();
  const cookie = await createFollowUpCookie(env, start);
  const response = await getSession(request('/api/session', cookie), env, start + 30000);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  const session = await response.json();
  assert.deepEqual(session, { active: true, elapsedMs: 30000, status: 'waiting', ownerLocation: null });
  assert.doesNotMatch(JSON.stringify(session), /15500000000|tel:|phone|电话/i);
  for (const [candidate, now] of [[null, start], [cookie + 'invalid', start], [cookie, start + 900000]]) {
    // Test malformed cookies separately from the valid expired session.
    const req = candidate?.endsWith('invalid') ? request('/api/session', '__Secure-movecar-session=invalid') : request('/api/session', candidate);
    assert.deepEqual(await (await getSession(req, env, now)).json(), { active: false });
  }
});

async function browser(env, cookie) {
  const html = await (await worker.fetch(request('/', cookie), env)).text();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(id === 'ownerFeedback' ? ['hidden'] : []);
      elements.set(id, { style: {}, innerHTML: '', innerText: '', classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) }, replaceChildren() { this.innerHTML = ''; } });
    }
    return elements.get(id);
  }
  const timers = [];
  const intervals = new Map();
  const calls = [];
  let intervalId = 0;
  const context = vm.createContext({
    window: {}, navigator: {},
    document: { getElementById: element },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
    setInterval(fn, delay) { intervals.set(++intervalId, { fn, delay }); return intervalId; }, clearInterval(id) { intervals.delete(id); },
    fetch: async path => { calls.push(path); return worker.fetch(request(path, cookie), env); }
  });
  vm.runInContext(script, context);
  await context.window.onload();
  await new Promise(resolve => setImmediate(resolve));
  return { element, timers, intervals, calls };
}

test('Reload resumes waiting, observes later owner confirmation, and restores elapsed/expired sessions', async () => {
  const env = environment();
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  try {
    let now = start;
    Date.now = () => now;
    // Exercise the actual notification route without contacting the push service.
    globalThis.fetch = async () => Response.json({ code: 200 });
    const sent = await worker.fetch(new Request('https://movecar.example/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"test","delayed":false}' }), env);
    assert.equal(sent.status, 200);
    const cookie = sent.headers.get('Set-Cookie');
    now += 30000;
    const waiting = await browser(env, cookie);
    assert.equal(waiting.element('mainView').style.display, 'none');
    assert.equal(waiting.element('successView').style.display, 'flex');
    assert.equal(waiting.element('locationTipModal').classList.contains('show'), false);
    assert.equal(waiting.element('followUpActions').innerHTML, '');
    assert.equal(waiting.timers[0].delay, 30000);
    assert.equal(waiting.intervals.size, 1);
    assert.equal(waiting.calls.includes('/api/notify'), false);

    const confirmed = await worker.fetch(new Request('https://movecar.example/api/owner-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"location":{"lat":31.2,"lng":121.5}}' }), env);
    assert.equal(confirmed.status, 200);
    await [...waiting.intervals.values()][0].fn();
    assert.equal(waiting.element('ownerFeedback').classList.contains('hidden'), false);
    assert.equal(waiting.element('waitingText').innerText, '车主已确认，正在赶来');
    assert.match(waiting.element('ownerAmapLink').href, /^https:\/\/uri.amap.com/);

    now = start + 60001;
    const afterMinute = await browser(env, cookie);
    assert.equal(afterMinute.element('ownerFeedback').classList.contains('hidden'), false);
    assert.equal(afterMinute.timers[0].delay, 0);
    await afterMinute.timers[0].fn();
    assert.match(afterMinute.element('followUpActions').innerHTML, /tel:15500000000/);
    assert.equal(afterMinute.calls.includes('/api/notify'), false);

    now = start + 900000;
    const expired = await browser(env, cookie);
    assert.equal(expired.element('locationTipModal').classList.contains('show'), true);
    assert.equal(expired.element('mainView').style.visibility, 'visible');
    assert.equal(expired.intervals.size, 0);
    assert.equal(expired.timers.length, 0);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
