export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 1. API Endpoint: Resolve YouTube / TikTok / Instagram URLs into CORS-enabled MP4 stream
    if (url.pathname === '/api/resolve') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing url parameter' }, 400);
      }

      try {
        // Query open Cobalt-compatible extraction nodes
        const cobaltNodes = [
          'https://api.cobalt.tools/',
          'https://cobalt-api.kwiatekmiki.com/',
          'https://cobalt.api.timelessnesses.me/'
        ];

        let resolvedStream = null;
        let resolvedTitle = 'Viral_Web_Video';

        for (const node of cobaltNodes) {
          try {
            const resp = await fetch(node, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'ClipIT-Studio/2.0'
              },
              body: JSON.stringify({
                url: targetUrl,
                videoQuality: '720',
                filenameStyle: 'basic'
              })
            });
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data && data.url) {
              resolvedStream = data.url;
              if (data.filename) resolvedTitle = data.filename.replace(/\.[^/.]+$/, '');
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!resolvedStream) {
          return jsonResponse({
            error: 'Upstream extractor busy. Please upload the MP4 file directly or retry in a moment.'
          }, 502);
        }

        // Route the resolved stream through /api/proxy so Canvas 2D & Web Audio have full CORS access
        const proxiedUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(resolvedStream)}`;
        return jsonResponse({ streamUrl: proxiedUrl, title: resolvedTitle });
      } catch (err) {
        return jsonResponse({ error: err.message || 'Resolution failed' }, 500);
      }
    }

    // 2. API Endpoint: Stream Video Chunks with CORS Headers (Supports Range Scrubbing)
    if (url.pathname === '/api/proxy') {
      const mediaUrl = url.searchParams.get('url');
      if (!mediaUrl) return new Response('Missing url', { status: 400 });

      const proxyHeaders = new Headers();
      proxyHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      if (request.headers.has('Range')) {
        proxyHeaders.set('Range', request.headers.get('Range'));
      }

      const upstream = await fetch(mediaUrl, { headers: proxyHeaders });
      const respHeaders = new Headers(upstream.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders
      });
    }

    // 3. Serve Static Website Assets (index.html, robots.txt, sitemap.xml)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('ClipIT Worker Active', { status: 200 });
  }
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
