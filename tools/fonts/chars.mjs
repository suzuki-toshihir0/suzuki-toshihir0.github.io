// ページに出る文字を、同梱するフォントごとに集めて tools/fonts/chars.json に書く（npm run fonts の前半）
// JA・EN の両方で、planner と共著の一覧を開いた状態を描き、各文字を描く要素の書体と太さで振り分ける
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve, CHROME } from "../../test/server.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "chars.json");
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");
// 描いてみても拾えない文字: CSS の content（▸▾）、グラフ（canvas）の目盛り、planner の値で場合によって出る文字
const EXTRA_MONO = "▸▾−+°′→✕❯";

const sets = { "mplus-400": new Set(ASCII), "mplus-700": new Set(ASCII), jbm: new Set(ASCII + EXTRA_MONO) };
const srv = await serve();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
for (const lang of ["ja", "en"]) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument((l) => localStorage.setItem("lang", l), lang);
  await page.goto(srv.url, { waitUntil: "networkidle0" });
  await page.click("#caret");
  await new Promise((r) => setTimeout(r, 300));
  const runs = await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const el = w.currentNode.parentElement, cs = getComputedStyle(el);
      if (cs.display === "none" || el.closest("[hidden]")) continue;
      out.push({ text: w.currentNode.textContent, mono: /^"?JetBrains Mono/.test(cs.fontFamily), bold: Number(cs.fontWeight) >= 600 });
    }
    return out;
  });
  for (const { text, mono, bold } of runs) for (const c of text) {
    if (/[\n\r\t]/.test(c)) continue;   // 全角スペースや改行しない空白は描くので残す
    // 等幅の欄でも JetBrains Mono に無い文字（日本語）は M PLUS 1p で描くので、そちらにも入れる
    sets[bold ? "mplus-700" : "mplus-400"].add(c);
    if (mono) sets.jbm.add(c);
  }
  await ctx.close();
}
await browser.close();
await srv.close();
const json = Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, [...s].sort().join("")]));
fs.writeFileSync(OUT, JSON.stringify(json, null, 2) + "\n");
for (const [k, v] of Object.entries(json)) console.log(`${k}: ${[...v].length} 文字`);
