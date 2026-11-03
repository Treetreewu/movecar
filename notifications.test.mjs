import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverNotification, hasNotificationProvider } from './notifications.mjs';
import worker from './dist/_worker.js';

const notification = { message: '挪车请求\\n请挪车', confirmUrl: 'https://movecar.example/owner-confirm' };

test('ServerChan sends a confirmation link and checks application-level errors', async () => {
  const env = { SERVERCHAN_UID: '123', SERVERCHAN_SENDKEY: 'test-key' };
  await deliverNotification(env, notification, async (url, init) => {
    assert.equal(url, 'https://123.push.ft07.com/send/test-key.send');
    const body = JSON.parse(init.body);
    assert.ok(body.desp.includes('[查看并确认挪车](https://movecar.example/owner-confirm)'));
    assert.ok(body.desp.includes('\n请挪车'));
    return Response.json({ code: 0 });
  });
  await assert.rejects(deliverNotification(env, notification, async () => Response.json({ code: 400 })), /推送失败/);
});

test('PushPlus uses WeChat and does not treat HTTP 200 with provider failure as success', async () => {
  const env = { PUSHPLUS_TOKEN: 'test-token' };
  await deliverNotification(env, notification, async (url, init) => {
    assert.equal(url, 'https://www.pushplus.plus/send');
    assert.equal(JSON.parse(init.body).channel, 'wechat');
    return Response.json({ code: 200 });
  });
  await assert.rejects(deliverNotification(env, notification, async () => Response.json({ code: 401 })), /推送失败/);
});

test('Missing credentials return 503 without writing to KV', async () => {
  assert.equal(hasNotificationProvider({}), false);
  const response = await worker.fetch(new Request('https://movecar.example/api/notify', { method: 'POST' }), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
});

test('Concurrent requests keep their KV bindings isolated', async () => {
  const request = () => new Request('https://movecar.example/api/check-status');
  const env = status => ({ MOVE_CAR_STATUS: { get: async key => key === 'notify_status' ? status : null } });
  const responses = await Promise.all([worker.fetch(request(), env('waiting')), worker.fetch(request(), env('confirmed'))]);
  assert.equal((await responses[0].json()).status, 'waiting');
  assert.equal((await responses[1].json()).status, 'confirmed');
});
