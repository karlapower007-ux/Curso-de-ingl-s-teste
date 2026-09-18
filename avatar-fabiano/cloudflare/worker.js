const RENDER_ORIGIN = 'https://avatar-fabiano-api.onrender.com';

function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

async function proxyToRender(request, url) {
  const target = new URL(url.pathname + url.search, RENDER_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set('Host', target.host);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-FNS-Frontend', 'avatar-fabiano-cloudflare-v1');

  const init = {
    method: request.method,
    headers,
    redirect: 'follow'
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  const upstream = await fetch(target.toString(), init);
  const outHeaders = new Headers(upstream.headers);
  outHeaders.set('Cache-Control', url.pathname.startsWith('/static/') ? 'public, max-age=300' : 'no-store');
  outHeaders.delete('access-control-allow-origin');
  outHeaders.delete('access-control-allow-credentials');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const asset = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
      return noStore(asset);
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      const asset = await env.ASSETS.fetch(new Request(new URL('/admin.html', url), request));
      return noStore(asset);
    }

    if (
      url.pathname === '/health' ||
      url.pathname === '/perguntar' ||
      url.pathname === '/admin/upload-pdf' ||
      url.pathname.startsWith('/static/') ||
      url.pathname.startsWith('/audio') ||
      url.pathname.startsWith('/audios/')
    ) {
      return proxyToRender(request, url);
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    return new Response('Not Found', {status: 404});
  }
};
