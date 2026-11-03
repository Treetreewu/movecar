import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createFollowUpCookie, getFollowUp } from './follow-up.mjs';
import worker from './dist/_worker.js';

const env = { PHONE_NUMBER: '15500000000', FOLLOW_UP_SECRET: 'test-only-secret-long-random-value', PUSHPLUS_TOKEN: 'test', MOVE_CAR_STATUS: { put: async () => {}, get: async () => null } };
const start = 1800000000000;
const request = cookie => new Request('https://movecar.example/api/follow-up', { headers: cookie ? { Cookie: cookie.split(';')[0] } : {} });

test('No phone capability is disclosed before exactly 60 seconds; sessions expire', async () => {
  const cookie = await createFollowUpCookie(env, start);
  assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
  for (const now of [start, start + 59999, start + 900000]) {
    const response = await getFollowUp(request(cookie), env, now);
    assert.deepEqual(await response.json(), { html: '' });
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  const response = await getFollowUp(request(cookie), env, start + 60000);
  assert.match((await response.json()).html, /href="tel:15500000000"/);
  assert.deepEqual(await (await getFollowUp(request(), env, start + 60000)).json(), { html: '' });
});

test('Tampering with ready time, malformed cookies, and other signing keys reveal nothing', async () => {
  const cookie = await createFollowUpCookie(env, start);
  const [nameAndPayload, signature] = cookie.split(';')[0].split('.');
  const split = nameAndPayload.indexOf('=');
  const payload = JSON.parse(atob(nameAndPayload.slice(split + 1)));
  payload.ready = 0;
  const forged = nameAndPayload.slice(0, split + 1) + btoa(JSON.stringify(payload)) + '.' + signature;
  for (const candidate of [forged, '__Secure-movecar-session=garbage', await createFollowUpCookie({ ...env, FOLLOW_UP_SECRET: 'another-secret' }, start)]) {
    assert.deepEqual(await (await getFollowUp(request(candidate), env, start + 60000)).json(), { html: '' });
  }
});

test('Initial HTML, scripts, and API response do not reveal the phone capability', async () => {
  const html = await (await worker.fetch(new Request('https://movecar.example/'), env)).text();
  assert.doesNotMatch(html, /15500000000|tel:|PHONE_NUMBER|phone|电话|手机号|拨号|📞/i);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), { html: '' });
});

test('Only successful notification delivery issues a session; the 60 seconds start after delivery', async () => {
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  const notify = cookie => new Request('https://movecar.example/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie.split(';')[0] } : {}) }, body: JSON.stringify({ message: 'test', delayed: false }) });
  try {
    let currentTime = start;
    Date.now = () => currentTime;
    globalThis.fetch = async () => { currentTime += 5000; return Response.json({ code: 200 }); };
    const response = await worker.fetch(notify(), env);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('Set-Cookie');
    assert.ok(cookie);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(await (await getFollowUp(request(cookie), env, start + 64999)).json(), { html: '' });
    assert.match((await (await getFollowUp(request(cookie), env, start + 65000)).json()).html, /tel:/);
    currentTime = start + 30000;
    const retry = await worker.fetch(notify(cookie), env);
    assert.equal(retry.status, 200);
    assert.equal(retry.headers.get('Set-Cookie'), null);
    assert.deepEqual(await (await getFollowUp(request(cookie), env, start + 64999)).json(), { html: '' });
    assert.match((await (await getFollowUp(request(cookie), env, start + 65000)).json()).html, /tel:/);
    currentTime = start + 70000;
    const laterRetry = await worker.fetch(notify(cookie), env);
    assert.equal(laterRetry.headers.get('Set-Cookie'), null);
    assert.match((await (await getFollowUp(request(cookie), env, currentTime)).json()).html, /tel:/);
    globalThis.fetch = async () => Response.json({ code: 401 });
    const failure = await worker.fetch(notify(), env);
    assert.equal(failure.status, 500);
    assert.equal(failure.headers.get('Set-Cookie'), null);
  } finally {
    globalThis.fetch = previousFetch;
    Date.now = previousNow;
  }
});

test('Retry preserves the browser timer and the action once visible, even on failure', async () => {
  const html = await (await worker.fetch(new Request('https://movecar.example/'), env)).text();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const elements = new Map();
  const timers = [];
  let successful = true;
  const context = vm.createContext({
    window: {},
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', replaceChildren() { this.innerHTML = ''; } }); return elements.get(id); } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() { throw new Error('Retry must not clear the original timer'); },
    fetch: async url => url === '/api/follow-up' ? { json: async () => ({ html: '<a>available action</a>' }) } : { ok: successful }
  });
  vm.runInContext(script + '\nshowToast = () => {}; scheduleFollowUp();', context);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 60000);
  await vm.runInContext('retryNotify()', context);
  assert.equal(timers.length, 1);
  await timers[0].fn();
  assert.equal(elements.get('followUpActions').innerHTML, '<a>available action</a>');
  for (successful of [true, false]) {
    await vm.runInContext('retryNotify()', context);
    assert.equal(elements.get('followUpActions').innerHTML, '<a>available action</a>');
    assert.equal(timers.length, 1);
  }
});
