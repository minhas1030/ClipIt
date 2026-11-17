export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 1. Multi-Engine Video Link Resolver (/api/resolve?url=...)
    if (url.pathname === '/api/resolve') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return jsonResponse({ error: 'Missing url parameter' }, 400);

      try {
        let resolvedStream = null;
        let resolvedTitle = 'Viral_Web_Video';

        // Extract YouTube Video ID if YouTube URL
        const ytMatch = targetUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          const videoId = ytMatch[1];

          // Engine A: Open Piped API instances (returns direct muxed MP4 streams)
          const pipedInstances = [
            'https://pipedapi.kavin.rocks',
            'https://pipedapi.tokhmi.xyz',
            'https://pipedapi.moomoo.me',
            'https://api.piped.yt'
          ];

          for (const base of pipedInstances) {
            try {
              const r = await fetch(`${base}/streams/${videoId}`, {
                headers: { 'User-Agent': 'ClipIT-Studio/3.0' }
              });
              if (!r.ok) continue;
              const info = await r.json();
              if (info && Array.isArray(info.videoStreams)) {
                const muxed = info.videoStreams.find(s => !s.videoOnly && s.mimeType && s.mimeType.includes('mp4'))
                  || info.videoStreams.find(s => s.mimeType && s.mimeType.includes('mp4'));
                if (muxed && muxed.url) {
                  resolvedStream = muxed.url;
                  resolvedTitle = (info.title || 'YouTube_Clip').slice(0, 48);
                  break;
                }
              }
            } catch (e) {}
          }

          // Engine B: Open Invidious API instances
          if (!resolvedStream) {
            const invInstances = [
              'https://inv.nadeko.net',
              'https://invidious.nerdvpn.de',
              'https://iv.ggtyler.dev'
            ];
            for (const base of invInstances) {
              try {
                const r = await fetch(`${base}/api/v1/videos/${videoId}`, {
                  headers: { 'User-Agent': 'ClipIT-Studio/3.0' }
                });
                if (!r.ok) continue;
                const info = await r.json();
                if (info && Array.isArray(info.formatStreams)) {
                  const mp4 = info.formatStreams.find(f => f.container === 'mp4') || info.formatStreams[0];
                  if (mp4 && mp4.url) {
                    resolvedStream = mp4.url;
                    resolvedTitle = (info.title || 'YouTube_Clip').slice(0, 48);
                    break;
                  }
                }
              } catch (e) {}
            }
          }
        }

        // Engine C: Cobalt API Fallback (TikTok, Instagram, X, or YouTube)
        if (!resolvedStream) {
          const cobaltNodes = [
            'https://api.cobalt.tools/',
            'https://cobalt-api.kwiatekmiki.com/',
            'https://cobalt.api.timelessnesses.me/'
          ];
          for (const node of cobaltNodes) {
            try {
              const resp = await fetch(node, {
                method: 'POST',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'User-Agent': 'ClipIT-Studio/3.0'
                },
                body: JSON.stringify({ url: targetUrl, videoQuality: '720', filenameStyle: 'basic' })
              });
              if (!resp.ok) continue;
              const data = await resp.json();
              if (data && data.url) {
                resolvedStream = data.url;
                if (data.filename) resolvedTitle = data.filename.replace(/\.[^/.]+$/, '');
                break;
              }
            } catch (e) {}
          }
        }

        if (!resolvedStream) {
          return jsonResponse({
            error: 'YouTube/Social node rate-limited this link. Upload the MP4 file directly for instant 60FPS slicing!'
          }, 502);
        }

        const proxiedUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(resolvedStream)}`;
        return jsonResponse({ streamUrl: proxiedUrl, title: resolvedTitle });
      } catch (err) {
        return jsonResponse({ error: err.message || 'Resolution failed' }, 500);
      }
    }

    // 2. CORS Range Video Stream Proxy (/api/proxy?url=...)
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

    // 3. Static Pages Assets
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
