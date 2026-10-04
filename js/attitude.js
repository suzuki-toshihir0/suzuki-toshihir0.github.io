// 背景の衛星の姿勢: 剛体の運動方程式と姿勢制御。ブラウザの部品には触らない（node から直接テストする）
// 本体には x・y・z 軸のリアクションホイール（RW）が 1 基ずつ入っていて、外からトルクはかからないので、
// 本体と RW を合わせた角運動量は一定に保たれる

// ---- 値は小型衛星としてありそうな大きさにした。SI 単位 ----
export const D2R = Math.PI / 180;
export const RPM = 60 / (2 * Math.PI);          // [rad/s] → [rpm]
const I = [0.05, 0.13, 0.10];                    // 本体の慣性モーメント [kg m^2]（主軸）
const JW = 0.003 / (6000 / RPM);                 // RW の慣性モーメント [kg m^2]。6000 rpm で 3 mNms
const OMAX = 6000 / RPM;                         // RW の最大回転数（±6000 rpm）
const TMAX = 0.001;                              // RW のモーターの最大トルク [N m]（1 mNm）
// 姿勢制御: 目標の姿勢との差（回転ベクトル）から目標の角速度を決め、RW のトルクで追従させる
const KP = 0.1;                                  // 姿勢の差 → 目標の角速度 [1/s]
const KR = 0.5;                                  // 角速度の差 → 角加速度 [1/s]
const WMAX = 1 * D2R;                            // 姿勢を変える速さの上限 [rad/s]（y 軸まわりで約 2.3 mNms。RW の 3 mNms に収まる）

// ---- ベクトルと四元数 ----
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, m) => Math.max(-m, Math.min(m, x));
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
// 四元数 q でベクトルを回す（本体座標 → 世界座標）
export const qrot = (q, [x, y, z]) => {
  const [w, a, b, c] = q;
  const tx = 2 * (b * z - c * y), ty = 2 * (c * x - a * z), tz = 2 * (a * y - b * x);
  return [x + w * tx + (b * tz - c * ty), y + w * ty + (c * tx - a * tz), z + w * tz + (a * ty - b * tx)];
};
// 四元数 → 回転ベクトル。sgn で四元数の符号（どちら回りか）を選ぶ
const rotvec = (q, sgn = Math.sign(q[0]) || 1) => {
  const [w, x, y, z] = q.map((v) => v * sgn);
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return [2 * x, 2 * y, 2 * z];
  const a = 2 * Math.atan2(s, w);
  return [x / s * a, y / s * a, z / s * a];
};

// ---- 赤経 [h]・赤緯 [deg] ↔ 世界座標の向き。天の北極が +y、赤経 0h が +x ----
export const radecToDir = (raH, decD) => {
  const ra = raH * 15 * D2R, de = decD * D2R;
  return [Math.cos(de) * Math.cos(ra), Math.sin(de), -Math.cos(de) * Math.sin(ra)];
};
export const dirToRadec = ([x, y, z]) => {
  let ra = Math.atan2(-z, x) / D2R / 15;
  if (ra < 0) ra += 24;
  if (ra >= 24 - 1e-9) ra = 0;   // 計算の誤差で 24.000h と出ないように
  return [ra, Math.asin(clamp(y, 1)) / D2R];
};

// 衛星を 1 機つくる。S は状態（描画と planner から読む）
export function createSim() {
  const S = {
    q: [1, 0, 0, 0],                  // 本体の姿勢（四元数。本体座標 → 世界座標）
    qt: [1, 0, 0, 0],                 // 目標の姿勢
    trd: [18, 0], tdir: [0, 0, 1],    // 目標の赤経 [h]・赤緯 [deg] と、その向き。最初の姿勢の光軸（世界 +z）に合わせる
    w: [0, 0, 0],                     // 本体の角速度 [rad/s]（本体座標）
    O: [0, 0, 0],                     // RW の回転数 [rad/s]
    phi: [0, 0, 0],                   // 描画用のスポークの角度
    qs: 1,                            // 姿勢の差の四元数の符号（どちら回りか。ヒステリシス付き）
  };

  // RW のモーターが RW にかけるトルク。反作用で本体には逆向きにかかる
  const motor = (w, O) => {
    // 本体座標での姿勢の差。四元数の符号（どちら回りか）にヒステリシスを持たせ、
    // 180° 付近で回る向きが小刻みに入れ替わらないようにする（反対側が 0.1 以上近くなるまで変えない）
    const qe = qmul(qconj(S.qt), S.q);
    if (qe[0] * S.qs < -0.1) S.qs = -S.qs;
    const e = rotvec(qe, S.qs);
    const h = O.map((o) => JW * o);
    const g = cross(w, [0, 1, 2].map((i) => I[i] * w[i] + h[i]));
    // 目標の角速度。向きを変える速さ（大きさ）が WMAX を超えないように縮める
    const raw = e.map((x) => -KP * x), rn = Math.hypot(...raw);
    const wc = rn > WMAX ? raw.map((x) => x * WMAX / rn) : raw;
    // I dω/dt = -ω×(Iω + h) - τ が k·I KR (wc - ω) になるように τ = -k·tc - g を決める。
    // トルクの上限を軸ごとに切ると角加速度の向きが曲がり、固有軸まわりの回転から外れるので、
    // 制御の分 tc の向きを保ったまま、全軸が上限に収まる最大の k（0〜1）で縮める
    const tc = [0, 1, 2].map((i) => I[i] * KR * (wc[i] - w[i]));
    let k = 1;
    for (let i = 0; i < 3; i++) {
      if (tc[i] > 0) k = Math.min(k, (TMAX - g[i]) / tc[i]);
      else if (tc[i] < 0) k = Math.min(k, (-TMAX - g[i]) / tc[i]);
    }
    k = Math.max(0, k);
    return [0, 1, 2].map((i) => {
      let t = clamp(-k * tc[i] - g[i], TMAX);   // ジャイロ効果だけで上限を超える場合の保険
      if ((O[i] >= OMAX && t > 0) || (O[i] <= -OMAX && t < 0)) t = 0;   // 回転数の上限で飽和
      return t;
    });
  };
  // オイラーの運動方程式（RW 付き）: I dω/dt = -ω×(Iω + h) - τ,  dh/dt = τ
  const deriv = (w, O) => {
    const t = motor(w, O);
    const h = O.map((o) => JW * o);
    const g = cross(w, [0, 1, 2].map((i) => I[i] * w[i] + h[i]));
    return [[0, 1, 2].map((i) => (-g[i] - t[i]) / I[i]), t.map((x) => x / JW)];
  };
  const step = (dt) => {
    // ω と RW の回転数は 4 次のルンゲ・クッタで積分
    const add = (a, b, k) => a.map((x, i) => x + b[i] * k);
    const [k1w, k1o] = deriv(S.w, S.O);
    const [k2w, k2o] = deriv(add(S.w, k1w, dt / 2), add(S.O, k1o, dt / 2));
    const [k3w, k3o] = deriv(add(S.w, k2w, dt / 2), add(S.O, k2o, dt / 2));
    const [k4w, k4o] = deriv(add(S.w, k3w, dt), add(S.O, k3o, dt));
    S.w = S.w.map((x, i) => x + dt / 6 * (k1w[i] + 2 * k2w[i] + 2 * k3w[i] + k4w[i]));
    S.O = S.O.map((x, i) => clamp(x + dt / 6 * (k1o[i] + 2 * k2o[i] + 2 * k3o[i] + k4o[i]), OMAX));
    // 姿勢は、その間の回転を四元数で掛け合わせて進める
    const [wx, wy, wz] = S.w, n = Math.hypot(wx, wy, wz);
    if (n > 1e-12) {
      const a = n * dt / 2, s = Math.sin(a) / n;
      S.q = qmul(S.q, [Math.cos(a), wx * s, wy * s, wz * s]);
      const m = Math.hypot(...S.q);
      S.q = S.q.map((x) => x / m);
    }
    // スポークは実際の回転数の 1/40 の速さで描く（そのままだと速すぎて止まって見える）
    S.phi = S.phi.map((p, i) => (p + S.O[i] * dt / 40) % (2 * Math.PI));
  };

  const boresight = () => qrot(S.q, [0, 0, 1]);   // カメラの光軸（本体 +z）の向き
  // 目標の姿勢: 今の姿勢から、カメラの光軸を t へ向けるのに必要な最小の回転（大円に沿う回転）をかけたもの。
  // 光軸まわりの向きを天の北などの外の基準で決めないので、天の極に特異点が無い。
  // DEC だけ変えたときは、今の向きと目標が同じ子午線の上にあるので、光軸は子午線に沿って動き RA は変わらない。
  // 真反対（180°）のときだけ回る軸が決まらないので、本体の x 軸まわりに回すことにする
  const pointingQuat = (t) => {
    const b = boresight();
    const d = clamp(b[0] * t[0] + b[1] * t[1] + b[2] * t[2], 1);
    let ax = cross(b, t), n = Math.hypot(...ax), ang = Math.atan2(n, d);
    if (n < 1e-9) {
      if (d > 0) return S.q.slice();                     // もう向いている
      ax = qrot(S.q, [1, 0, 0]); n = 1; ang = Math.PI;   // 真反対
    }
    const sh = Math.sin(ang / 2) / n;
    return qmul([Math.cos(ang / 2), ax[0] * sh, ax[1] * sh, ax[2] * sh], S.q);   // 世界座標での回転を左からかける
  };
  const setPoint = (raH, decD) => {
    S.trd = [((raH % 24) + 24) % 24, clamp(decD, 90)];
    S.tdir = radecToDir(...S.trd);
    S.qt = pointingQuat(S.tdir);
  };
  // 本体と RW を合わせた角運動量の大きさ（外からトルクがかからないので 0 のまま）
  const momentum = () => Math.hypot(...[0, 1, 2].map((i) => I[i] * S.w[i] + JW * S.O[i]));

  return { S, step, setPoint, momentum, boresight, current: () => dirToRadec(boresight()) };
}
