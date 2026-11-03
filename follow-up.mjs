const encoder = new TextEncoder();
const COOKIE = '__Secure-movecar-session';
const TTL = 15 * 60 * 1000;

async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createFollowUpCookie(env, now = Date.now(), request) {
  if (!env.FOLLOW_UP_SECRET || !env.PHONE_NUMBER) return null;
  // Keep the first successful notification's deadline for this session.
  if (request && await readSession(request, env, now)) return null;
  const payload = btoa(JSON.stringify({ ready: now + 60000, expires: now + TTL, nonce: crypto.randomUUID() }));
  const signature = await crypto.subtle.sign('HMAC', await key(env.FOLLOW_UP_SECRET), encoder.encode(payload));
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
  return `${COOKIE}=${payload}.${hex}; Path=/api/; Max-Age=${TTL / 1000}; Secure; HttpOnly; SameSite=Strict`;
}

async function readSession(request, env, now) {
  try {
    const cookie = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
    const [payload, hex] = (cookie?.slice(COOKIE.length + 1) || '').split('.');
    if (!payload || !/^[a-f0-9]{64}$/.test(hex)) return null;
    const signature = Uint8Array.from(hex.match(/../g), value => parseInt(value, 16));
    if (!await crypto.subtle.verify('HMAC', await key(env.FOLLOW_UP_SECRET), signature, encoder.encode(payload))) return null;
    const session = JSON.parse(atob(payload));
    if (!Number.isFinite(session.ready) || !Number.isFinite(session.expires) || now >= session.expires) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(request, env, now = Date.now()) {
  const headers = { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie' };
  const session = await readSession(request, env, now);
  if (!session) return Response.json({ active: false }, { headers });
  const [status, ownerLocation] = await Promise.all([
    env.MOVE_CAR_STATUS.get('notify_status'),
    env.MOVE_CAR_STATUS.get('owner_location')
  ]);
  return Response.json({
    active: true,
    elapsedMs: Math.max(0, now - (session.ready - 60000)),
    status: status || 'waiting',
    ownerLocation: status === 'confirmed' && ownerLocation ? JSON.parse(ownerLocation) : null
  }, { headers });
}

export async function getFollowUp(request, env, now = Date.now()) {
  const reply = html => Response.json({ html }, { headers: { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie' } });
  if (request.method !== 'GET' || !env.FOLLOW_UP_SECRET || !env.PHONE_NUMBER) return reply('');
  try {
    const session = await readSession(request, env, now);
    if (!session || now < session.ready) return reply('');
    const phone = env.PHONE_NUMBER.trim();
    if (!/^\+?\d{6,15}$/.test(phone)) return reply('');
    return reply(`<a href="tel:${phone}" class="btn-secondary"><span>📞</span><span>直接打电话</span></a>`);
  } catch {
    return reply('');
  }
}
