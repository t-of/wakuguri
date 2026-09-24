// node test.mjs — 画面を使わない部分のテスト（輪の回り方・当たり判定・撃つ／失敗／クリア・通れる割合・保存）
import assert from 'node:assert/strict';
import * as L from './logic.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

// 輪 1 つだけの場を作る
const solo = (rg, v = 240) => {
  L.STAGES.push({ v, rings: [rg] });
  const g = L.newGame(L.STAGES.length);
  L.STAGES.pop();
  return g;
};
const fly = (g, dt = 1 / 60) => { const ev = []; while (g.ball.state === 'fly') ev.push(...L.step(g, dt)); return ev; };

test('輪: 時計回り（正）で角度が進み、すき間の中・外を角度で判定する', () => {
  const rg = { x: 180, y: 320, r: 70, gaps: [[0, 90]], w: 90, a: 0 };
  assert.equal(L.ringAngle(rg, 2), 180);
  // 玉が輪の下（角度 90°）。すき間 [0, 90] の端すれすれは通れない、まん中なら通れる
  assert.equal(L.inGap(rg, 180, 390, 0), false);
  assert.equal(L.inGap(rg, 180, 390, 0.5), true);      // すき間が 45〜135° → 90° はまん中
  assert.equal(L.inGap(rg, 180, 250, 0.5), false);     // 上（270°）は線
  assert.ok(L.inBand(rg, 180, 390 + 10) && !L.inBand(rg, 180, 390 + 12));
});

test('当たり: すき間の端から「玉の半径ぶんの角度 × 0.8」内側なら通れる', () => {
  const rg = { x: 180, y: 320, r: 70, gaps: [[0, 90]], w: 0, a: 0 };
  const m = 0.8 * (8 / 70) * 180 / Math.PI;
  rg.a = 90 - m - 0.01;          // 玉の角度 90° がすき間のはじまりから m + 0.01 内側
  assert.equal(L.inGap(rg, 180, 390, 0), true);
  rg.a = 90 - m + 0.01;
  assert.equal(L.inGap(rg, 180, 390, 0), false);
});

test('撃つ: 1 回に 1 発。飛んでいる間は撃てず、挑戦回数は撃つたびに 1 足す', () => {
  const g = L.newGame(1);
  assert.equal(g.tries, 0);
  assert.equal(L.fire(g), true);
  assert.equal(L.fire(g), false);
  assert.equal(g.tries, 1);
  L.step(g, 0.1);
  assert.ok(Math.abs(g.ball.y - (600 - 20)) < 1e-9);   // ステージ 1 は 200 / 秒
});

test('すり抜けない: 1 回の更新が大きくても、細かく分けて線に当たる', () => {
  // すき間のない輪。1 秒（240px）を 1 回で進めても、輪の下の帯で当たる
  const g = solo({ x: 180, y: 320, r: 70, gaps: [[0, 1]], w: 0, a: 180 });
  L.fire(g);
  const ev = L.step(g, 1);
  assert.deepEqual(ev.map((e) => e.type), ['hit']);
  assert.equal(g.ball.state, 'hit');
  assert.ok(g.hit.y < 401 && g.hit.y >= 399);   // 帯（390 ± 11）に入ったところで止まる
});

test('失敗: 0.5 秒後に玉が下に戻る。輪は回り続ける', () => {
  const g = solo({ x: 180, y: 320, r: 70, gaps: [[0, 1]], w: 90, a: 180 });
  L.fire(g);
  fly(g);
  const t = g.t;
  L.step(g, 0.3);
  assert.equal(g.ball.state, 'hit');
  L.step(g, 0.3);
  assert.equal(g.ball.state, 'ready');
  assert.equal(g.ball.y, L.BALL_Y);
  assert.ok(Math.abs(g.t - (t + 0.6)) < 1e-9);
  assert.equal(L.fire(g), true);
  assert.equal(g.tries, 2);
});

test('クリア: すき間を 2 回通ってゴールに届く。通るたびに pass が出る', () => {
  // 回らない輪で、すき間が上下にある
  const g = solo({ x: 180, y: 320, r: 70, gaps: [[60, 60], [240, 60]], w: 0, a: 0 });
  L.fire(g);
  const ev = fly(g);
  assert.deepEqual(ev.map((e) => e.type), ['pass', 'pass', 'goal']);
  assert.equal(g.cleared, true);
  assert.equal(g.ball.passes, 2);
  assert.equal(L.fire(g), false);
});

test('通れる割合: 0% のステージがなく、番号が上がるほど下がる。1 は 30〜45%、12 は 3〜6%', () => {
  const rates = L.STAGES.map((_, i) => L.passRate(i + 1));
  console.log(`   通れる割合: ${rates.map((r, i) => `${i + 1}=${(r * 100).toFixed(1)}%`).join(' ')}`);
  assert.equal(L.STAGES.length, 12);
  rates.forEach((r, i) => assert.ok(r > 0, `ステージ ${i + 1} が通れない`));
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] < rates[i - 1], `ステージ ${i + 1} が ${i} より易しい`);
  assert.ok(rates[0] >= 0.3 && rates[0] <= 0.45, `ステージ 1: ${rates[0]}`);
  assert.ok(rates[11] >= 0.03 && rates[11] <= 0.06, `ステージ 12: ${rates[11]}`);
});

test('通れる割合: 画面の速さ（30・60・120Hz）で大きく変わらない', () => {
  for (let i = 1; i <= L.STAGES.length; i++) {
    const a = L.passRate(i, { dt: 1 / 30, every: 1 / 30 }), b = L.passRate(i, { dt: 1 / 120, every: 1 / 30 });
    assert.ok(Math.abs(a - b) < 0.01, `ステージ ${i}: ${a} / ${b}`);
  }
});

test('ステージ: 輪は場の中にあり、玉のはじめの位置とゴールの線にかからない', () => {
  for (const [i, st] of L.STAGES.entries()) {
    assert.ok(st.v >= 200 && st.v <= 360, `ステージ ${i + 1} の玉の速さ`);
    for (const rg of st.rings) {
      const pad = L.BALL_R + L.LINE_W / 2;
      assert.ok(rg.x - rg.r >= 0 && rg.x + rg.r <= L.FIELD_W, `ステージ ${i + 1} の輪が横にはみ出す`);
      assert.ok(rg.y + rg.r + pad < L.BALL_Y && rg.y - rg.r - pad > L.GOAL_Y, `ステージ ${i + 1} の輪が玉かゴールにかかる`);
    }
  }
});

// localStorage の代わり
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

test('保存: 設定は wakuguri.settings に { v: 1, sound }。読めなければ音あり', () => {
  const s = mem();
  assert.deepEqual(L.readSettings(s), { sound: true });
  L.writeSettings(s, { sound: false });
  assert.equal(s.m.get('wakuguri.settings'), '{"v":1,"sound":false}');
  assert.deepEqual(L.readSettings(s), { sound: false });
  assert.deepEqual(L.readSettings(null), { sound: true });
  assert.deepEqual(L.readSettings(mem({ 'wakuguri.settings': '{壊れた' })), { sound: true });
});

test('保存: 記録は wakuguri.progress に { v: 1, best }。知らない値は捨てる', () => {
  const s = mem({ 'wakuguri.progress': JSON.stringify({ v: 1, best: { 1: 2, 2: 0, 13: 1, x: 3, 3: 1.5, 4: 4 } }) });
  assert.deepEqual(L.readProgress(s), { 1: 2, 4: 4 });
  assert.deepEqual(L.readProgress(null), {});
  assert.deepEqual(L.readProgress(mem({ 'wakuguri.progress': 'null' })), {});
  const best = {};
  assert.equal(L.writeClear(s, best, 1, 5), false);   // はじめてのクリアは「更新」ではない
  assert.equal(L.writeClear(s, best, 1, 5), false);   // 同じ回数は書かない
  assert.equal(L.writeClear(s, best, 1, 3), true);
  assert.deepEqual(JSON.parse(s.m.get('wakuguri.progress')), { v: 1, best: { 1: 3 } });
  assert.equal(L.writeClear(null, best, 2, 1), false); // 保存できなくても落ちない
});

test('鍵とつづき: 遊べるのはクリアした一番大きい番号 + 1 まで。つづきはクリアしていない一番若い番号', () => {
  assert.equal(L.unlocked({}), 1);
  assert.equal(L.unlocked({ 1: 1, 2: 3 }), 3);
  assert.equal(L.unlocked({ 12: 1 }), 12);
  assert.equal(L.nextStage({ 1: 1, 2: 3 }), 3);
  const all = Object.fromEntries(L.STAGES.map((_, i) => [i + 1, 1]));
  assert.equal(L.nextStage(all), 1);
});

test('共有の文', () => {
  assert.equal(L.shareText(3, 7), 'わくぐり ステージ 3 を 7 回目でくぐった');
  assert.equal(L.shareText(12, 7), 'わくぐり 全 12 ステージをくぐった');
});

console.log(`\n${n} 件 合格`);
