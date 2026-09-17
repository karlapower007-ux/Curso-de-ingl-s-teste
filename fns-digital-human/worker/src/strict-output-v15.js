import core from './strict-output-v7.js';

// FNS OLIVIA V15 — final visual repair + quota-safe QA boundary.
// Production user traffic is delegated unchanged to strict-output-v7.
// Only explicit CI requests bearing X-FNS-QA-Mock: 1 are mocked.

const V15_GUARD = 'FNS-OLIVIA-V15-VISUAL-MOCK-GUARD';
const IMAGE_REPAIRS = Object.freeze({
  'https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/fns-digital-human/fns-digital-human/worker/public/assets/olivia-fechada.png': '/assets/olivia-fechada-v15.jpg',
  'https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/fns-digital-human/fns-digital-human/worker/public/assets/olivia-falando.png': '/assets/olivia-falando-v15.jpg',
  'https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/fns-digital-human/fns-digital-human/worker/public/assets/olivia-aberta.png': '/assets/olivia-aberta-v15.jpg'
});

function makeSilentWav(durationMs = 180, sampleRate = 8000) {
  const samples = Math.max(1, Math.floor(sampleRate * durationMs / 1000));
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

function mockResponse(request, pathname) {
  if (request.headers.get('X-FNS-QA-Mock') !== '1') return null;
  const common = {
    'Cache-Control': 'no-store',
    'X-FNS-QA-Mock': '1',
    'X-FNS-QA-Guard': V15_GUARD
  };
  if (pathname === '/tts') {
    return new Response(makeSilentWav(), {
      status: 200,
      headers: {
        ...common,
        'Content-Type': 'audio/wav',
        'X-FNS-Voice-Turbine': 'MOCK',
        'X-FNS-Voice-Language': 'es-ES'
      }
    });
  }
  if (pathname === '/chat') {
    return Response.json({ ok: true, reply: 'Hola. Esta es una respuesta simulada de QA en español.', mock: true }, { status: 200, headers: common });
  }
  if (pathname === '/stt') {
    return Response.json({ ok: true, text: 'Hola, Olivia.', language: 'es-ES', mock: true }, { status: 200, headers: common });
  }
  return null;
}

async function repairOliviaHtml(response) {
  if (!(response instanceof Response)) return response;
  const type = response.headers.get('Content-Type') || '';
  if (!/text\/html/i.test(type)) return response;
  let html = await response.text();
  for (const [broken, fixed] of Object.entries(IMAGE_REPAIRS)) html = html.split(broken).join(fixed);
  html = html
    .replaceAll('FNS-AVATAR-FACTORY-V14', 'FNS-AVATAR-FACTORY-V15')
    .replaceAll('v14-20260917', 'v15-20260917');
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Content-Language', 'es-ES');
  headers.set('X-FNS-V15-Guard', V15_GUARD);
  headers.set('X-FNS-V15-Images', 'same-origin-jpeg-repair');
  return new Response(html, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mocked = mockResponse(request, url.pathname);
    if (mocked) return mocked;

    const response = await core.fetch(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/' && String(url.searchParams.get('avatar') || '').toLowerCase() === 'olivia') {
      return repairOliviaHtml(response);
    }
    return response;
  }
};

export { V15_GUARD, IMAGE_REPAIRS, makeSilentWav };
