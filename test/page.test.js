// ページそのものの体裁と動作のテスト: 単独の HTML として正しいか、読み込みに失敗が無いか、
// 共有したときの情報（OGP）、言語の切り替え、planner の開閉と操作、背景の描画
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve, CHROME } from "./server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://suzuki-toshihir0.github.io/";
const isFont = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u);

let srv, browser;
before(async () => {
  srv = await serve();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); await srv?.close(); });

// ページを開く。読み込んだものの応答と、コンソールのエラーを集める。
// テストごとに保存領域（localStorage）を分け、前のテストで選んだ言語などが漏れないようにする
async function open({ js = true, lang = null, width = 1280 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const close = page.close.bind(page);
  page.close = async () => { await close(); await context.close(); };
  const errors = [], responses = [], failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => responses.push({ url: r.url(), status: r.status() }));
  page.on("requestfailed", (r) => failed.push(r.url()));
  await page.setJavaScriptEnabled(js);
  await page.setViewport({ width, height: 800 });
  if (lang) await page.evaluateOnNewDocument((l) => { try { localStorage.setItem("lang", l); } catch (e) {} }, lang);
  await page.goto(srv.url, { waitUntil: "networkidle0" });
  return { page, context, errors, responses, failed };
}

describe("単独の HTML としての体裁", () => {
  test("ファイルが <!doctype html> で始まり、標準モードで表示される", async () => {
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    assert.match(src, /^<!doctype html>/i);
    const { page } = await open();
    assert.equal(await page.evaluate(() => document.compatMode), "CSS1Compat");
    await page.close();
  });
  test("head に文字コード・表示幅・題名・説明・色がある", async () => {
    const { page } = await open();
    const h = await page.evaluate(() => ({
      charset: document.characterSet,
      viewport: document.querySelector('meta[name="viewport"]')?.content,
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.content,
      theme: document.querySelector('meta[name="theme-color"]')?.content,
      lang: document.documentElement.lang,
    }));
    assert.equal(h.charset, "UTF-8");
    assert.match(h.viewport || "", /width=device-width/);
    assert.equal(h.title, "Toshihiro Suzuki");
    assert.ok((h.desc || "").length >= 20, `説明: ${h.desc}`);
    assert.equal(h.theme, "#1e1e2e");
    assert.ok(["ja", "en"].includes(h.lang));
    await page.close();
  });
  test("共有したときの情報（OGP）がそろい、画像はこのサイトの中にある", async () => {
    const { page } = await open();
    const og = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')].map((m) => [m.getAttribute("property") || m.name, m.content])));
    for (const k of ["og:title", "og:description", "og:type", "og:url", "og:image", "twitter:card"]) assert.ok(og[k], `${k} が無い`);
    assert.equal(og["og:url"], SITE);
    assert.ok(og["og:image"].startsWith(SITE), `og:image がこのサイトの絶対 URL でない: ${og["og:image"]}`);
    assert.ok(fs.existsSync(path.join(ROOT, og["og:image"].slice(SITE.length))), `og:image のファイルが無い: ${og["og:image"]}`);
    await page.close();
  });
  test("favicon があり、読み込める", async () => {
    const { page } = await open();
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.href));
    assert.ok(hrefs.length >= 1, "favicon の link が無い");
    for (const h of hrefs) {
      const r = await page.evaluate(async (u) => (await fetch(u)).status, h);
      assert.equal(r, 200, h);
    }
    await page.close();
  });
});

describe("読み込みとリンク", () => {
  test("このサイトの中のものはすべて読み込め、コンソールにエラーが出ない", async () => {
    const { page, errors, responses, failed } = await open();
    await new Promise((r) => setTimeout(r, 500));
    const bad = responses.filter((r) => r.url.startsWith(srv.url) && r.status >= 400).map((r) => `${r.status} ${r.url}`);
    assert.deepEqual(bad, []);
    assert.deepEqual(failed.filter((u) => !isFont(u)), []);
    assert.deepEqual(errors.filter((e) => !isFont(e)), []);
    await page.close();
  });
  test("外へのリンクはすべて https で、新しいタブで開くものは rel=noopener を持つ", async () => {
    const { page } = await open();
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
    const ext = links.filter((l) => !l.href.startsWith(srv.url) && !l.href.startsWith("mailto:"));
    assert.ok(ext.length > 0);
    for (const l of ext) {
      assert.ok(l.href.startsWith("https://"), `https でない: ${l.href}`);
      if (l.target === "_blank") assert.match(l.rel, /noopener/, l.href);
    }
    assert.ok(links.some((l) => l.href === "https://github.com/suzuki-toshihir0"), "GitHub へのリンクが無い");
    await page.close();
  });
  test("JavaScript が無くても、名前と中身が読める", async () => {
    const { page } = await open({ js: false });
    const t = await page.evaluate(() => document.body.innerText);
    for (const s of ["Toshihiro Suzuki", "Spacecraft Engineer"]) assert.ok(t.includes(s), `「${s}」が見えない`);
    assert.ok(await page.evaluate(() => document.querySelectorAll(".items li").length >= 10), "成果の一覧が見えない");
    await page.close();
  });
});

describe("言語の切り替え", () => {
  test("EN を押すと英語だけになり、開き直しても英語のまま", async () => {
    const { page, context } = await open({ lang: "ja" });
    const shown = (p = page) => p.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).length;
      return { lang: document.documentElement.lang, ja: vis('.page [lang="ja"]'), en: vis('.page [lang="en"]') };
    });
    let s = await shown();
    assert.equal(s.lang, "ja"); assert.ok(s.ja > 0); assert.equal(s.en, 0);
    await page.click('.langsw button[data-l="en"]');
    s = await shown();
    assert.equal(s.lang, "en"); assert.equal(s.ja, 0); assert.ok(s.en > 0);
    assert.equal(await page.$eval('.langsw button[data-l="en"]', (b) => b.getAttribute("aria-pressed")), "true");
    // 同じ保存領域で、最初の言語を指定せずに開き直す
    const again = await context.newPage();
    await again.goto(srv.url, { waitUntil: "networkidle0" });
    s = await shown(again);
    assert.equal(s.lang, "en"); assert.equal(s.ja, 0);
    await page.close();
  });
});

describe("planner", () => {
  test("❯ を押すと開き、もう一度押すか Esc で閉じる", async () => {
    const { page } = await open();
    const state = () => page.evaluate(() => ({ hidden: document.getElementById("mix").hidden, exp: document.getElementById("caret").getAttribute("aria-expanded") }));
    assert.deepEqual(await state(), { hidden: true, exp: "false" });
    await page.click("#caret");
    assert.deepEqual(await state(), { hidden: false, exp: "true" });
    await page.click("#caret");
    assert.deepEqual(await state(), { hidden: true, exp: "false" });
    await page.click("#caret");
    await page.focus("#mix-close");
    await page.keyboard.press("Escape");
    assert.deepEqual(await state(), { hidden: true, exp: "false" });
    await page.close();
  });
  test("最初の目標は RA 18h00m・DEC +00°00′。DEC のバーだけを押すと RA は変わらない", async () => {
    const { page } = await open();
    await page.click("#caret");
    await new Promise((r) => setTimeout(r, 200));
    const head = () => page.$eval("#mix-head", (e) => e.textContent.replace(/\s+/g, " ").trim());
    assert.match(await head(), /RA 18h00m DEC \+00°00′/);
    const b = await page.$eval('.ch[data-ax="dec"] .col', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.25 }; });
    await page.mouse.click(b.x, b.y);
    await new Promise((r) => setTimeout(r, 200));
    const h = await head();
    assert.match(h, /RA 18h00m/);
    assert.match(h, /DEC \+4[0-9]°/, h);   // 上から 1/4 の位置 = +45° 前後
    await page.close();
  });
  test("RW 回転数のグラフに X・Y・Z の凡例が出る（描画領域に色が入る）", async () => {
    const { page } = await open();
    await page.click("#caret");
    await new Promise((r) => setTimeout(r, 1500));
    const painted = await page.$eval("#hist", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert.ok(painted > 500, `塗られた画素 ${painted}`);
    await page.close();
  });
});

describe("背景", () => {
  test("衛星と星が描かれる", async () => {
    const { page } = await open();
    await new Promise((r) => setTimeout(r, 500));
    const painted = await page.$eval("#art", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert.ok(painted > 2000, `塗られた画素 ${painted}`);
    await page.close();
  });
  test("出典（Hipparcos、ESA、CC BY-NC 3.0 IGO）を表示している", async () => {
    const { page } = await open();
    const t = await page.$eval("footer", (e) => e.innerText);
    for (const s of ["Hipparcos", "ESA", "CC BY-NC 3.0 IGO"]) assert.ok(t.includes(s), s);
    await page.close();
  });
});

// ---- フォント: Google Fonts を使わず、使う文字だけを切り出したフォントを同梱する（tools/fonts/ で作る） ----
// CDP の CSS.getPlatformFontsForNode で、各要素の文字を実際にどのフォントで描いたかを調べる
async function platformFonts(page) {
  const cdp = await page.createCDPSession();
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "body *" });
  const out = [];
  for (const id of nodeIds) {
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: id });
    if (!fonts.length) continue;
    const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId: id });
    out.push({ html: outerHTML.replace(/\s+/g, " ").slice(0, 100), fonts });
  }
  await cdp.detach();
  return out;
}
// planner を開き、共著の一覧も開いて、描画の更新を止める（調べている間に要素が作り直されないように）
async function openAll(page) {
  await page.click("#caret");
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(async () => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    window.requestAnimationFrame = () => 0;
    await document.fonts.ready;
  });
  await new Promise((r) => setTimeout(r, 200));
}

describe("フォント", () => {
  test("外部のサーバーに一切つながらない", async () => {
    const { page, responses, failed } = await open();
    await openAll(page);
    const ext = [...responses.map((r) => r.url), ...failed].filter((u) => !u.startsWith(srv.url) && !u.startsWith("data:"));
    assert.deepEqual(ext, []);
    await page.close();
  });
  for (const lang of ["ja", "en"]) {
    test(`画面の文字はすべて同梱のフォントで描く（${lang}、planner と共著の一覧を開いた状態）`, async () => {
      const { page } = await open({ lang });
      await openAll(page);
      const nodes = await platformFonts(page);
      const bad = nodes.filter((n) => n.fonts.some((f) => !f.isCustomFont))
        .map((n) => `${n.fonts.filter((f) => !f.isCustomFont).map((f) => `${f.familyName}×${f.glyphCount}`).join(", ")} ← ${n.html}`);
      assert.deepEqual(bad, [], "同梱のフォントに無い文字がある（npm run fonts で作り直す）");
      const used = new Set(nodes.flatMap((n) => n.fonts.map((f) => f.postScriptName)));
      for (const ps of ["MPLUS1p-Regular", "MPLUS1p-Bold", "JetBrainsMono-Regular"]) assert.ok(used.has(ps), `${ps} が使われていない: ${[...used]}`);
      await page.close();
    });
  }
  test("CSS の content と、グラフ（canvas）に描く文字も同梱のフォントにある", async () => {
    const { page } = await open();
    await page.evaluate(async () => {
      // ▸▾ は共著の一覧の開閉、それ以外はグラフの目盛り・凡例と、planner の値に出る文字
      const s = document.createElement("span");
      s.id = "glyph-probe"; s.style.fontFamily = "var(--mono)";
      s.textContent = "▸▾−+°′→✕❯0123456789 hmsagonowXYZ";
      document.body.appendChild(s);
      await document.fonts.ready;
    });
    const nodes = await platformFonts(page);
    const probe = nodes.find((n) => n.html.includes("glyph-probe"));
    assert.ok(probe, "調べる要素が見つからない");
    assert.deepEqual(probe.fonts.filter((f) => !f.isCustomFont).map((f) => f.familyName), []);
    await page.close();
  });
  test("同梱したフォントのライセンス文（SIL Open Font License）がある", () => {
    for (const f of ["fonts/OFL-MPLUS1p.txt", "fonts/OFL-JetBrainsMono.txt"]) {
      const p = path.join(ROOT, f);
      assert.ok(fs.existsSync(p), `${f} が無い`);
      assert.match(fs.readFileSync(p, "utf8"), /SIL Open Font License, Version 1\.1/);
    }
  });
});

// ---- LinkedIn へのリンク: LinkedIn の規定（https://brand.linkedin.com/in-logo）に沿って、公式の白の [in] ロゴを色・形を変えずに使う。
// 文字はロゴと一体にせず、余白を空けて横に並べる（規定の「よい使い方」の例に、ロゴの横に "View my LinkedIn Profile" と並べたものがある）
describe("LinkedIn へのリンク", () => {
  const URL_ = "https://www.linkedin.com/in/suzuki-toshihir0/";
  test("GitHub の行の下に、[in] ロゴと「in/suzuki-toshihir0」を並べたリンクがある", async () => {
    const { page } = await open();
    const r = await page.evaluate((u) => {
      const a = [...document.querySelectorAll("a")].find((a) => a.href === u);
      const gh = [...document.querySelectorAll("a")].find((a) => a.href === "https://github.com/suzuki-toshihir0");
      if (!a || !gh) return null;
      const img = a.querySelector("img"), ib = img.getBoundingClientRect(), ab = a.getBoundingClientRect(), gb = gh.getBoundingClientRect();
      const text = a.textContent.trim();
      // 文字の左端（ロゴとの間の余白を測る）
      const range = document.createRange(); const tn = [...a.childNodes].map((n) => n.nodeType === 3 ? n : n.firstChild).find((n) => n && n.nodeType === 3 && n.textContent.trim());
      range.selectNodeContents(tn); const tb = range.getBoundingClientRect();
      return { text, imgs: a.querySelectorAll("img").length, svgs: a.querySelectorAll("svg").length, below: ab.top >= gb.bottom - 1, gap: tb.left - ib.right, logoH: ib.height };
    }, URL_);
    assert.ok(r, "LinkedIn か GitHub へのリンクが無い");
    assert.equal(r.text, "in/suzuki-toshihir0");
    assert.equal(r.imgs, 1);
    assert.equal(r.svgs, 0);
    assert.ok(r.below, "GitHub の行の下にない");
    assert.ok(r.gap >= r.logoH * 0.4, `ロゴと文字の間の余白が狭い（${r.gap.toFixed(1)}px、ロゴの高さ ${r.logoH.toFixed(1)}px）`);
    await page.close();
  });
  test("ロゴは縦横比を保ち、色は白のまま（形と色を変えない）", async () => {
    const { page } = await open();
    const r = await page.evaluate(async (u) => {
      const img = [...document.querySelectorAll("a")].find((a) => a.href === u).querySelector("img");
      await img.decode();
      const b = img.getBoundingClientRect();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let opaque = 0, nonWhite = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { opaque++; if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) nonWhite++; }
      return { natural: img.naturalWidth / img.naturalHeight, shown: b.width / b.height, h: b.height, opaque, nonWhite, filter: getComputedStyle(img).filter, opacity: getComputedStyle(img).opacity };
    }, URL_);
    assert.ok(Math.abs(r.shown / r.natural - 1) < 0.03, `縦横比が変わっている（元 ${r.natural.toFixed(3)}、表示 ${r.shown.toFixed(3)}）`);
    assert.ok(r.h >= 12, `小さすぎる（${r.h}px）`);
    assert.ok(r.opaque > 0 && r.nonWhite === 0, `白でない画素がある（${r.nonWhite}/${r.opaque}）`);
    assert.equal(r.filter, "none");
    await page.close();
  });
});
