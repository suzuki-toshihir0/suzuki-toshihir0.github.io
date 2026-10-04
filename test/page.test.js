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

// ページを開く。読み込んだものの応答と、コンソールのエラーを集める
async function open({ js = true, lang = null, width = 1280 } = {}) {
  const page = await browser.newPage();
  const errors = [], responses = [], failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => responses.push({ url: r.url(), status: r.status() }));
  page.on("requestfailed", (r) => failed.push(r.url()));
  await page.setJavaScriptEnabled(js);
  await page.setViewport({ width, height: 800 });
  if (lang) await page.evaluateOnNewDocument((l) => { try { localStorage.setItem("lang", l); } catch (e) {} }, lang);
  await page.goto(srv.url, { waitUntil: "networkidle0" });
  return { page, errors, responses, failed };
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
    const ext = links.filter((l) => !l.href.startsWith(location.origin) && !l.href.startsWith("mailto:"));
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
    const { page } = await open({ lang: "ja" });
    const shown = () => page.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).length;
      return { lang: document.documentElement.lang, ja: vis('.page [lang="ja"]'), en: vis('.page [lang="en"]') };
    });
    let s = await shown();
    assert.equal(s.lang, "ja"); assert.ok(s.ja > 0); assert.equal(s.en, 0);
    await page.click('.langsw button[data-l="en"]');
    s = await shown();
    assert.equal(s.lang, "en"); assert.equal(s.ja, 0); assert.ok(s.en > 0);
    assert.equal(await page.$eval('.langsw button[data-l="en"]', (b) => b.getAttribute("aria-pressed")), "true");
    await page.reload({ waitUntil: "networkidle0" });
    assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
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
