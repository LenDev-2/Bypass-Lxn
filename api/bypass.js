// Vercel Serverless Function — proxy & parser
export const config = { runtime: 'nodejs' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function stripTags(html){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function extract(html){
  // judul
  let title = '';
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  title = (og?.[1] || h1?.[1] || t?.[1] || 'Tanpa Judul')
    .replace(/<[^>]+>/g, '').trim();

  // cari container konten
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+class=["'][^"']*(post-content|entry-content|td-post-content|article-content|post-body|content-area)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i
  ];

  let body = '';
  for(const p of patterns){
    const m = html.match(p);
    if(m){
      const candidate = m[m.length - 1];
      if(candidate && candidate.replace(/<[^>]+>/g,'').trim().length > 300){
        body = candidate; break;
      }
    }
  }
  if(!body){
    const bm = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    body = bm ? bm[1] : html;
  }

  body = stripTags(body);
  // buang elemen iklan/nav/footer umum
  body = body
    .replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<div[^>]+(class|id)=["'][^"']*(ad|ads|advert|popup|overlay|banner)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

  return { title, body };
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
    const r = await fetch(u.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
      },
      redirect: 'follow'
    });

    if(!r.ok) return res.status(502).json({ error: `Target merespons ${r.status}` });

    const html = await r.text();
    const { title, body } = extract(html);

    return res.status(200).json({
      ok: true,
      source: u.toString(),
      title,
      html: body
    });
  }catch(err){
    return res.status(500).json({ error: 'Gagal fetch: ' + err.message });
  }
}