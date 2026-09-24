export const config = { runtime: 'nodejs' };

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

const RELAYS = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`
];

const SKIP_DOMAINS = ['sfl.gl','safelink','shortlink','bit.ly','tinyurl','adf.ly'];

function withTimeout(p, ms){
  return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))]);
}

function resolveRedirects(html, baseUrl){
  const out = [];
  const push = u => { try{ out.push(new URL(u, baseUrl).toString()); }catch{} };

  let m;
  const metaRe = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"'>]*url=([^"'>\s]+)/gi;
  while((m = metaRe.exec(html))) push(m[1]);

  const jsRes = [
    /(?:window|document)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /location\.replace\(\s*["']([^"']+)["']\s*\)/gi,
    /location\.assign\(\s*["']([^"']+)["']\s*\)/gi
  ];
  for(const re of jsRes){ while((m = re.exec(html))) push(m[1]); }

  // buang domain shortener dari hasil
  return [...new Set(out)].filter(u => {
    try { const h = new URL(u).hostname; return !SKIP_DOMAINS.some(d => h.includes(d)); }
    catch { return false; }
  });
}

function isInterstitial(html){
  const text = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  const len = text.length;
  const bad = ['please wait','mohon tunggu','get link','dapatkan link','redirecting','memverifikasi','verifying','sfl.gl','shortlink','lanjutkan'];
  let hits = 0;
  for(const b of bad) if(text.includes(b)) hits++;
  return len < 800 || (hits >= 2 && len < 2000);
}

function extract(html){
  let title = '';
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t  = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  title = (og?.[1] || h1?.[1] || t?.[1] || 'Tanpa Judul').replace(/<[^>]+>/g,'').trim();

  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+class=["'][^"']*(post-content|entry-content|td-post-content|article-content|post-body|content-area|single-content|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/(?:div|article|section)>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i
  ];
  let body = '';
  for(const p of patterns){
    const m = html.match(p);
    if(m){
      const c = m[m.length-1];
      if(c && c.replace(/<[^>]+>/g,'').trim().length > 300){ body = c; break; }
    }
  }
  if(!body){ const bm = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i); body = bm?bm[1]:html; }

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi,'')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi,'')
    .replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<div[^>]+(class|id)=["'][^"']*(ad|ads|advert|popup|overlay|banner)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,'');

  return { title, body };
}

async function tryFetch(url, referer){
  const headers = { ...BROWSER_HEADERS };
  if(referer) headers['Referer'] = referer;

  // direct
  try{
    const r = await withTimeout(fetch(url, { headers, redirect: 'follow' }), 9000);
    if(r.ok){ return { html: await r.text(), url: r.url || url, via: 'direct' }; }
  }catch{}

  // relay
  for(const relay of RELAYS){
    try{
      const r = await withTimeout(fetch(relay(url), { headers, redirect: 'follow' }), 12000);
      if(!r.ok) continue;
      const html = await r.text();
      if(!html || html.length < 100) continue;
      return { html, url, via: 'relay' };
    }catch{ continue; }
  }
  return null;
}

async function fetchDeep(startUrl, maxHops = 5){
  let current = startUrl;
  let referer = null;
  const visited = new Set();

  for(let i = 0; i < maxHops; i++){
    if(visited.has(current)) break;
    visited.add(current);

    const r = await tryFetch(current, referer);
    if(!r) return null;

    if(!isInterstitial(r.html)){
      return r;
    }

    const nexts = resolveRedirects(r.html, r.url);
    if(nexts.length === 0) return r;

    referer = r.url;
    current = nexts[0];
  }
  return null;
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if(req.method === 'OPTIONS') return res.status(200).end();

  const target = req.query.url;
  if(!target) return res.status(400).json({ error: 'Parameter url wajib diisi.' });

  let u;
  try { u = new URL(target); } catch { return res.status(400).json({ error: 'URL tidak valid.' }); }
  if(!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: 'Hanya http/https.' });

  try{
    const result = await fetchDeep(u.toString());
    if(!result) return res.status(502).json({ error: 'Semua jalur gagal. Sfl atau target memblokir.' });

    const { title, body } = extract(result.html);
    const plainLen = body.replace(/<[^>]+>/g,'').trim().length;

    if(plainLen < 200){
      return res.status(502).json({
        error: 'Konten terlalu pendek / selector nggak match.',
        via: result.via,
        url: result.url,
        preview: result.html.slice(0, 500)
      });
    }

    return res.status(200).json({
      ok: true,
      via: result.via,
      source: result.url,
      title,
      html: body
    });
  }catch(err){
    return res.status(500).json({ error: 'Gagal: ' + err.message });
  }
}
