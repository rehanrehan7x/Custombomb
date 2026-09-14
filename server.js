const express = require('express');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');

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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  description: { type: String, required: true, trim: true, maxlength: 320 },
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
    const image = String(req.body.image || '').trim();
    const content = sanitizeArticleHtml(req.body.content || '');
    if (!title || !description || !content) return res.status(400).json({ error: 'Title, description and article content are required.' });
    let slug = slugify(req.body.slug || title);
    if (!slug) return res.status(400).json({ error: 'A valid slug is required.' });
    const existing = await Article.findOne({ slug });
    if (existing) slug += '-' + Date.now().toString().slice(-6);
    const article = await Article.create({ title, slug, description, image, content, published: true });
    res.status(201).json(article);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/articles/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database is not connected yet.' });
  try {
    const data = {
      title: String(req.body.title || '').trim(),
      description: String(req.body.description || '').trim(),
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
  const articles = await Article.find({ published: true }, 'title slug description image publishedAt').sort({ publishedAt: -1 }).lean();
  res.json(articles);
});

app.get('/article/:slug', async (req, res) => {
  if (!dbReady) return res.status(503).send('Articles are temporarily unavailable.');
  const article = await Article.findOne({ slug: req.params.slug, published: true }).lean();
  if (!article) return res.status(404).sendFile(path.join(PUBLIC, '404.html'));
  const title = escapeHtml(article.title);
  const desc = escapeHtml(article.description);
  const image = article.image && /^https?:\/\//i.test(article.image) ? article.image : `${SITE_URL}/logo.png`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ThumbGrab</title><meta name="description" content="${desc}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${SITE_URL}/article/${encodeURIComponent(article.slug)}"><meta property="og:type" content="article"><meta property="og:title" content="${title} | ThumbGrab"><meta property="og:description" content="${desc}"><meta property="og:url" content="${SITE_URL}/article/${encodeURIComponent(article.slug)}"><meta property="og:image" content="${escapeHtml(image)}"><link rel="icon" type="image/png" href="/logo.png"><link rel="stylesheet" href="/style.css"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'Article','headline':article.title,'description':article.description,'image':[image],'datePublished':article.publishedAt,'dateModified':article.updatedAt,'author':{'@type':'Organization','name':'ThumbGrab'},'publisher':{'@type':'Organization','name':'ThumbGrab','logo':{'@type':'ImageObject','url':`${SITE_URL}/logo.png`}},'mainEntityOfPage':`${SITE_URL}/article/${article.slug}`})}</script></head><body><header class="nav"><a class="brand" href="/"><img class="brand-logo" src="/logo.png" alt="ThumbGrab Logo"><span>ThumbGrab</span></a><nav><a href="/">Downloader</a><a href="/articles.html">Articles</a><a href="/youtube-thumbnail-size.html">Sizes</a><a href="/faq.html">FAQ</a></nav></header><main class="wrap"><article class="article"><span class="eyebrow">YouTube Guide</span><h1>${title}</h1><p class="lead">${desc}</p>${article.image ? `<img class="article-cover" src="${escapeHtml(article.image)}" alt="${title}" loading="eager">` : ''}<div class="article-body">${article.content}</div></article></main><footer class="footer"><span>© 2026 ThumbGrab</span><a href="/articles.html">More YouTube Articles</a></footer></body></html>`;
  res.type('html').send(html);
});

app.get('/sitemap.xml', async (_req, res) => {
  let articleUrls = '';
  if (dbReady) {
    const articles = await Article.find({ published: true }, 'slug updatedAt').lean();
    articleUrls = articles.map(a => `<url><loc>${SITE_URL}/article/${a.slug}</loc><lastmod>${new Date(a.updatedAt).toISOString()}</lastmod></url>`).join('');
  }
  const urls = [
    '/', '/youtube-thumbnail-downloader.html', '/how-to-download-youtube-thumbnail.html', '/youtube-thumbnail-size.html', '/thumbnail-size-checker.html', '/faq.html', '/about.html', '/privacy.html', '/terms.html', '/articles.html'
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
