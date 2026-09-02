const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: "1h"
}));

// Server-side image proxy makes the Download button reliable and avoids browser CORS issues.
app.get("/api/download", (req, res) => {
  const raw = String(req.query.url || "");
  let target;
  try { target = new URL(raw); } catch { return res.status(400).send("Invalid image URL"); }

  if (target.hostname !== "i.ytimg.com" && target.hostname !== "img.youtube.com") {
    return res.status(403).send("Only YouTube thumbnail URLs are allowed.");
  }

  const request = https.get(target, {
    headers: { "User-Agent": "Mozilla/5.0" }
  }, upstream => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      return res.redirect("/api/download?url=" + encodeURIComponent(upstream.headers.location));
    }
    if (upstream.statusCode !== 200) {
      upstream.resume();
      return res.status(502).send("Could not fetch thumbnail.");
    }
    res.setHeader("Content-Type", upstream.headers["content-type"] || "image/jpeg");
    res.setHeader("Content-Disposition", 'attachment; filename="youtube-thumbnail.jpg"');
    upstream.pipe(res);
  });

  request.on("error", () => {
    if (!res.headersSent) res.status(502).send("Download failed.");
  });
});

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`YT Thumbnail Downloader running at http://localhost:${PORT}`));
