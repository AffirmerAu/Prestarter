// Minimal static server for manually re-running the acceptance-test fixtures
// in this directory (e.g. AT24's fullscreen-watermark.html) in a real browser.
// Usage: node serve.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const port = 4173;

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript" };

http
  .createServer((req, res) => {
    const reqPath = req.url === "/" ? "/fullscreen-watermark.html" : req.url.split("?")[0];
    const filePath = path.join(dir, reqPath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`acceptance-test fixtures on http://localhost:${port}`));
