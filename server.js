const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '1h' }));

app.get('/api/download', (req, res) => {
  let u;
  try { u = new URL(String(req.query.url || '')); }
  catch { return res.status(400).send('Invalid image URL.'); }

  if (!['i.ytimg.com', 'img.youtube.com'].includes(u.hostname)) {
    return res.status(403).send('Only YouTube thumbnail URLs are allowed.');
  }

  const request = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, upstream => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      upstream.resume();
      return res.redirect('/api/download?url=' + encodeURIComponent(upstream.headers.location));
    }
    if (upstream.statusCode !== 200) {
      upstream.resume();
      return res.status(502).send('Could not fetch thumbnail.');
    }
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="youtube-thumbnail.jpg"');
    upstream.pipe(res);
  });

  request.setTimeout(15000, () => request.destroy(new Error('timeout')));
  request.on('error', () => {
    if (!res.headersSent) res.status(502).send('Download failed. Please try again.');
  });
});

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`ThumbGrab running on port ${PORT}`));
