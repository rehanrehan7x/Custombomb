const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SITE_URL = 'https://thumbgrab.sbs';

app.disable('x-powered-by');
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '1h' }));

function fetchImage(url, res, depth = 0) {
  if (depth > 2) return res.status(502).send('Could not fetch thumbnail.');
  let u;
  try { u = new URL(url); } catch { return res.status(400).send('Invalid thumbnail URL.'); }
  if (!['i.ytimg.com', 'img.youtube.com'].includes(u.hostname)) {
    return res.status(403).send('Only YouTube thumbnail URLs are allowed.');
  }
  const request = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, upstream => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      upstream.resume();
      return fetchImage(upstream.headers.location, res, depth + 1);
    }
    if (upstream.statusCode !== 200) {
      upstream.resume();
      return res.status(502).send('Could not fetch thumbnail.');
    }
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="youtube-thumbnail.jpg"');
    upstream.pipe(res);
  });
  request.setTimeout(12000, () => request.destroy());
  request.on('error', () => { if (!res.headersSent) res.status(502).send('Could not download thumbnail.'); });
}

app.get('/api/download', (req, res) => fetchImage(String(req.query.url || ''), res));

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_req, res) => {
  const urls = [
    '/',
    '/youtube-thumbnail-downloader.html',
    '/how-to-download-youtube-thumbnail.html',
    '/youtube-thumbnail-size.html',
    '/faq.html',
    '/privacy.html'
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE_URL}${u}</loc></url>`).join('')}</urlset>`;
  res.type('application/xml').send(xml);
});

app.listen(PORT, () => console.log(`ThumbGrab running on port ${PORT}`));
