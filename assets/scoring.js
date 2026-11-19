/* 智播兴农 · 三创赛组队招募 —— 评分内核（纯函数，无 DOM）
 *
 * 总分 = 选择题 40% + 简答题 60%
 *   选择题：四个维度（洞察/商业/执行/交付，各 25）逐题归一化后加权，代表创新与表达交付。
 *   简答题：只打两个维度——创意（s1）与创业（s2），各占简答分的 50%，即总分的 30 / 30。
 *
 * 简答不调用 AI，按可解释的规则打分：每条判据命中即得分，报告里逐条展示依据，
 * 分数只是初筛参考，最终由团队人工复核。
 * 选择题选项在页面上会被打乱顺序，避免"按位置瞎选"拿高分。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IAScoring = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;

  /* ---------------- 基础工具 ---------------- */
  function clamp(n, min, max) {
    var v = Number(n);
    if (!isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  }

  function questionsFor(data, directionId) {
    var list = data.directions || [];
    var dir = list.filter(function (d) { return d.id === directionId; })[0] || list[0] || { roleQuestions: [] };
    var qs = (data.generalQuestions || []).slice();
    if (data.projectQuestion) qs.push(data.projectQuestion);
    return qs.concat(dir.roleQuestions || []);
  }

  function directionOf(data, directionId) {
    var list = data.directions || [];
    return list.filter(function (d) { return d.id === directionId; })[0] || list[0] || null;
  }

  function maxOfOption(option, key) {
    var s = (option && option.scores) || {};
    var v = Number(s[key]);
    return isFinite(v) ? v : 0;
  }

  function maxOfQuestion(question, key) {
    return (question.options || []).reduce(function (m, o) {
      return Math.max(m, maxOfOption(o, key));
    }, 0);
  }

  /* ---------------- 选择题 ---------------- */
  function scoreMCQ(questions, answers, dimensionKeys) {
    answers = answers || {};
    var keys = dimensionKeys || [];
    var sums = {};
    var answered = 0;
    keys.forEach(function (k) { sums[k] = 0; });

    questions.forEach(function (q) {
      var idx = answers[q.id];
      if (idx === undefined || idx === null) return;
      var option = (q.options || [])[idx];
      if (!option) return;
      answered += 1;
      keys.forEach(function (k) {
        var max = maxOfQuestion(q, k);
        sums[k] += max > EPS ? clamp(maxOfOption(option, k) / max, 0, 1) : 0;
      });
    });

    var percent = {};
    keys.forEach(function (k) {
      percent[k] = questions.length ? (sums[k] / questions.length) * 100 : 0;
    });

    return {
      percent: percent,
      answered: answered,
      totalQuestions: questions.length,
      complete: answered === questions.length && questions.length > 0
    };
  }

  function weightedTotal(percent, weights) {
    var keys = Object.keys(percent);
    var sum = 0;
    var wsum = 0;
    keys.forEach(function (k) {
      var w = Number((weights || {})[k]);
      if (!isFinite(w) || w <= 0) w = 1;
      sum += percent[k] * w;
      wsum += w;
    });
    return wsum > 0 ? sum / wsum : 0;
  }

  /* ---------------- 简答题（规则打分，可解释） ---------------- */
  var NUMBER_UNIT = /(\d+(?:\.\d+)?)\s*(单|元|块|万元|万|亿元|亿|粉|人|户|家|场|天|周|个月|月|年|%|％|gmv|GMV|客单)/;
  var ACTION = /(负责|做了|做过|带|跑|谈|搭|写|拍|卖|拉|组织|策划|运营|开发|安排|对接|落地|执行|自己上)/;

  var TEXT_RULES = {
    creative: {
      label: '创意',
      competition: '创意 25 分（3 成由简答决定）',
      gate: 15,
      rules: [
        {
          key: 'hypothesis', weight: 25, label: '说清了要验证的假设/切口',
          test: function (t) {
            return /(验证|假设|测试|试点|切口|先试|试播|试卖|先跑|跑一遍|小步|先做)/.test(t) &&
              /(农户|合作社|主播|选品|直播|品类|分成|代运营|服务|县域|客单)/.test(t);
          }
        },
        {
          key: 'metric', weight: 25, label: '给了可测指标（数字+单位）',
          test: function (t) { return NUMBER_UNIT.test(t); }
        },
        {
          key: 'economics', weight: 20, label: '算了成本、分成或可行性',
          test: function (t) { return /(成本|分成|回本|投入|预算|毛利|利润|价格|客单价|转化率|ROI|保底|抽成)/.test(t); }
        },
        {
          key: 'boundary', weight: 15, label: '写了失败条件或退路',
          test: function (t) { return /(失败|不成立|风险|放弃|备选|否则|退回|停止|调整|打住)/.test(t); }
        },
        {
          key: 'structure', weight: 15, label: '表达有条理（分句、分步）',
          test: function (t) {
            return t.length >= 60 && t.split(/[。；;，,、\n]/).filter(function (s) { return s.trim().length > 3; }).length >= 3;
          }
        }
      ]
    },
    startup: {
      label: '创业',
      competition: '创业 25 分（3 成由简答决定）',
      gate: 15,
      rules: [
        {
          key: 'role', weight: 25, label: '写清了自己的角色与动作',
          test: function (t) { return /(我|本人)/.test(t) && ACTION.test(t); }
        },
        {
          key: 'result', weight: 30, label: '有可核验的结果（数字）',
          test: function (t) { return NUMBER_UNIT.test(t); }
        },
        {
          key: 'scale', weight: 15, label: '交代了时间与规模',
          test: function (t) { return /(个月|周|天|学期|年|场|人|户|家)/.test(t) && NUMBER_UNIT.test(t); }
        },
        {
          key: 'review', weight: 15, label: '写了踩坑与改进',
          test: function (t) { return /(坑|问题|教训|复盘|改进|后来|调整|失败|反思|踩|改)/.test(t); }
        },
        {
          key: 'concrete', weight: 15, label: '具体、不空泛（长度与分句）',
          test: function (t) {
            return t.length >= 60 && t.split(/[。；;，,、\n]/).filter(function (s) { return s.trim().length > 3; }).length >= 3;
          }
        }
      ]
    }
  };

  function scoreText(answer, dimension) {
    var spec = TEXT_RULES[dimension];
    var text = String(answer == null ? '' : answer).trim();
    var hits = spec.rules.map(function (rule) {
      var hit = false;
      try { hit = !!rule.test(text); } catch (err) { hit = false; }
      return { key: rule.key, label: rule.label, weight: rule.weight, hit: hit };
    });
    var raw = hits.reduce(function (sum, item) { return sum + (item.hit ? item.weight : 0); }, 0);
    var score = text.length < spec.gate ? 0 : raw;
    return {
      dimension: dimension,
      label: spec.label,
      competition: spec.competition,
      score: clamp(score, 0, 100),
      hits: hits
    };
  }

  /* ---------------- 汇总 ---------------- */
  function verdictOf(total) {
    if (total >= 75) return { level: 'strong', text: '推荐进入面谈' };
    if (total >= 60) return { level: 'maybe', text: '待定，建议再聊一次' };
    return { level: 'weak', text: '暂不匹配当前岗位，可以先做预备任务' };
  }

  function buildReport(data, input) {
    input = input || {};
    var directionId = input.directionId || (data.directions && data.directions[0] && data.directions[0].id);
    var dir = directionOf(data, directionId);
    var questions = questionsFor(data, directionId);
    var dims = data.dimensions || {};
    var keys = Object.keys(dims);

    var mcq = scoreMCQ(questions, input.answers, keys);
    var mcqTotal = weightedTotal(mcq.percent, data.dimensionWeights || data.weights);

    var short = input.short || {};
    var creative = scoreText(short.s1, 'creative');
    var startup = scoreText(short.s2, 'startup');
    var textTotal = (creative.score + startup.score) / 2;

    var weights = data.weights || { mcq: 40, short: 60 };
    var wMcq = Number(weights.mcq) || 0;
    var wShort = Number(weights.short) || 0;
    var wSum = (wMcq + wShort) || 1;
    var total = (mcqTotal * wMcq + textTotal * wShort) / wSum;

    var dimList = keys.map(function (k) {
      return {
        key: k,
        label: (dims[k] && dims[k].label) || k,
        competition: (dims[k] && dims[k].competition) || '',
        desc: (dims[k] && dims[k].desc) || '',
        value: Math.round(mcq.percent[k] * 10) / 10
      };
    }).sort(function (a, b) { return b.value - a.value; });

    return {
      directionId: directionId,
      directionName: dir ? dir.name : '',
      total: Math.round(total * 10) / 10,
      mcqTotal: Math.round(mcqTotal * 10) / 10,
      textTotal: Math.round(textTotal * 10) / 10,
      weights: { mcq: wMcq, short: wShort },
      mcq: mcq,
      dims: dimList,
      creative: creative,
      startup: startup,
      verdict: verdictOf(total),
      extras: {
        name: input.name || '同学',
        contact: input.contact || '',
        email: input.email || '',
        grade: input.grade || '',
        hours: input.hours || '',
        intro: input.intro || '',
        short: short
      },
      questions: questions
    };
  }

  return {
    questionsFor: questionsFor,
    directionOf: directionOf,
    scoreMCQ: scoreMCQ,
    weightedTotal: weightedTotal,
    scoreText: scoreText,
    textRules: TEXT_RULES,
    verdictOf: verdictOf,
    buildReport: buildReport,
    clamp: clamp
  };
});
