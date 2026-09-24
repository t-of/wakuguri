// わくぐりの決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test.mjs（node）の両方から読む。

// ---- 調整つまみ（長さは場の単位。場は 360 × 640 に固定し、画面に合わせて拡大・縮小して描く） ----
export const FIELD_W = 360;
export const FIELD_H = 640;
export const BALL_R = 8;
export const BALL_X = 180;
export const BALL_Y = 600;        // 玉のはじめの位置（中心）
export const GOAL_Y = 40;         // 玉の中心がこれより上に出たらゴール
export const LINE_W = 6;          // 輪の線の太さ
export const LENIENCY = 0.8;      // すき間の両端から「玉の半径ぶんの角度 × これ」内側なら通れる
export const MAX_STEP = 2;        // 1 回に調べる玉の進み（これより進むときは細かく分ける）
export const FAIL_WAIT = 0.5;     // 秒。当たってから玉が下に戻るまで
export const CLEAR_LOCK = 0.4;    // 秒。クリアのカードが出てからボタンを押せるまで

// ---- ステージ ----
// v: 玉の速さ（/ 秒）。輪: x, y = 中心、r = 半径、gaps = [はじまりの角度, 幅] のリスト（度）、
// w = 回る速さ（度 / 秒、正 = 時計回り）、a = はじめの角度（度。0 = すき間のはじまりが右向き）
// 数字は test.mjs の「通れる割合」で、番号が上がるほど下がるようにそろえてある（1 で約 38%、12 で約 5%）。
// 玉が輪を入ってから出るまでに輪が回る角度を ρ = 回る速さ × 2r ÷ v とすると、
// - すき間 1 つの輪は ρ が 180° に近いほど通りやすい（下で入ったすき間が、上に回ってきたところで出る）。大きな輪を速く回す
// - 小さな輪は ρ を 180° にすると速すぎるので、すき間を向かい合わせに 2 つにしてゆっくり回す（ρ が小さいほど通りやすい）
// - 輪が 2 つ以上のときは回る周期をそろえ（1.5 秒・2 秒・3 秒 など）、a でずらして割合を決める。a の 1° で割合が 0.4% ほど動く
// ステージを変えたら node test.mjs で割合を見直す
const ring = (x, y, r, gaps, w, a = 0) => ({ x, y, r, gaps, w, a });
const two = (w) => [[0, w], [180, w]];   // 向かい合わせのすき間 2 つ
export const STAGES = [
  { v: 200, rings: [ring(180, 320, 70, [[0, 180]], 240)] },                                   // 1 半円の輪
  { v: 200, rings: [ring(180, 320, 70, [[0, 150]], -250)] },                                  // 2 すき間が狭くなる、逆回り
  { v: 240, rings: [ring(180, 320, 90, [[0, 125]], 240)] },                                   // 3 大きく
  { v: 240, rings: [ring(180, 320, 90, two(70), -240)] },                                     // 4 すき間が 2 つ
  { v: 240, rings: [ring(180, 440, 60, two(100), 90), ring(180, 200, 60, two(100), -90, 165)] },   // 5 縦に 2 つ、逆回り
  { v: 240, rings: [ring(180, 440, 60, two(140), 60), ring(180, 200, 60, two(140), -120, 15)] },   // 6 速さがずれる
  { v: 260, rings: [ring(180, 320, 50, two(120), -60), ring(180, 320, 100, [[0, 120]], 240, 355)] },  // 7 輪の中に輪
  { v: 280, rings: [ring(180, 320, 50, two(90), 120), ring(180, 320, 100, [[0, 90]], -240, 30)] },    // 8 すき間が狭い輪の中に輪
  { v: 280, rings: [ring(180, 480, 50, two(125), 60), ring(180, 320, 50, two(125), -90), ring(180, 160, 50, two(125), 120, 130)] },  // 9 縦に 3 つ
  { v: 280, rings: [ring(180, 320, 140, [[0, 70]], 180), ring(180, 320, 40, two(90), -90, 97)] },    // 10 大きな輪と小さな輪
  { v: 300, rings: [ring(180, 320, 40, two(115), 90), ring(180, 320, 80, two(115), -60), ring(180, 320, 120, [[0, 115]], 240, 340)] },  // 11 三重の輪
  { v: 320, rings: [ring(180, 420, 50, two(110), 120), ring(180, 420, 100, [[0, 100]], -300, 5), ring(180, 170, 60, two(110), -150, 175)] },  // 12 まとめ
];

const mod = (a, n) => ((a % n) + n) % n;
const DEG = 180 / Math.PI;

// 輪の角度（時刻 t 秒）
export const ringAngle = (rg, t) => rg.a + rg.w * t;

// 玉（中心 bx, by）が輪 rg の線の帯に入っているか
export function inBand(rg, bx, by) {
  return Math.abs(Math.hypot(bx - rg.x, by - rg.y) - rg.r) < BALL_R + LINE_W / 2;
}

// 帯の中にいる玉が、時刻 t にすき間を通れる位置にいるか
export function inGap(rg, bx, by, t) {
  const th = Math.atan2(by - rg.y, bx - rg.x) * DEG;   // 画面は下が + なので、角度は時計回り
  const m = LENIENCY * (BALL_R / rg.r) * DEG;
  const phi = ringAngle(rg, t);
  return rg.gaps.some(([s, w]) => {
    const d = mod(th - phi - s, 360);
    return d >= m && d <= w - m;
  });
}

// ---- 1 ステージ分の状態 ----
// ball.state: 'ready'（下で待つ）/ 'fly'（飛んでいる）/ 'hit'（当たって止まった）/ 'goal'
export function newGame(n) {
  const st = STAGES[n - 1];
  return {
    n, st, t: 0, tries: 0, cleared: false,
    ball: { x: BALL_X, y: BALL_Y, state: 'ready', age: 0, passes: 0 },
    inside: st.rings.map(() => false),   // 玉が今その輪の帯に入っているか（抜けたら「通った」）
    hit: null,                           // { ring, x, y } 当たった所
  };
}

// 撃つ。飛んでいる間・当たって止まっている間は撃てない（false）
export function fire(g) {
  if (g.ball.state !== 'ready' || g.cleared) return false;
  g.ball.state = 'fly';
  g.ball.age = 0;
  g.ball.passes = 0;
  g.tries++;
  return true;
}

// 当たったあと、玉を下に戻す
export function reset(g) {
  if (g.ball.state !== 'hit') return false;
  g.ball = { x: BALL_X, y: BALL_Y, state: 'ready', age: 0, passes: 0 };
  g.inside = g.st.rings.map(() => false);
  g.hit = null;
  return true;
}

// 経過時間で進める。起きたことを返す: { type: 'pass', ring } / { type: 'hit', ring } / { type: 'goal' }
// 輪はずっと回り続ける（当たっても止めない・戻さない）
export function step(g, dt) {
  const ev = [];
  const b = g.ball;
  if (b.state !== 'fly') {
    g.t += dt;
    b.age += dt;
    if (b.state === 'hit' && b.age >= FAIL_WAIT) reset(g);
    return ev;
  }
  const n = Math.max(1, Math.ceil((g.st.v * dt) / MAX_STEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    g.t += h;
    b.age += h;
    b.y -= g.st.v * h;
    for (let k = 0; k < g.st.rings.length; k++) {
      const rg = g.st.rings[k];
      const on = inBand(rg, b.x, b.y);
      if (on && !inGap(rg, b.x, b.y, g.t)) {
        b.state = 'hit';
        b.age = 0;
        g.hit = { ring: k, x: b.x, y: b.y };
        ev.push({ type: 'hit', ring: k });
        g.t += h * (n - 1 - i);   // 残りの時間も輪は回る
        return ev;
      }
      if (g.inside[k] && !on) { b.passes++; ev.push({ type: 'pass', ring: k }); }
      g.inside[k] = on;
    }
    if (b.y < GOAL_Y) {
      b.state = 'goal';
      g.cleared = true;
      ev.push({ type: 'goal' });
      g.t += h * (n - 1 - i);
      return ev;
    }
  }
  return ev;
}

// ---- 通れる割合（自己チェック。ステージを変えたら見直す） ----
// 撃つ時刻を 0〜20 秒の間で 1/120 秒おきに全部試し、ゴールに届く割合を返す（0〜1）
export function passRate(n, { span = 20, every = 1 / 120, dt = 1 / 60 } = {}) {
  let ok = 0, all = 0;
  for (let t0 = 0; t0 < span - 1e-9; t0 += every) {
    const g = newGame(n);
    g.t = t0;
    fire(g);
    while (g.ball.state === 'fly') step(g, dt);
    if (g.cleared) ok++;
    all++;
  }
  return ok / all;
}

// ---- 共有の文 ----
export const shareText = (n, tries) => (n === STAGES.length
  ? `わくぐり 全 ${STAGES.length} ステージをくぐった`
  : `わくぐり ステージ ${n} を ${tries} 回目でくぐった`);

// ---- 保存（localStorage はほかのアプリと共有されるので、キーは 'wakuguri.' で始める） ----
export const SETTINGS_KEY = 'wakuguri.settings';
export const PROGRESS_KEY = 'wakuguri.progress';

// storage が null でも、読めなくても、壊れていてもはじめの値（音あり）
export function readSettings(storage) {
  try {
    const v = JSON.parse(storage.getItem(SETTINGS_KEY));
    if (v && v.v === 1 && typeof v.sound === 'boolean') return { sound: v.sound };
  } catch { /* 読めなければはじめの値 */ }
  return { sound: true };
}

export function writeSettings(storage, s) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, sound: s.sound })); } catch { /* 保存できなくても遊べる */ }
}

// best: { '1': 2, ... }。知らない値（1〜12 の外の番号、1 より小さい回数）は捨てる
export function readProgress(storage) {
  const best = {};
  try {
    const v = JSON.parse(storage.getItem(PROGRESS_KEY));
    if (v && v.v === 1 && v.best && typeof v.best === 'object') {
      for (const [k, x] of Object.entries(v.best)) {
        const n = Number(k);
        if (Number.isInteger(n) && n >= 1 && n <= STAGES.length && Number.isInteger(x) && x >= 1) best[n] = x;
      }
    }
  } catch { /* 読めなければクリアなし */ }
  return best;
}

// クリアを書く。記録を更新したら true（はじめてのクリアは false。記録の「更新」ではない）
export function writeClear(storage, best, n, tries) {
  const old = best[n];
  if (old != null && old <= tries) return false;
  best[n] = tries;
  try { storage.setItem(PROGRESS_KEY, JSON.stringify({ v: 1, best })); } catch { /* 保存できなくても遊べる */ }
  return old != null;
}

// 遊べるのは「クリアした一番大きい番号 + 1」まで
export function unlocked(best) {
  const top = Math.max(0, ...Object.keys(best).map(Number));
  return Math.min(STAGES.length, top + 1);
}

// つづきから: まだクリアしていない一番若いステージ（全部クリアしていたら 1）
export function nextStage(best) {
  for (let n = 1; n <= STAGES.length; n++) if (best[n] == null) return n;
  return 1;
}
