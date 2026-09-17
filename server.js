const express = require('express');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { fetchTranscript } = require('youtube-transcript');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const SITE_URL = 'https://thumbgrab.sbs';

if (!ADMIN_PASSWORD || !SESSION_SECRET || !MONGODB_URI) {
  console.warn('Missing ADMIN_PASSWORD, SESSION_SECRET or MONGODB_URI environment variable. Admin/article database features will not work until configured.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false, limit: '8mb' }));

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  description: { type: String, required: true, trim: true, maxlength: 320 },
  author: { type: String, default: 'ThumbGrab Team', trim: true, maxlength: 80 },
  category: { type: String, default: 'YouTube', trim: true, maxlength: 60 },
  image: { type: String, default: '' },
  content: { type: String, required: true },
  published: { type: Boolean, default: true },
  publishedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });
const Article = mongoose.models.Article || mongoose.model('Article', articleSchema);

let dbReady = false;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => { dbReady = true; console.log('MongoDB connected'); })
    .catch(err => console.error('MongoDB connection error:', err.message));
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET || 'missing-secret').update(value).digest('hex');
}
function makeSession(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function validSession(token) {
  try {
    if (!token) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.u === ADMIN_USERNAME && data.exp > Date.now();
  } catch { return false; }
}
function isAdmin(req) {
  return validSession(req.cookies?.thumbgrab_admin);
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function slugify(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}
function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function sanitizeArticleHtml(html='') {
  let out = String(html);
  out = out.replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[^>]*\/?>/gi, '');
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/javascript\s*:/gi, '');
  out = out.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
    const src = (attrs.match(/src\s*=\s*[\"']([^\"']+)[\"']/i) || [,''])[1];
    const alt = (attrs.match(/alt\s*=\s*[\"']([^\"']*)[\"']/i) || [,''])[1];
    if (!(/^(?:https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(src))) return '';
    return `<img src=\"${escapeHtml(src)}\" alt=\"${escapeHtml(alt)}\" loading=\"lazy\">`;
  });
  out = out.replace(/<\/?figure\b[^>]*>/gi, m => m.toLowerCase().startsWith('</') ? '</figure>' : '<figure class=\"blog-image\">');
  out = out.replace(/<\/?figcaption\b[^>]*>/gi, m => m.toLowerCase().startsWith('</') ? '</figcaption>' : '<figcaption>');
  out = out.replace(/<hr\b[^>]*>/gi, '<hr>');
  out = out.replace(/<blockquote\b[^>]*>/gi, '<blockquote>');
  out = out.replace(/<\/blockquote>/gi, '</blockquote>');
  out = out.replace(/<a([^>]*)>/gi, (m, attrs) => {
    const href = (attrs.match(/href\s*=\s*["']([^"']+)["']/i) || [,''])[1];
    if (!/^https?:\/\//i.test(href)) return '<a>';
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
  });
  return out;
}

// Lightweight cookie parser; avoids another dependency.
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
  });
  next();
});


function extractYouTubeId(value='') {
  try {
    const u = new URL(String(value).trim());
    const host = u.hostname.replace(/^www\./,'').toLowerCase();
    if (host === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || null;
    if (['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      if (['shorts','embed','live','v'].includes(parts[0])) return parts[1] || null;
    }
  } catch {}
  return null;
}
function formatTranscriptTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}
const transcriptLanguageNames = new Intl.DisplayNames(['en'], { type: 'language' });
function languageName(code='') {
  try { return transcriptLanguageNames.of(code) || code; } catch { return code; }
}
async function youtubeOembed(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return {};
    const j = await r.json();
    return { title: j.title || '', author: j.author_name || '' };
  } catch { return {}; }
}

app.get('/api/transcript', async (req, res) => {
  const videoId = extractYouTubeId(req.query.url || '');
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'Please enter a valid public YouTube URL.' });
  const lang = String(req.query.lang || '').trim().slice(0, 20);
  try {
    const rows = await fetchTranscript(videoId, lang ? { lang } : undefined);
    const segments = rows.map((x) => ({ text: String(x.text || '').trim(), start: Number(x.offset || 0), duration: Number(x.duration || 0), timestamp: formatTranscriptTime(x.offset || 0) })).filter(x => x.text);
    if (!segments.length) return res.status(404).json({ error: 'No transcript text was found for this video.' });
    const detectedLang = rows[0]?.lang || lang || '';
    const meta = await youtubeOembed(videoId);
    res.json({ videoId, title: meta.title || 'YouTube Video', author: meta.author || '', language: detectedLang, languageName: languageName(detectedLang), languages: detectedLang ? [{ code: detectedLang, name: languageName(detectedLang) }] : [], segments });
  } catch (err) {
    const msg = String(err?.message || 'Transcript unavailable.');
    const match = msg.match(/Available languages:\s*([^\n]+)/i);
    const available = match ? match[1].split(',').map(x => x.trim()).filter(Boolean).map(code => ({ code, name: languageName(code) })) : [];
    if (available.length) return res.status(404).json({ error: 'This language is not available for the video.', languages: available });
    return res.status(502).json({ error: 'Transcript could not be loaded. The video may have no public captions, or YouTube may be temporarily limiting transcript requests.' });
  }
});

app.get('/admin.html', (req, res) => {
  if (!isAdmin(req)) return res.sendFile(path.join(PUBLIC, 'admin-login.html'));
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD || !SESSION_SECRET) return res.status(503).json({ error: 'Admin authentication is not configured.' });
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid username or password.' });
  res.setHeader('Set-Cookie', `thumbgrab_admin=${makeSession(username)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  res.setHeader('Set-Cookie', 'thumbgrab_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (_req, res) => res.json({ ok: true, username: ADMIN_USERNAME }));

app.get('/api/admin/articles', requireAdmin, async (_req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database is not connected yet.' });
  const articles = await Article.find().sort({ publishedAt: -1 }).lean();
  res.json(articles);
});

app.post('/api/admin/articles', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database is not connected yet.' });
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const author = String(req.body.author || 'ThumbGrab Team').trim().slice(0, 80) || 'ThumbGrab Team';
    const category = String(req.body.category || 'YouTube').trim().slice(0, 60) || 'YouTube';
    const image = String(req.body.image || '').trim();
    const content = sanitizeArticleHtml(req.body.content || '');
    if (!title || !description || !content) return res.status(400).json({ error: 'Title, description and article content are required.' });
    let slug = slugify(req.body.slug || title);
    if (!slug) return res.status(400).json({ error: 'A valid slug is required.' });
    const existing = await Article.findOne({ slug });
    if (existing) slug += '-' + Date.now().toString().slice(-6);
    const article = await Article.create({ title, slug, description, author, category, image, content, published: true });
    res.status(201).json(article);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/articles/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database is not connected yet.' });
  try {
    const data = {
      title: String(req.body.title || '').trim(),
      description: String(req.body.description || '').trim(),
      author: String(req.body.author || 'ThumbGrab Team').trim().slice(0, 80) || 'ThumbGrab Team',
      category: String(req.body.category || 'YouTube').trim().slice(0, 60) || 'YouTube',
      image: String(req.body.image || '').trim(),
      content: sanitizeArticleHtml(req.body.content || ''),
      updatedAt: new Date()
    };
    const article = await Article.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    res.json(article);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/articles/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database is not connected yet.' });
  try { await Article.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/articles', async (_req, res) => {
  if (!dbReady) return res.json([]);
  const articles = await Article.find({ published: true }, 'title slug description author category image publishedAt updatedAt').sort({ publishedAt: -1 }).lean();
  res.json(articles);
});

app.get('/article/:slug', async (req, res) => {
  if (!dbReady) return res.status(503).send('Blog is temporarily unavailable.');
  const article = await Article.findOne({ slug: req.params.slug, published: true }).lean();
  if (!article) return res.status(404).sendFile(path.join(PUBLIC, '404.html'));
  const related = await Article.find({ published: true, slug: { $ne: article.slug } }, 'title slug description image author category publishedAt').sort({ publishedAt: -1 }).limit(4).lean();
  const title = escapeHtml(article.title);
  const desc = escapeHtml(article.description);
  const author = escapeHtml(article.author || 'ThumbGrab Team');
  const category = escapeHtml(article.category || 'YouTube');
  const image = article.image && (/^https?:\/\//i.test(article.image) || /^data:image\//i.test(article.image)) ? article.image : `${SITE_URL}/logo.png`;
  const published = new Date(article.publishedAt || Date.now()).toISOString();
  const updated = new Date(article.updatedAt || article.publishedAt || Date.now()).toISOString();
  const relatedHtml = related.map(a => `<a class="related-post" href="/article/${encodeURIComponent(a.slug)}">${a.image ? `<img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.title)}" loading="lazy">` : ''}<div><span class="badge">${escapeHtml(a.category || 'YouTube')}</span><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.description)}</p></div></a>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ThumbGrab Blog</title><meta name="description" content="${desc}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${SITE_URL}/article/${encodeURIComponent(article.slug)}"><meta property="og:type" content="article"><meta property="og:title" content="${title} | ThumbGrab Blog"><meta property="og:description" content="${desc}"><meta property="og:url" content="${SITE_URL}/article/${encodeURIComponent(article.slug)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="article:published_time" content="${published}"><meta property="article:modified_time" content="${updated}"><link rel="icon" type="image/png" href="/logo.png"><link rel="stylesheet" href="/style.css"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'Article','headline':article.title,'description':article.description,'image':[image],'datePublished':published,'dateModified':updated,'author':{'@type':'Person','name':article.author || 'ThumbGrab Team'},'publisher':{'@type':'Organization','name':'ThumbGrab','logo':{'@type':'ImageObject','url':`${SITE_URL}/logo.png`}},'mainEntityOfPage':`${SITE_URL}/article/${article.slug}`})}</script></head><body><header class="nav"><a class="brand" href="/"><img class="brand-logo" src="/logo.png" alt="ThumbGrab Logo"><span>ThumbGrab</span></a><nav><a href="/">Downloader</a><a href="/articles.html">Blog</a><a href="/youtube-thumbnail-size.html">Sizes</a><a href="/faq.html">FAQ</a><button id="themeToggle" class="theme-toggle" type="button">◐ Theme</button></nav></header><main class="wrap blog-post-page"><div class="blog-post-layout"><article class="blog-post"><div class="post-header"><span class="eyebrow">${category}</span><h1>${title}</h1><p class="post-excerpt">${desc}</p><div class="post-meta"><span>By <strong>${author}</strong></span><span>•</span><time datetime="${published}">${new Date(article.publishedAt || Date.now()).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</time>${article.updatedAt ? `<span>•</span><span>Updated ${new Date(article.updatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>` : ''}</div></div>${article.image ? `<figure class="post-cover"><img src="${escapeHtml(article.image)}" alt="${title}" loading="eager"></figure>` : ''}<div class="article-body">${article.content}</div><div class="post-footer"><a class="text-link" href="/articles.html">← Back to Blog</a><a class="primary post-tool" href="/">Try ThumbGrab</a></div></article><aside class="post-sidebar"><div class="sidebar-card sticky-card"><span class="eyebrow">THUMBGRAB</span><h2>More from the blog</h2><p>Explore more YouTube guides and creator tips.</p><a class="text-link" href="/articles.html">View all posts →</a></div><div class="sidebar-card"><span class="eyebrow">RELATED POSTS</span><div class="related-list">${relatedHtml || '<p class="muted">More posts coming soon.</p>'}</div></div></aside></div></main><footer class="footer"><span>© 2026 ThumbGrab</span><a href="/articles.html">ThumbGrab Blog</a></footer><script src="/theme.js"></script></body></html>`;
  res.type('html').send(html);
});

app.get('/sitemap.xml', async (_req, res) => {
  let articleUrls = '';
  if (dbReady) {
    const articles = await Article.find({ published: true }, 'slug updatedAt').lean();
    articleUrls = articles.map(a => `<url><loc>${SITE_URL}/article/${a.slug}</loc><lastmod>${new Date(a.updatedAt).toISOString()}</lastmod></url>`).join('');
  }
  const urls = [
    '/', '/youtube-thumbnail-downloader.html', '/how-to-download-youtube-thumbnail.html', '/youtube-thumbnail-size.html', '/thumbnail-size-checker.html', '/faq.html', '/about.html', '/privacy.html', '/terms.html', '/articles.html', '/youtube-transcript.html'
  ].map(p => `<url><loc>${SITE_URL}${p}</loc></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}${articleUrls}</urlset>`);
});

app.get('/api/download', (req, res) => {
  let u;
  try { u = new URL(String(req.query.url || '')); } catch { return res.status(400).send('Invalid image URL.'); }
  if (!['i.ytimg.com', 'img.youtube.com'].includes(u.hostname)) return res.status(403).send('Only YouTube thumbnail URLs are allowed.');
  const request = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, upstream => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) { upstream.resume(); return res.redirect('/api/download?url=' + encodeURIComponent(upstream.headers.location)); }
    if (upstream.statusCode !== 200) { upstream.resume(); return res.status(502).send('Could not fetch thumbnail.'); }
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="youtube-thumbnail.jpg"');
    upstream.pipe(res);
  });
  request.setTimeout(15000, () => request.destroy(new Error('timeout')));
  request.on('error', () => { if (!res.headersSent) res.status(502).send('Download failed. Please try again.'); });
});

app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`ThumbGrab running on port ${PORT}`));
