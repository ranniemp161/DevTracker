const mediaPath = /^\/task-media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

async function authorized(url, secret) {
  const expires = url.searchParams.get('expires') ?? '';
  const signature = url.searchParams.get('signature') ?? '';
  if (!secret || !/^\d{10}$/.test(expires) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(expires) <= now || Number(expires) > now + 900) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = Uint8Array.from(signature.match(/../g), (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    encoder.encode(`${url.pathname.slice(1)}:${expires}`),
  );
}

function readRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(offset) || offset > end) return null;
  return { offset, length: end - offset + 1 };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const privateHeaders = { 'Cache-Control': 'private, no-store' };
    if (request.method !== 'GET')
      return new Response(null, { status: 405, headers: privateHeaders });
    if (!mediaPath.test(url.pathname) || !(await authorized(url, env.TASK_MEDIA_CDN_SECRET))) {
      return new Response(null, { status: 404, headers: privateHeaders });
    }

    const key = url.pathname.slice(1);
    const rangeHeader = request.headers.get('Range');
    const cacheKey = new Request(new URL(url.pathname, url.origin));
    const cached = rangeHeader ? null : await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('Cache-Control', privateHeaders['Cache-Control']);
      return new Response(cached.body, { headers });
    }

    let range;
    if (rangeHeader) {
      const head = await env.TASK_MEDIA.head(key);
      if (!head) return new Response(null, { status: 404, headers: privateHeaders });
      range = readRange(rangeHeader, head.size);
      if (!range)
        return new Response(null, {
          status: 416,
          headers: { ...privateHeaders, 'Content-Range': `bytes */${head.size}` },
        });
    }
    const object = await env.TASK_MEDIA.get(key, range ? { range } : undefined);
    if (!object) return new Response(null, { status: 404, headers: privateHeaders });

    const headers = new Headers(privateHeaders);
    headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(range?.length ?? object.size));
    if (range) {
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      );
      return new Response(object.body, { status: 206, headers });
    }

    const response = new Response(object.body, { headers });
    if (headers.get('Content-Type').startsWith('image/')) {
      const edgeHeaders = new Headers(headers);
      edgeHeaders.set('Cache-Control', 'public, max-age=3600');
      const edgeResponse = new Response(response.clone().body, { headers: edgeHeaders });
      ctx.waitUntil(caches.default.put(cacheKey, edgeResponse));
    }
    return response;
  },
};
