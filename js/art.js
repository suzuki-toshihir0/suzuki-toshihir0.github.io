// 背景: ワイヤーフレームの人工衛星。3D の線分を回転させて 2D の canvas に投影する（ライブラリなし）
// 姿勢の計算（運動方程式と姿勢制御）は attitude.js、星のデータは stars.js
import { createSim, qrot, RPM } from "./attitude.js";
import { HIP } from "./stars.js";

const canvas = document.getElementById("art");
const ctx = canvas.getContext("2d");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let W = 0, H = 0, colors = {}, raf = 0, last = 0;
const sim = createSim(), S = sim.S;
// RW の回転数の履歴 [[時刻 s, X, Y, Z rpm], ...]（planner のグラフに使う）
const hist = [];

const readColors = () => {
  const cs = getComputedStyle(document.body);
  const v = (n) => cs.getPropertyValue(n).trim();
  colors = { body: v("--sat-body"), panel: v("--c5"), frame: v("--c6"), antenna: v("--c2"), hinge: v("--c3"), wheel: [v("--ax-x"), v("--ax-y"), v("--ax-z")], star: v("--text") };
};
const resize = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

// ---- 模型（単位は任意。本体 1×1×1.6 の箱に、両側へ 3 枚ずつ展開した太陽電池パネル）----
const E = [];
const seg = (a, b, c) => E.push([a, b, c]);
const box = (cx, cy, cz, sx, sy, sz, c) => {
  const P = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
    P.push([cx + x * sx / 2, cy + y * sy / 2, cz + z * sz / 2]);
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = (i ^ j);
    if (d === 1 || d === 2 || d === 4) seg(P[i], P[j], c);
  }
};
box(0, 0, 0, 1, 1, 1.6, "body");
// 太陽電池パネル: x 方向へ伸びる。各パネルに 4×2 のセルの格子
for (const side of [-1, 1]) {
  const x0 = side * 0.5, yoke = side * 0.35;
  seg([x0, 0, 0], [x0 + yoke, 0, 0], "hinge");
  for (let k = 0; k < 3; k++) {
    const xa = x0 + yoke + side * k * 1.15, xb = xa + side * 1.1;
    const zw = 0.7;
    seg([xa, 0, -zw], [xb, 0, -zw], "frame"); seg([xa, 0, zw], [xb, 0, zw], "frame");
    seg([xa, 0, -zw], [xa, 0, zw], "frame"); seg([xb, 0, -zw], [xb, 0, zw], "frame");
    for (let g = 1; g < 4; g++) { const x = xa + (xb - xa) * g / 4; seg([x, 0, -zw], [x, 0, zw], "panel"); }
    seg([xa, 0, 0], [xb, 0, 0], "panel");
  }
}
// アンテナ: 上面のパッチ
box(0, 0.52, 0.3, 0.45, 0.04, 0.45, "antenna");
// カメラの鏡筒（前面）
for (let i = 0; i < 12; i++) {
  const a1 = i / 12 * Math.PI * 2, a2 = (i + 1) / 12 * Math.PI * 2, r = 0.22;
  seg([Math.cos(a1) * r, Math.sin(a1) * r, 0.8], [Math.cos(a2) * r, Math.sin(a2) * r, 0.8], "body");
  seg([Math.cos(a1) * r, Math.sin(a1) * r, 1.05], [Math.cos(a2) * r, Math.sin(a2) * r, 1.05], "body");
  if (i % 3 === 0) seg([Math.cos(a1) * r, Math.sin(a1) * r, 0.8], [Math.cos(a1) * r, Math.sin(a1) * r, 1.05], "body");
}
// RW: 本体の内側の壁（構体のパネル）に取り付ける。回転軸は壁に垂直
//   RW-X は +X の壁、RW-Y は -Y の壁、RW-Z は -Z の壁。壁側に取り付けの座、そこから短い円筒の筐体でホイールの面へ
//   c はホイールの面の中心、wall は取り付ける壁の座標（回転軸の成分）。3 基は互いに重ならない位置に置く
const WHEELS = [
  { c: [0.36, -0.15, -0.35], n: 0, wall: 0.5 },
  { c: [0.1, -0.36, 0.25], n: 1, wall: -0.5 },
  { c: [-0.2, 0.15, -0.66], n: 2, wall: -0.8 },
];
const WR = 0.2;
const wheelSegs = (phi) => {
  const out = [];
  WHEELS.forEach((w, i) => {
    const u = (w.n + 1) % 3, v = (w.n + 2) % 3;
    const pt = (a, r, at) => { const p = w.c.slice(); if (at !== undefined) p[w.n] = at; p[u] += Math.cos(a) * r; p[v] += Math.sin(a) * r; return p; };
    const ring = (r, at) => { for (let k = 0; k < 16; k++) out.push([pt(k / 16 * 2 * Math.PI, r, at), pt((k + 1) / 16 * 2 * Math.PI, r, at), i]); };
    ring(WR);                                   // ホイールの面
    ring(WR * 1.1, w.wall);                     // 壁に当たる取り付けの座
    for (let k = 0; k < 4; k++) {               // 筐体の側面
      const a = k * Math.PI / 2 + Math.PI / 4;
      out.push([pt(a, WR * 1.1, w.wall), pt(a, WR), i]);
    }
    const hub = w.c.slice();
    for (let k = 0; k < 3; k++) out.push([hub, pt(phi[i] + k * 2 * Math.PI / 3, WR), i]);   // 回るスポーク
  });
  return out;
};

// ---- 描画 ----
// 見る向き。カメラが鉛直まわりにゆっくり衛星のまわりを回り（camYaw）、少し傾けて眺める
let camYaw = 0;
const view = ([x, y, z]) => {
  let c = Math.cos(camYaw), s = Math.sin(camYaw); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(0.25); s = Math.sin(0.25); [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(0.45); s = Math.sin(0.45); [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
};
// 背景の星: Hipparcos 星表（ESA, 1997。CDS VizieR I/239 から 6 等級より明るい 4992 個）の赤経・赤緯 [deg]・等級。
// 天の北極を画面の上（世界の +y）に向ける。カメラが回ると星も流れるので、衛星が回っているのとの区別がつく
const STARS = (() => {
  const out = [];
  for (let i = 0; i < HIP.length; i += 3) {
    const ra = HIP[i] * Math.PI / 180, de = HIP[i + 1] * Math.PI / 180, v = HIP[i + 2];
    const b = Math.min(1, Math.max(0, (6.5 - v) / 7));   // 明るい星ほど 1 に近い
    out.push({ d: [Math.cos(de) * Math.cos(ra), Math.sin(de), -Math.cos(de) * Math.sin(ra)], a: 0.25 + 0.75 * b, s: 0.45 + 1.4 * b });
  }
  return out;
})();
const drawStars = (cx, cy, F) => {   // F: 焦点距離（衛星の投影と同じ値にする）
  ctx.fillStyle = colors.star;
  for (const st of STARS) {
    const [x, y, z] = view(st.d);
    if (z > -0.15) continue;        // カメラの後ろ側（手前向き）の星は描かない
    const px = cx + x / -z * F, py = cy - y / -z * F;
    if (px < -2 || px > W + 2 || py < -2 || py > H + 2) continue;
    ctx.globalAlpha = st.a;
    ctx.beginPath(); ctx.arc(px, py, st.s, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.globalAlpha = 1;
};
const V = { init: false };
const draw = () => {
  ctx.clearRect(0, 0, W, H);
  const wide = W > 900;
  let tx, ty, tu, tf;
  tx = wide ? W * 0.6 : W * 0.55; ty = wide ? H * 0.5 : H * 0.6;
  tu = Math.min(W, H) * (wide ? 0.17 : 0.15);
  // planner を開いている間は、透けて見える衛星を少し濃くする
  tf = (wide ? 0.5 : 0.25) * (panelOpen() ? 1.6 : 1);
  // 置き場所・大きさ・濃さは、目標に向けて少しずつ寄せる（開閉のときになめらかに動く）
  if (!V.init) Object.assign(V, { x: tx, y: ty, u: tu, f: tf, init: true });
  const k = reduce ? 1 : 0.12;
  V.x += (tx - V.x) * k; V.y += (ty - V.y) * k; V.u += (tu - V.u) * k; V.f += (tf - V.f) * k;
  const cx = V.x, cy = V.y, unit = V.u, fade = V.f;
  const dist = 9;
  const proj = (p) => { const [x, y, z] = view(qrot(S.q, p)); const f = dist / (dist - z); return [cx + x * unit * f, cy - y * unit * f, z]; };
  const line = (a, b, col) => {
    const A = proj(a), B = proj(b);
    // 奥の線ほど薄くして、前後がわかるようにする
    ctx.globalAlpha = fade * (0.35 + 0.65 * Math.min(1, Math.max(0, ((A[2] + B[2]) / 2 + 3) / 6)));
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  };
  drawStars(cx, cy, unit * dist);
  ctx.lineWidth = 1;
  for (const [a, b, c] of E) line(a, b, colors[c]);
  for (const [a, b, i] of wheelSegs(S.phi)) line(a, b, colors.wheel[i]);
  ctx.globalAlpha = 1;
};

const panelOpen = () => !document.getElementById("mix").hidden;
let simT = 0;
const loop = (t) => {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
  const n = Math.ceil(dt / 0.004);
  for (let i = 0; i < n; i++) sim.step(dt / n);
  camYaw += dt * 0.02;              // 約 5 分で一周
  // RW の回転数 [rpm] を 0.5 秒ごとに記録（直近 3 分）。パネルを閉じている間も記録する
  simT += dt;
  if (simT - (hist.length ? hist[hist.length - 1][0] : -1) >= 0.5) {
    hist.push([simT, ...S.O.map(o => o * RPM)]);
    while (hist.length && hist[0][0] < simT - 180) hist.shift();
  }
  draw();
  window.dispatchEvent(new CustomEvent("sat-tick", { detail: S }));
  raf = requestAnimationFrame(loop);
};
const start = () => {
  cancelAnimationFrame(raf); readColors(); resize(); last = 0;
  // 動きを減らす設定のときは止めた絵にする。ただし操作盤を開いたら動かす
  if (reduce && !panelOpen()) draw(); else raf = requestAnimationFrame(loop);
};

// planner から使う
export const sat = { S, hist, start, setPoint: sim.setPoint, current: sim.current, now: () => simT };

let tm = 0;
addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(start, 150); });
document.addEventListener("visibilitychange", () => document.hidden ? cancelAnimationFrame(raf) : start());
start();
