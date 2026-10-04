// 隠しのパネル: 名前の前の ❯ を押すと開く。alsamixer のような縦のバーで、カメラを向ける方向（赤経・赤緯）を決める。
// 衛星は姿勢制御で、RW を使ってカメラの光軸をその方向へ向ける
import { sat } from "./art.js";

const mix = document.getElementById("mix");
const caret = document.getElementById("caret");
const colsEl = document.getElementById("mix-cols");
const head = document.getElementById("mix-head");
// 軸ごとの範囲・目盛り・表示の仕方
const AXES = [
  { name: "RA", ja: "赤経", min: 0, max: 24, ticks: [6, 12, 18], step: 0.5,
    fmt: (h) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}h${String(m % 60).padStart(2, "0")}m`; } },
  { name: "DEC", ja: "赤緯", min: -90, max: 90, ticks: [-60, -30, 30, 60], step: 5,
    fmt: (d) => { const a = Math.round(Math.abs(d) * 60); return `${d < 0 ? "−" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}°${String(a % 60).padStart(2, "0")}′`; } },
];
const frac = (ax, v) => (v - ax.min) / (ax.max - ax.min);   // 0（下端）〜 1（上端）
let sel = 0;

const chans = AXES.map((ax, i) => {
  const ch = document.createElement("div"); ch.className = "ch"; ch.dataset.ax = ax.name.toLowerCase();
  const zero = ax.min < 0 ? '<div class="zero"></div>' : "";
  ch.innerHTML = `<div class="col" aria-label="カメラを向ける${ax.ja}">${zero}${ax.ticks.map(v => `<div class="tick" style="top:${(1 - frac(ax, v)) * 100}%"></div>`).join("")}<div class="fill"></div><div class="tgt"></div></div><div class="val"></div><div class="name">${ax.name}</div>`;
  colsEl.appendChild(ch);
  return { ax, ch, col: ch.querySelector(".col"), val: ch.querySelector(".val"), fill: ch.querySelector(".fill"), tgt: ch.querySelector(".tgt") };
});

const setTarget = (i, v) => {
  const { S, setPoint } = sat, ax = AXES[i];
  const t = S.trd.slice();
  t[i] = i === 0 ? ((v % 24) + 24) % 24 : Math.max(ax.min, Math.min(ax.max, v));
  t[i] = Math.round(t[i] / (ax.step / 6)) * (ax.step / 6);   // 細かくなりすぎないよう丸める
  setPoint(t[0], t[1]);
};
const select = (i) => { sel = (i + AXES.length) % AXES.length; chans.forEach((c, k) => c.ch.classList.toggle("sel", k === sel)); };

// 塗りが今カメラの向いている方向、◂ が目標。RA は下端の 0h から、DEC は中央の 0° から伸ばす
// RW の回転数の時間履歴: 横軸は直近 3 分（右端が今）、縦軸は ±6000 rpm。線の右端に軸名と今の値を添える
const hc = document.getElementById("hist"), hctx = hc.getContext("2d"), hread = document.getElementById("hist-read");
let hover = null;   // マウスやタップを置いた位置（0〜1、左端〜右端）
const css = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
const drawHist = () => {
  const { now } = sat;
  const dpr = window.devicePixelRatio || 1, w = hc.clientWidth, h = hc.clientHeight;
  // 描画領域の大きさを、表示の幅と高さの両方に合わせる（区画が縦に伸びたときも引き伸ばされないように）
  if (hc.width !== Math.round(w * dpr) || hc.height !== Math.round(h * dpr)) { hc.width = Math.round(w * dpr); hc.height = Math.round(h * dpr); }
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0); hctx.clearRect(0, 0, w, h);
  const mono = css("--mono"), dim = css("--overlay"), axis = css("--surface1");
  const L = 44, B = 16, T = 180, t1 = now(), t0 = t1 - T;   // 左に目盛りの値、下に時間の値の余白
  const pw = w - L, ph = h - B;
  const X = (t) => L + (t - t0) / T * pw, Y = (v) => ph / 2 - v / 6000 * (ph / 2 - 2);
  // 軸（左と下）と、端の目盛りの値
  hctx.strokeStyle = axis; hctx.lineWidth = 1;
  hctx.beginPath(); hctx.moveTo(L - 0.5, 0); hctx.lineTo(L - 0.5, ph + 0.5); hctx.lineTo(w, ph + 0.5); hctx.stroke();
  hctx.fillStyle = dim; hctx.font = `10px ${mono}`; hctx.textAlign = "right";
  hctx.textBaseline = "top"; hctx.fillText("+6000", L - 5, 0);
  hctx.textBaseline = "middle"; hctx.fillText("0", L - 5, Y(0));
  hctx.textBaseline = "bottom"; hctx.fillText("−6000", L - 5, ph);
  hctx.textBaseline = "top"; hctx.textAlign = "left"; hctx.fillText("−3m", L, ph + 3);
  hctx.textAlign = "right"; hctx.fillText("now", w, ph + 3); hctx.textAlign = "left";
  // 0 の線は点線で薄く
  hctx.setLineDash([2, 4]); hctx.beginPath(); hctx.moveTo(L, Math.round(Y(0)) + 0.5); hctx.lineTo(w, Math.round(Y(0)) + 0.5); hctx.stroke(); hctx.setLineDash([]);
  // 線: 点字の点（横 3px × 縦 3.5px の格子）を並べて描く。縦に飛ぶところは間の点も埋める
  const cols = [css("--ax-x"), css("--ax-y"), css("--ax-z")], names = ["X", "Y", "Z"];
  const DX = 3, DY = 3.5, H = sat.hist;
  if (H.length > 1) {
    for (let k = 0; k < 3; k++) {
      hctx.fillStyle = cols[k];
      let j = 0, prevRow = null;
      for (let x = L + 1; x < w; x += DX) {
        const t = t0 + (x - L) / pw * T;
        if (t < H[0][0] || t > H[H.length - 1][0]) { prevRow = null; continue; }
        while (j < H.length - 2 && H[j + 1][0] < t) j++;
        const a = H[j], c = H[j + 1], u = (t - a[0]) / ((c[0] - a[0]) || 1);
        const row = Math.round(Y(a[k + 1] + (c[k + 1] - a[k + 1]) * u) / DY);
        const r0 = prevRow === null ? row : prevRow;
        for (let r = Math.min(r0, row); r <= Math.max(r0, row); r++) hctx.fillRect(x - 0.8, r * DY - 0.8, 1.6, 1.6);
        prevRow = row;
      }
    }
  }
  // 右上の枠付きの凡例（軸名と今の値）
  const last = H[H.length - 1] || [0, 0, 0, 0];
  hctx.font = `11px ${mono}`;
  const lines = [0, 1, 2].map(k => `${names[k]} ${((last[k + 1] >= 0 ? "+" : "−") + Math.abs(Math.round(last[k + 1]))).padStart(5)}`);
  const lw = Math.max(...lines.map(t => hctx.measureText(t).width)) + 26, lh = 14 * 3 + 8, lx = w - lw - 2, ly = 2;
  hctx.fillStyle = css("--crust"); hctx.globalAlpha = 0.85; hctx.fillRect(lx, ly, lw, lh); hctx.globalAlpha = 1;
  hctx.strokeStyle = axis; hctx.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);
  hctx.textBaseline = "middle";
  lines.forEach((t, k) => {
    const yy = ly + 4 + 7 + k * 14;
    hctx.fillStyle = cols[k]; hctx.fillRect(lx + 7, yy - 1, 8, 2);
    hctx.fillStyle = css("--subtext"); hctx.fillText(t, lx + 19, yy);
  });
  // マウスやタップを置いた時刻の縦線と、その時刻の値
  if (hover !== null && H.length) {
    const tt = t0 + hover * T;
    let best = H[0]; for (const p of H) if (Math.abs(p[0] - tt) < Math.abs(best[0] - tt)) best = p;
    const x = Math.round(X(best[0])) + 0.5;
    hctx.strokeStyle = dim; hctx.lineWidth = 1; hctx.beginPath(); hctx.moveTo(x, 0); hctx.lineTo(x, ph); hctx.stroke();
    hread.textContent = `${(t1 - best[0]).toFixed(0)}s ago  ` + names.map((n, k) => `${n} ${(best[k + 1] >= 0 ? "+" : "−")}${Math.abs(Math.round(best[k + 1]))}`).join("  ");
  } else hread.textContent = " ";
};
const hpos = (e) => { const r = hc.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left - 44) / (r.width - 44))); };
hc.addEventListener("pointermove", (e) => { hover = hpos(e); });
hc.addEventListener("pointerdown", (e) => { hover = hpos(e); });
hc.addEventListener("pointerleave", () => { hover = null; });

const render = () => {
  drawHist();
  const { S, current } = sat;
  const cur = current();
  chans.forEach((c, i) => {
    const ax = c.ax, f = frac(ax, cur[i]);
    if (ax.min < 0) { const z = frac(ax, 0); c.fill.style.bottom = `${Math.min(f, z) * 100}%`; c.fill.style.height = `${Math.abs(f - z) * 100}%`; }
    else { c.fill.style.bottom = "0"; c.fill.style.height = `${f * 100}%`; }
    c.tgt.style.top = `${(1 - frac(ax, S.trd[i])) * 100}%`;
    c.val.textContent = ax.fmt(cur[i]);
  });
  head.innerHTML = `<b>→</b> RA ${AXES[0].fmt(S.trd[0])}  DEC ${AXES[1].fmt(S.trd[1])}`;
};
let lastR = 0;
addEventListener("sat-tick", () => {
  if (mix.hidden) return;
  const now = performance.now();
  if (now - lastR > 80) { lastR = now; render(); }
});

// ドラッグ・クリックで目標を決める
chans.forEach((c, i) => {
  const fromY = (e) => {
    const r = c.col.getBoundingClientRect(), ax = c.ax;
    return ax.min + (r.bottom - e.clientY) / r.height * (ax.max - ax.min);
  };
  c.col.addEventListener("pointerdown", (e) => { c.col.setPointerCapture(e.pointerId); select(i); setTarget(i, fromY(e)); });
  c.col.addEventListener("pointermove", (e) => { if (c.col.hasPointerCapture(e.pointerId)) setTarget(i, fromY(e)); });
});

// Esc で閉じる
mix.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });

const toggle = (open) => {
  mix.hidden = !open;
  caret.setAttribute("aria-expanded", open ? "true" : "false");
  sat.start();
  // 開いてもバーにフォーカスを移さない（ページをスクロールするキーが目標の操作に取られないように）
  if (open) { select(sel); render(); }
  else if (mix.contains(document.activeElement)) caret.focus();
};
caret.addEventListener("click", () => toggle(mix.hidden));
document.getElementById("mix-close").addEventListener("click", () => toggle(false));
