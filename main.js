// わくぐり本体。決まりごと（ステージ・動き・当たり・保存）は logic.js、ここは画面・操作・描画・音。
import {
  FIELD_W, FIELD_H, BALL_R, BALL_X, BALL_Y, GOAL_Y, LINE_W, CLEAR_LOCK, STAGES,
  ringAngle, newGame, fire, reset, step, shareText,
  readSettings, writeSettings, readProgress, writeClear, unlocked, nextStage,
} from './logic.js';

WebAppKit.init({ title: 'わくぐり', text: '回っている輪のすき間を、玉がくぐり抜けるようにタップで撃ち出す。玉は輪を二度横切るので、入るときと出るときの両方ですき間が来る瞬間を読む。全 12 ステージ。' });

// https と localhost（開発・audit）で登録する。それ以外の http では serviceWorker がない
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const $ = (id) => document.getElementById(id);
// localStorage に触るだけで例外が出る環境もあるので、ここで受け止める
const storage = (() => { try { return localStorage; } catch { return null; } })();
const settings = readSettings(storage);
const best = readProgress(storage);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ---- 音（Web Audio で作る。音声ファイルは使わない） ----
// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
const sfx = {
  ctx: null,
  // 触ったときに呼ぶ（ブラウザは触る前の音を止める）
  unlock() {
    if (!settings.sound) return;
    setAudioSession(true);
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;   // 全体を控えめに
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, { at = 0, dur = 0.15, type = 'sine', gain = 0.12, to } = {}) {
    if (!settings.sound || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.03);
  },
  // 撃つ「ポン」
  fire() { this.tone(520, { dur: 0.08, gain: 0.14, to: 760 }); },
  // すき間を通る「チッ」。同じ 1 発で通るたびに少し高く（全音ずつ）
  pass(k) { this.tone(1400 * 2 ** ((k - 1) * 2 / 12), { dur: 0.04, type: 'triangle', gain: 0.07 }); },
  // 当たる「ボッ」
  hit() { this.tone(220, { dur: 0.12, type: 'triangle', gain: 0.16, to: 80 }); },
  // クリア（3 音）。記録更新なら高い音を 1 つ足す
  clear(isNew) {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, { at: i * 0.12, dur: 0.26, type: 'triangle', gain: 0.08 }));
    if (isNew) this.tone(1318.5, { at: 0.42, dur: 0.3, gain: 0.06 });
  },
  allClear() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, { at: i * 0.16, dur: 0.4, type: 'triangle', gain: 0.08 }));
  },
  button() { this.tone(880, { dur: 0.04, gain: 0.04 }); },
};
setAudioSession(settings.sound);
// 最初の音はユーザーが触ったときに（捕まえる段で先に呼ぶ）
addEventListener('pointerdown', () => sfx.unlock(), true);
addEventListener('keydown', () => sfx.unlock(), true);

function soundButton() {
  $('sound').setAttribute('aria-pressed', String(settings.sound));
  $('sound').textContent = settings.sound ? '音 オン' : '音 オフ';
}
$('sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  writeSettings(storage, settings);
  setAudioSession(settings.sound);
  soundButton();
  if (settings.sound) { sfx.unlock(); sfx.button(); }
});
soundButton();

// ---- 見た目（明るい地に、籐の輪と、つやのある玉。平らな 2D） ----
const BG = '#f3ede2';
const MUTED = '#8a8175';
const RING = '#9c6b36';        // 籐
const RING_LIT = '#e8bd72';    // すき間を通ったときに光る色
const BALL = '#d4462e';        // 朱
const HIT = '#e0302a';
const PASS_TIME = 0.25;        // 輪が光る秒数
const HIT_TIME = 0.5;          // 当たった所が赤く光る秒数
const BITS_TIME = 0.4;         // はじけたかけらが消えるまでの秒数

// すき間以外を線で描く。lit（0〜1）で明るい色を重ねる
function drawRing(c, rg, t, lit = 0) {
  const phi = ringAngle(rg, t) * Math.PI / 180;
  const gaps = rg.gaps.map(([s, w]) => [s * Math.PI / 180, w * Math.PI / 180]).sort((a, b) => a[0] - b[0]);
  c.beginPath();
  gaps.forEach(([s, w], i) => {
    const next = i + 1 < gaps.length ? gaps[i + 1][0] : gaps[0][0] + Math.PI * 2;
    const a = phi + s + w;
    c.moveTo(rg.x + rg.r * Math.cos(a), rg.y + rg.r * Math.sin(a));
    c.arc(rg.x, rg.y, rg.r, a, phi + next);
  });
  c.lineCap = 'butt';
  c.lineWidth = LINE_W;
  c.strokeStyle = RING;
  c.stroke();
  if (lit > 0) {
    c.globalAlpha = lit;
    c.lineWidth = LINE_W + 4;
    c.strokeStyle = RING_LIT;
    c.stroke();
    c.globalAlpha = 1;
  }
}

function drawBall(c, x, y) {
  c.fillStyle = BALL;
  c.beginPath();
  c.arc(x, y, BALL_R, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255, 255, 255, 0.55)';   // つや
  c.beginPath();
  c.arc(x - BALL_R * 0.35, y - BALL_R * 0.35, BALL_R * 0.32, 0, Math.PI * 2);
  c.fill();
}

function fitCanvas(cv, w, h) {
  const dpr = devicePixelRatio || 1;
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  return dpr;
}

// ---- タイトルの見本（動かない。すき間のある輪と、下の玉） ----
function drawSample() {
  const cv = $('sample');
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const dpr = fitCanvas(cv, r.width, r.height);
  const s = r.height / 160;   // 見本は高さ 160 の絵
  const c = cv.getContext('2d');
  c.setTransform(dpr * s, 0, 0, dpr * s, dpr * (r.width / 2 - 100 * s), 0);
  drawRing(c, { x: 100, y: 62, r: 48, gaps: [[-30, 130]], w: 0, a: 0 }, 0);
  c.strokeStyle = 'rgba(43, 38, 34, 0.25)';
  c.lineWidth = 1.5;
  c.setLineDash([3, 5]);
  c.beginPath(); c.moveTo(100, 136); c.lineTo(100, 4); c.stroke();
  c.setLineDash([]);
  drawBall(c, 100, 146);
}

// ---- タイトル（ステージの一覧） ----
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function buildStages() {
  const open = unlocked(best);
  const nx = nextStage(best);
  const cleared = Object.keys(best).length;
  const box = $('stages');
  box.textContent = '';
  for (let n = 1; n <= STAGES.length; n++) {
    const b = document.createElement('button');
    b.className = 'stage';
    const done = best[n] != null;
    b.classList.toggle('is-done', done);
    b.classList.toggle('is-next', n === nx && !done);
    if (n > open) {
      b.disabled = true;
      b.innerHTML = LOCK_SVG;
      b.setAttribute('aria-label', `ステージ ${n}（まだ遊べない）`);
    } else {
      b.innerHTML = `<b>${n}</b><small>${done ? `✓ ${best[n]} 回目` : ''}</small>`;
      b.setAttribute('aria-label', done ? `ステージ ${n}（${best[n]} 回目でクリア）` : `ステージ ${n}`);
      b.addEventListener('click', () => { sfx.button(); start(n); });
    }
    box.append(b);
  }
  $('continue').textContent = cleared === STAGES.length ? 'ステージ 1 から' : cleared ? `つづきから（ステージ ${nx}）` : 'はじめる';
}

// ---- 画面の切り替え（隠すときは display: none） ----
let screen = 'title';
function show(s) {
  screen = s;
  $('title').hidden = s !== 'title';
  $('play').hidden = s === 'title';
  $('clear').hidden = s !== 'clear';
}

// ---- 場 ----
const canvas = $('field');
const ctx = canvas.getContext('2d');
let scale = 1;   // 場の 1 単位が何 CSS px か
let dpr = 1;

// 場は 360 × 640。縦横比を変えずに、はみ出す向きは余白にする
function resize() {
  const wrap = $('fieldWrap');
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  if (!ww || !wh) return;
  scale = Math.min(ww / FIELD_W, wh / FIELD_H);
  dpr = fitCanvas(canvas, Math.floor(FIELD_W * scale), Math.floor(FIELD_H * scale));
  render();
}

let game = null;
let lit = [];        // 輪ごとの光る残り秒
let hitT = 0;        // 当たってからの秒
let bits = [];       // はじけた玉のかけら（見た目だけ）
let hint = true;     // 「タップで発射」
let lockUntil = 0;   // クリアのボタンを押せるようになる時刻
let raf = 0;
let last = 0;

function hud() {
  $('stageNo').textContent = game.n;
  $('tries').textContent = game.tries;
}

function start(n) {
  if (screen === 'clear' && performance.now() < lockUntil) return;
  game = newGame(n);
  lit = game.st.rings.map(() => 0);
  bits = [];
  hint = true;
  show('play');
  resize();
  hud();
  last = performance.now();
  if (!raf) raf = requestAnimationFrame(frame);
}

function toTitle() {
  if (screen === 'clear' && performance.now() < lockUntil) return;
  cancelAnimationFrame(raf);
  raf = 0;
  game = null;
  buildStages();
  show('title');
  drawSample();
}

function shoot() {
  if (screen !== 'play' || !game) return;
  if (game.ball.state === 'hit') { reset(game); bits = []; return; }   // 当たったあとのタップは、玉を戻すだけ
  if (!fire(game)) return;
  hint = false;
  sfx.fire();
  hud();
}

function burst(x, y) {
  if (reduced.matches) return;
  bits = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 60 + Math.random() * 90;
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.5 + Math.random() * 2 };
  });
}

function onClear() {
  const n = game.n, k = game.tries;
  const first = best[n] == null;
  const isNew = writeClear(storage, best, n, k);
  const all = n === STAGES.length;
  $('cTitle').textContent = all ? '全部くぐった' : 'くぐった';
  $('cStage').textContent = n;
  $('cTries').textContent = k;
  $('cNew').hidden = !isNew;
  $('cBest').textContent = first ? 'はじめてのクリア' : `記録 ${best[n]} 回目`;
  // 12 のあとは「次へ」の代わりに「ステージ一覧」を大きく
  $('next').hidden = all;
  $('toList').className = all ? 'big' : 'pill';
  lockUntil = performance.now() + CLEAR_LOCK * 1000;
  if (all) sfx.allClear(); else sfx.clear(isNew);
  show('clear');
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (game) {
    for (const e of step(game, dt)) {
      if (e.type === 'pass') { lit[e.ring] = PASS_TIME; sfx.pass(game.ball.passes); }
      else if (e.type === 'hit') { hitT = 0; burst(game.hit.x, game.hit.y); sfx.hit(); }
      else if (e.type === 'goal') onClear();
    }
    lit = lit.map((v) => Math.max(0, v - dt));
    hitT += dt;
    for (const b of bits) { b.x += b.vx * dt; b.y += b.vy * dt; }
    if (game.ball.state !== 'hit') bits = [];
  }
  render();
  raf = requestAnimationFrame(frame);
}

function render() {
  if (!game) return;
  const c = ctx;
  c.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  c.fillStyle = BG;
  c.fillRect(0, 0, FIELD_W, FIELD_H);

  // ゴールの線と、玉の通り道
  c.lineWidth = 1.5;
  c.setLineDash([6, 6]);
  c.strokeStyle = 'rgba(43, 38, 34, 0.3)';
  c.beginPath(); c.moveTo(24, GOAL_Y); c.lineTo(FIELD_W - 24, GOAL_Y); c.stroke();
  c.strokeStyle = 'rgba(43, 38, 34, 0.08)';
  c.beginPath(); c.moveTo(BALL_X, GOAL_Y); c.lineTo(BALL_X, BALL_Y); c.stroke();
  c.setLineDash([]);

  game.st.rings.forEach((rg, k) => drawRing(c, rg, game.t, lit[k] / PASS_TIME));

  const b = game.ball;
  if (b.state === 'hit') {
    // 当たった所の線が赤く光る
    const h = game.hit, rg = game.st.rings[h.ring];
    const a = Math.atan2(h.y - rg.y, h.x - rg.x);
    const span = (BALL_R * 2.2) / rg.r;
    c.globalAlpha = Math.max(0, 1 - hitT / HIT_TIME);
    c.strokeStyle = HIT;
    c.lineWidth = LINE_W + 4;
    c.beginPath(); c.arc(rg.x, rg.y, rg.r, a - span, a + span); c.stroke();
    c.globalAlpha = Math.max(0, 1 - hitT / BITS_TIME);
    c.fillStyle = BALL;
    for (const p of bits) { c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
    if (reduced.matches) drawBall(c, b.x, b.y);   // はじける動きをやめ、その場に残す
  } else {
    drawBall(c, b.x, b.y);
  }

  if (hint && b.state === 'ready') {
    c.fillStyle = MUTED;
    c.font = `600 14px system-ui, -apple-system, 'Hiragino Sans', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('タップで発射', BALL_X, BALL_Y + 24);
  }
}

// ---- 操作（タイミングのゲームなので、離すまで待たずに pointerdown で撃つ） ----
$('play').addEventListener('pointerdown', (e) => {
  if (screen !== 'play' || e.target.closest('button')) return;
  e.preventDefault();
  shoot();
});
addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (e.target.closest && e.target.closest('button, a')) return;   // ボタンの上では、そのボタンが押される
  e.preventDefault();
  if (e.repeat) return;
  if (screen === 'title') start(nextStage(best));
  else if (screen === 'play') shoot();
});
$('continue').addEventListener('click', () => { sfx.button(); start(nextStage(best)); });
$('back').addEventListener('click', () => { sfx.button(); toTitle(); });
$('next').addEventListener('click', () => { if (performance.now() < lockUntil) return; sfx.button(); start(game.n + 1); });
$('again').addEventListener('click', () => { if (performance.now() < lockUntil) return; sfx.button(); start(game.n); });
$('toList').addEventListener('click', () => { if (performance.now() < lockUntil) return; sfx.button(); toTitle(); });
$('shareClear').addEventListener('click', () => {
  if (performance.now() < lockUntil) return;
  WebAppKit.share({ text: shareText(game.n, game.tries) });
});
addEventListener('resize', () => { if (screen === 'title') drawSample(); else resize(); });

buildStages();
drawSample();
