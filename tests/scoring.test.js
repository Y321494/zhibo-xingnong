/* 评分内核回归测试：node tests/scoring.test.js
 * 重点守护：简答参与计分（占 60%）、乱答不得推荐、选择题最多只能拿 40 分。 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Scoring = require('../assets/scoring.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf8'));

const DIMS = Object.keys(data.dimensions);
const GOOD_SHORT = {
  s1: '先找 1 家合作社、2 个品类试播 4 场，看单场订单和退货率；如果 4 场都低于 8 单，就退回只做选品与话术工具，成本按每场 300 元算。',
  s2: '大二做学院二手市集，我谈下 3 家摊主、定 5% 抽成，两天成交 61 单、流水 4300 元；第一场没明码标价被砍价，第二场改成明码标价加满减。'
};

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  ✗ ' + name + '\n      ' + err.message);
  }
}

function bestOption(q) {
  let best = 0;
  let bestSum = -Infinity;
  q.options.forEach((o, i) => {
    const sum = Object.values(o.scores || {}).reduce((a, b) => a + b, 0);
    if (sum > bestSum) { bestSum = sum; best = i; }
  });
  return best;
}

function worstOption(q) {
  let worst = 0;
  let worstSum = Infinity;
  q.options.forEach((o, i) => {
    const sum = Object.values(o.scores || {}).reduce((a, b) => a + b, 0);
    if (sum < worstSum) { worstSum = sum; worst = i; }
  });
  return worst;
}

function answerAll(questions, picker) {
  const answers = {};
  questions.forEach((q) => { answers[q.id] = picker(q); });
  return answers;
}

console.log('数据结构');
test('四个方向，每个方向 2 道方向题', () => {
  assert.ok(data.directions.length >= 3, '方向数不足');
  data.directions.forEach((d) => assert.strictEqual(d.roleQuestions.length, 2, d.id + ' 方向题数量不是 2'));
});
test('权重：选择题 40 + 简答 60 = 100，四维合计 100', () => {
  assert.strictEqual(Number(data.weights.mcq) + Number(data.weights.short), 100);
  assert.strictEqual(Number(data.weights.mcq), 40);
  const dimSum = DIMS.reduce((a, k) => a + Number(data.dimensionWeights[k] || 0), 0);
  assert.strictEqual(dimSum, 100);
});
test('简答题只有两道，分别对应创意与创业', () => {
  assert.strictEqual(data.shortQuestions.length, 2);
  assert.deepStrictEqual(data.shortQuestions.map((q) => q.dimension), ['creative', 'startup']);
});
test('每道选择题四个选项，分值 1–5', () => {
  data.directions.forEach((d) => {
    const qs = Scoring.questionsFor(data, d.id);
    assert.strictEqual(qs.length, 5, d.id + ' 题量不是 5');
    qs.forEach((q) => {
      assert.strictEqual(q.options.length, 4, q.id + ' 选项数不是 4');
      q.options.forEach((o) => {
        DIMS.forEach((k) => {
          const v = Number(o.scores[k]);
          assert.ok(v >= 1 && v <= 5, q.id + ' 的 ' + k + ' 分值越界: ' + v);
        });
      });
    });
  });
});

console.log('选择题：权重被压到 40%');
data.directions.forEach((d) => {
  const qs = Scoring.questionsFor(data, d.id);
  const best = Scoring.buildReport(data, { directionId: d.id, answers: answerAll(qs, bestOption), short: { s1: '', s2: '' } });
  const worst = Scoring.buildReport(data, { directionId: d.id, answers: answerAll(qs, worstOption), short: { s1: '', s2: '' } });

  test(d.id + '：只做选择题（简答空）最高不超过 40 分', () => {
    assert.ok(best.total <= 40.5, '选择题单独就拿到了 ' + best.total + ' 分');
  });
  test(d.id + '：选择题最差不会高于 30 分', () => {
    assert.ok(worst.total < 30, '最差选择题 ' + worst.total);
  });
  test(d.id + '：选择题最优仍明显高于最差', () => {
    assert.ok(best.total - worst.total >= 8, '分差仅 ' + (best.total - worst.total).toFixed(1));
  });
});

console.log('简答题：规则打分');
test('空答案 0 分', () => {
  assert.strictEqual(Scoring.scoreText('', 'creative').score, 0);
  assert.strictEqual(Scoring.scoreText('不知道', 'startup').score, 0);
});
test('少于 15 字一律 0 分', () => {
  assert.strictEqual(Scoring.scoreText('我做过直播，卖了 30 单', 'startup').score, 0);
});
test('认真写的创意答案至少命中 3 条判据', () => {
  const r = Scoring.scoreText(GOOD_SHORT.s1, 'creative');
  assert.ok(r.hits.filter((h) => h.hit).length >= 3, '只命中 ' + r.hits.filter((h) => h.hit).length + ' 条');
  assert.ok(r.score >= 60, '创意分只有 ' + r.score);
});
test('认真写的创业答案至少命中 4 条判据', () => {
  const r = Scoring.scoreText(GOOD_SHORT.s2, 'startup');
  assert.ok(r.hits.filter((h) => h.hit).length >= 4, '只命中 ' + r.hits.filter((h) => h.hit).length + ' 条');
  assert.ok(r.score >= 70, '创业分只有 ' + r.score);
});
test('每条判据都带权重且总权重 100', () => {
  ['creative', 'startup'].forEach((dim) => {
    const hits = Scoring.scoreText(GOOD_SHORT.s1, dim).hits;
    assert.strictEqual(hits.reduce((a, h) => a + h.weight, 0), 100);
  });
});

console.log('组合：乱答简答休想拿推荐');
test('选择题满分 + 简答乱写 → 不到推荐线', () => {
  const qs = Scoring.questionsFor(data, 'content');
  const report = Scoring.buildReport(data, {
    directionId: 'content',
    answers: answerAll(qs, bestOption),
    short: { s1: '随便', s2: '不知道' }
  });
  assert.ok(report.total < 75, '乱答简答仍然拿到 ' + report.total + ' 分（' + report.verdict.text + '）');
});
test('选择题很差 + 简答认真 → 达到待定以上', () => {
  const qs = Scoring.questionsFor(data, 'content');
  const report = Scoring.buildReport(data, {
    directionId: 'content',
    answers: answerAll(qs, worstOption),
    short: GOOD_SHORT
  });
  assert.ok(report.total >= 55, '只有 ' + report.total + ' 分');
});
test('认真简答比乱答显著更高', () => {
  const qs = Scoring.questionsFor(data, 'content');
  const answers = answerAll(qs, (q) => 1);
  const bad = Scoring.buildReport(data, { directionId: 'content', answers, short: { s1: '不知道', s2: '随便' } });
  const good = Scoring.buildReport(data, { directionId: 'content', answers, short: GOOD_SHORT });
  assert.ok(good.total - bad.total >= 25, '分差仅 ' + (good.total - bad.total).toFixed(1));
});
test('总分落在 0–100，且各分项都有值', () => {
  const qs = Scoring.questionsFor(data, 'tech');
  const report = Scoring.buildReport(data, { directionId: 'tech', answers: answerAll(qs, bestOption), short: GOOD_SHORT });
  assert.ok(report.total >= 0 && report.total <= 100);
  assert.ok(report.mcqTotal >= 0 && report.mcqTotal <= 100);
  assert.ok(report.creative.score >= 0 && report.creative.score <= 100);
  assert.ok(report.startup.score >= 0 && report.startup.score <= 100);
  assert.strictEqual(report.weights.mcq, 40);
  assert.strictEqual(report.weights.short, 60);
});
test('未作答为 0 分', () => {
  const report = Scoring.buildReport(data, { directionId: 'content', answers: {}, short: {} });
  assert.strictEqual(report.total, 0);
  assert.strictEqual(report.mcq.answered, 0);
});
test('单题变优不会降低总分', () => {
  const qs = Scoring.questionsFor(data, 'content');
  const base = Object.assign(answerAll(qs, worstOption), {});
  const baseTotal = Scoring.buildReport(data, { directionId: 'content', answers: base, short: GOOD_SHORT }).total;
  qs.forEach((q) => {
    const next = Object.assign({}, base);
    next[q.id] = bestOption(q);
    const total = Scoring.buildReport(data, { directionId: 'content', answers: next, short: GOOD_SHORT }).total;
    assert.ok(total >= baseTotal - 0.05, q.id + ' 变优后总分反而下降');
  });
});

console.log('\n' + passed + ' 项通过，' + failures.length + ' 项失败');
if (failures.length) process.exit(1);
