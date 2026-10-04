// 画面の幅・言語・倍率・planner の開閉を変えながら、表示が壊れていないかを headless の Chrome で確かめる。
// スクリーンショットの保存先は SHOTS で指定できる（倍率 1 の各状態を保存）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { serve, CHROME } from "./server.js";

const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
const WIDTHS = [320, 360, 400, 560, 561, 768, 1024, 1280, 1920];
const LANGS = ["ja", "en"];
const DPRS = [1, 2];

// ページの中で測る。破れた性質の説明の一覧を返す
async function measure(page, open) {
  return page.evaluate((open) => {
    const f = [];
    const W = document.documentElement.clientWidth;
    const r = (el) => el.getBoundingClientRect();
    const vis = (el) => { const b = r(el); return el.offsetParent !== null && b.width > 0 && b.height > 0; };
    const name = (el) => el.id ? `#${el.id}` : `.${[...el.classList].join(".") || el.tagName.toLowerCase()}`;
    // 1. ページが横にスクロールしない
    if (document.documentElement.scrollWidth > W + 1) f.push(`ページが横にはみ出す（scrollWidth ${document.documentElement.scrollWidth} > ${W}）`);
    // 2. 主要な要素が画面の左右からはみ出さない
    const keys = [...document.querySelectorAll(".page > *, .me > *, .langsw, .mix, .mix .pane, #hist, .posts li, .timeline li, .items li, .fetch")];
    for (const el of keys) {
      if (!vis(el)) continue;
      const b = r(el);
      if (b.right > W + 0.5 || b.left < -0.5) f.push(`${name(el)} が画面からはみ出す（left ${b.left.toFixed(1)}, right ${b.right.toFixed(1)}, 幅 ${W}）`);
    }
    // 4. 文字が入れ物からはみ出さない（横方向）
    for (const el of document.querySelectorAll(".me h1, .handle, .fetch dd, .posts li, .timeline .what, .items li > div, .mix .head, .mix .val, .mix .name, .mix .pane-title, .langsw")) {
      if (!vis(el)) continue;
      if (el.scrollWidth > el.clientWidth + 1) f.push(`${name(el)} の文字がはみ出す（${el.scrollWidth} > ${el.clientWidth}）「${el.textContent.trim().slice(0, 30)}」`);
    }
    // 5. 右上の言語ボタンが、名前・アイコン・ハンドルと重ならない
    const ls = document.querySelector(".langsw");
    for (const el of document.querySelectorAll(".avatar, .me h1, .handle")) {
      const a = r(ls), b = r(el);
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) f.push(`言語ボタンが ${name(el)} と重なる`);
    }
    if (open) {
      const mix = document.getElementById("mix");
      if (!vis(mix)) f.push("planner が表示されない");
      const panes = [...document.querySelectorAll(".mix .pane")];
      if (panes.length !== 2) f.push(`planner の区画が ${panes.length} 個（2 個のはず）`);
      else {
        const [a, b] = panes.map(r);
        // 3. 区画が重ならず、横並びなら幅 1:1、縦並びなら上下
        const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        if (overlap) f.push("planner の 2 つの区画が重なる");
        const side = Math.abs(a.top - b.top) < 1;
        if (side && Math.abs(a.width - b.width) > 1) f.push(`横並びなのに区画の幅が 1:1 でない（${a.width.toFixed(1)} : ${b.width.toFixed(1)}）`);
        if (!side && !(b.top >= a.bottom - 0.5)) f.push("縦並びなのに右の区画が左の区画の下にない");
        if (W <= 560 && side) f.push("幅 560px 以下なのに区画が横並び");
        if (W > 560 && !side) f.push("幅 561px 以上なのに区画が縦並び");
        // バーが区画の中に収まる
        for (const col of document.querySelectorAll(".mix .col")) {
          const c = r(col);
          if (c.height < 100) f.push(`バーが低すぎる（${c.height.toFixed(1)}px）`);
          if (c.left < a.left - 0.5 || c.right > a.right + 0.5) f.push("バーが左の区画からはみ出す");
        }
        // 6. グラフの描画領域の大きさが、表示の大きさ × 倍率と一致する
        const hc = document.getElementById("hist"), dpr = window.devicePixelRatio || 1;
        if (hc.width !== Math.round(hc.clientWidth * dpr) || hc.height !== Math.round(hc.clientHeight * dpr))
          f.push(`グラフの描画領域が表示と合わない（${hc.width}×${hc.height} ≠ ${Math.round(hc.clientWidth * dpr)}×${Math.round(hc.clientHeight * dpr)}）`);
        if (hc.clientWidth < 120 || hc.clientHeight < 100) f.push(`グラフが小さすぎる（${hc.clientWidth}×${hc.clientHeight}）`);
        const h = r(hc);
        if (h.left < b.left - 0.5 || h.right > b.right + 0.5 || h.bottom > b.bottom + 0.5) f.push("グラフが右の区画からはみ出す");
      }
    }
    return f;
  }, open);
}

let browser, srv;
before(async () => {
  srv = await serve();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); await srv?.close(); });

for (const dpr of DPRS) for (const lang of LANGS) for (const w of WIDTHS) for (const open of [false, true]) {
  test(`幅 ${w}px / ${lang} / 倍率 ${dpr} / planner ${open ? "開" : "閉"}`, async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    try {
      await page.setViewport({ width: w, height: 800, deviceScaleFactor: dpr });
      await page.evaluateOnNewDocument((l) => { try { localStorage.setItem("lang", l); } catch (e) {} }, lang);
      await page.goto(srv.url, { waitUntil: "networkidle0" });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      if (open) { await page.click("#caret"); await new Promise((res) => setTimeout(res, 300)); }
      const f = await measure(page, open);
      // 7. コンソールにエラーが出ない（Google Fonts が読めない環境の失敗は除く）
      for (const e of errors) if (!/fonts\.(googleapis|gstatic)/.test(e)) f.push(`コンソールのエラー: ${e}`);
      if (SHOTS && dpr === 1) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${lang}-${w}-${open ? "open" : "closed"}.png`) }); }
      assert.deepEqual([...new Set(f)], [], "破れた性質");
    } finally { await page.close(); }
  });
}
