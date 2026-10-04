// 衛星の姿勢変更（目標の姿勢の決め方と制御器）のテスト。js/attitude.js を直接読み込み、ブラウザは使わない
// 回数は RUNS で変えられる（既定 50）。失敗の再現は CASE='{"q":[…],"ra":…,"dec":…}' node --test test/attitude.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { createSim, radecToDir, dirToRadec, qrot, D2R, RPM } from "../js/attitude.js";

// ---- 小道具 ----
const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
const angDeg = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) / D2R;
const close = (a, b, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) <= eps);
// v を、v に垂直な向き p のほうへ δ [deg] だけ傾ける
const tilt = (v, p, deltaDeg) => { const u = norm(cross(cross(v, p), v)); const d = deltaDeg * D2R; return norm(v.map((x, i) => x * Math.cos(d) + u[i] * Math.sin(d))); };

describe("赤経・赤緯と向きの変換", () => {
  test("代表の向き（天の北極が +y、赤経 0h が +x、6h が −z）", () => {
    assert.ok(close(radecToDir(0, 0), [1, 0, 0]));
    assert.ok(close(radecToDir(6, 0), [0, 0, -1]));
    assert.ok(close(radecToDir(18, 0), [0, 0, 1]));
    assert.ok(close(radecToDir(3, 90), [0, 1, 0]));
    assert.ok(close(radecToDir(3, -90), [0, -1, 0]));
  });
  test("行って戻ると元の値になる", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 24, maxExcluded: true, noNaN: true }), fc.double({ min: -89.9, max: 89.9, noNaN: true }), (ra, de) => {
      const [r, d] = dirToRadec(radecToDir(ra, de));
      const dra = Math.abs(r - ra);
      return Math.min(dra, 24 - dra) < 1e-9 && Math.abs(d - de) < 1e-9;
    }));
  });
  test("赤経は 0 以上 24 未満（計算の誤差で 24h と出ない）", () => {
    for (const v of [[1, 0, 1e-17], [1, 0, -1e-17], [1, 0, 0], norm([1, 0.3, 1e-15])]) {
      const [r] = dirToRadec(v);
      assert.ok(r >= 0 && r < 24, `赤経 ${r}`);
    }
  });
});

describe("最初の状態と目標の指定", () => {
  test("最初は光軸（本体 +z）が RA 18h・DEC 0° を向き、目標もそこにある（触っていないのに動かない）", () => {
    const sim = createSim();
    const [ra, de] = sim.current();
    assert.ok(Math.abs(ra - 18) < 1e-9 && Math.abs(de) < 1e-9, `${ra}, ${de}`);
    assert.deepEqual(sim.S.trd, [18, 0]);
    for (let i = 0; i < 2500; i++) sim.step(0.004);
    assert.ok(close(sim.S.q, [1, 0, 0, 0]));
    assert.ok(close(sim.S.O, [0, 0, 0]));
  });
  test("RA は 24h で回り、DEC は ±90° に収める", () => {
    const sim = createSim();
    sim.setPoint(25, 10); assert.ok(Math.abs(sim.S.trd[0] - 1) < 1e-12);
    sim.setPoint(-1, 10); assert.ok(Math.abs(sim.S.trd[0] - 23) < 1e-12);
    sim.setPoint(3, 120); assert.equal(sim.S.trd[1], 90);
    sim.setPoint(3, -120); assert.equal(sim.S.trd[1], -90);
  });
  test("今向いている方向を目標にすると、目標の姿勢は今の姿勢のまま", () => {
    const sim = createSim();
    sim.S.q = norm([0.3, -0.5, 0.7, 0.2]);
    sim.setPoint(...sim.current());
    const d = qmul(qconj(sim.S.qt), sim.S.q);
    assert.ok(Math.abs(Math.abs(d[0]) - 1) < 1e-12);
  });
});

// ---- PBT: 1 回の向き替えを動かして、性質を確かめる ----
function run(q0, raT, decT) {
  const sim = createSim(), S = sim.S;
  S.q = norm(q0); S.qt = S.q.slice(); S.w = [0, 0, 0]; S.O = [0, 0, 0]; S.qs = 1;
  const b0 = qrot(S.q, [0, 0, 1]);
  sim.setPoint(raT, decT);
  const t = S.tdir;
  // 目標の姿勢への回転 Δq = qt ⊗ q0⁻¹ の回転軸（世界座標）。光軸はこの軸に垂直な大円の上を動くはず
  const dq = qmul(S.qt, qconj(S.q)), dqn = Math.hypot(dq[1], dq[2], dq[3]);
  const axis = dqn > 1e-9 ? [dq[1] / dqn, dq[2] / dqn, dq[3] / dqn] : null;
  const ang0 = angDeg(b0, t);
  const T = ang0 / 1 + 150;   // 毎秒 1° で回る時間 + 余裕
  let prev = ang0, maxW = 0, maxRpm = 0, maxH = 0, maxGc = 0, maxRise = 0;
  const DT = 0.004;           // ページと同じ 4 ms の刻み
  for (let i = 0; i < T / DT; i++) {
    sim.step(DT);
    const b = qrot(S.q, [0, 0, 1]), a = angDeg(b, t);
    if (![...S.q, ...S.w, ...S.O].every(Number.isFinite)) return { fail: "NaN が出た" };
    maxW = Math.max(maxW, Math.hypot(...S.w) / D2R);
    maxRpm = Math.max(maxRpm, ...S.O.map((o) => Math.abs(o * RPM)));
    maxH = Math.max(maxH, sim.momentum());
    if (axis) maxGc = Math.max(maxGc, Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(b, axis))))) / D2R);
    maxRise = Math.max(maxRise, a - prev); prev = a;
  }
  const finalAng = angDeg(qrot(S.q, [0, 0, 1]), t), finalW = Math.hypot(...S.w) / D2R;
  return { ang0, finalAng, finalW, maxW, maxRpm, maxH, maxGc, maxRise };
}

// 性質: どれか 1 つでも破れたら、その内容を返す
function check(r) {
  if (r.fail) return r.fail;
  const f = [];
  if (!(r.finalAng <= 0.01)) f.push(`収束しない（残り ${r.finalAng.toExponential(2)}°）`);
  if (!(r.finalW <= 1e-3)) f.push(`止まらない（ω ${r.finalW.toExponential(2)} deg/s）`);
  if (!(r.maxW <= 1 + 1e-6)) f.push(`速さの上限を超えた（${r.maxW.toFixed(6)} deg/s）`);
  if (!(r.maxRpm < 6000)) f.push(`RW が飽和した（${r.maxRpm.toFixed(1)} rpm）`);
  if (!(r.maxH <= 1e-12)) f.push(`角運動量が保たれない（${r.maxH.toExponential(2)}）`);
  if (!(r.maxGc <= 1e-4)) f.push(`光軸が大円から外れた（${r.maxGc.toExponential(2)}°）`);
  if (!(r.maxRise <= 1e-4)) f.push(`目標との角距離が途中で増えた（+${r.maxRise.toExponential(2)}°）`);
  return f.length ? f.join(" / ") : null;
}

// ---- 入力の作り方 ----
const quat = fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }),
  fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }))
  .filter((q) => Math.hypot(...q) > 0.1);
const ra = fc.double({ min: 0, max: 24, maxExcluded: true, noNaN: true });
const decUniform = fc.double({ min: -1, max: 1, noNaN: true }).map((u) => Math.asin(u) / D2R);   // 天球上で一様
const tiny = fc.constantFrom(0, 1e-12, 1e-9, 1e-6, 1e-3, 0.1, 1);
const dirOnSphere = fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }))
  .map(([u, th]) => [Math.sqrt(1 - u * u) * Math.cos(th), u, Math.sqrt(1 - u * u) * Math.sin(th)]);

const cases = {
  "一般（初期姿勢・目標とも一様）": fc.record({ q: quat, ra, dec: decUniform }),
  "天の極の近く（DEC = ±(90° − δ)）": fc.record({ q: quat, ra, s: fc.constantFrom(1, -1), d: tiny }).map(({ q, ra, s, d }) => ({ q, ra, dec: s * (90 - d) })),
  "真反対の近く（なす角 = 180° − δ）": fc.record({ q: quat, p: dirOnSphere, d: tiny }).map(({ q, p, d }) => {
    const b = qrot(norm(q), [0, 0, 1]); const t = d === 0 ? b.map((x) => -x) : tilt(b.map((x) => -x), p, d); const [r, de] = dirToRadec(t); return { q, ra: r, dec: de };
  }),
  "ほぼ動かない（なす角 = δ）": fc.record({ q: quat, p: dirOnSphere, d: tiny }).map(({ q, p, d }) => {
    const b = qrot(norm(q), [0, 0, 1]); const t = d === 0 ? b : tilt(b, p, d); const [r, de] = dirToRadec(t); return { q, ra: r, dec: de };
  }),
  "DEC だけ変える（RA は今の光軸のまま）": fc.record({ q: quat, dec: decUniform }).map(({ q, dec }) => {
    const [r] = dirToRadec(qrot(norm(q), [0, 0, 1])); return { q, ra: r, dec };
  }),
};

if (process.env.CASE) {
  const { q, ra, dec } = JSON.parse(process.env.CASE);
  test("CASE の再現", () => { const r = run(q, ra, dec); console.log(JSON.stringify(r)); assert.equal(check(r), null); });
} else {
  const runs = Number(process.env.RUNS || 50);
  describe("姿勢変更の性質（PBT）", () => {
    for (const [name, arb] of Object.entries(cases)) {
      test(name, () => {
        fc.assert(fc.property(arb, ({ q, ra, dec }) => {
          const r = run(q, ra, dec), msg = check(r);
          if (msg) throw new Error(`${msg}（なす角 ${r.ang0?.toFixed(6)}°）`);
          return true;
        }), { numRuns: runs, seed: 20261004 });
      });
    }
  });
}
