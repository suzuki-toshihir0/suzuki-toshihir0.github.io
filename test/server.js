// テスト用の小さな静的サーバー。リポジトリの直下を、GitHub Pages と同じように配る
// 単独で動かすと手元での確認用（npm run serve → http://localhost:8000/）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };

export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((d) => server.close(d)) })));
}

// Chrome の実行ファイル: CHROME で指定するか、PATH の google-chrome / chromium を探す
export const CHROME = process.env.CHROME || ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
  .map((n) => (process.env.PATH || "").split(":").map((d) => path.join(d, n)).find((f) => fs.existsSync(f))).find(Boolean);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve(Number(process.env.PORT || 8000));
  console.log(url);
}
