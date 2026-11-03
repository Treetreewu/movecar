export function hasNotificationProvider(env) {
  return Boolean((env.SERVERCHAN_UID && env.SERVERCHAN_SENDKEY) || env.PUSHPLUS_TOKEN || env.BARK_URL);
}

export async function deliverNotification(env, { message, confirmUrl }, send = fetch) {
  const title = '挪车请求';
  const text = message.replaceAll('\\n', '\n');
  if (env.SERVERCHAN_UID && env.SERVERCHAN_SENDKEY) {
    if (!/^\d+$/.test(env.SERVERCHAN_UID)) throw new Error('Server酱 UID 配置无效');
    const response = await send(`https://${env.SERVERCHAN_UID}.push.ft07.com/send/${encodeURIComponent(env.SERVERCHAN_SENDKEY)}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desp: `${text}\n\n[查看并确认挪车](${confirmUrl})`, tags: 'MoveCar' })
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) throw new Error('Server酱推送失败，请联系车主检查配置或额度');
    return;
  }
  if (env.PUSHPLUS_TOKEN) {
    const response = await send('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: env.PUSHPLUS_TOKEN, title, content: `${text}\n\n[查看并确认挪车](${confirmUrl})`, template: 'markdown', channel: 'wechat' })
    });
    const result = await response.json();
    if (!response.ok || result.code !== 200) throw new Error('PushPlus 推送失败，请联系车主检查配置或额度');
    return;
  }
  if (env.BARK_URL) {
    const endpoint = new URL(`${env.BARK_URL.replace(/\/$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(text)}`);
    endpoint.search = new URLSearchParams({ group: 'MoveCar', level: 'critical', call: '1', sound: 'minuet', url: confirmUrl });
    const response = await send(endpoint);
    const result = await response.json();
    if (!response.ok || result.code !== 200) throw new Error('Bark 推送失败，请联系车主检查配置');
    return;
  }
  throw new Error('车主尚未配置推送通知，请稍后再试。');
}
