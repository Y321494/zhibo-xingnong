/* 智播兴农 · 三创赛组队招募 —— 交互逻辑
 * 依赖：window.APP_CONFIG（config.js）、window.IAScoring（scoring.js）、data/questions.json
 * 注意：不调用任何 AI、不内置任何密钥；分数由 scoring.js 的固定规则计算。 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var Scoring = window.IAScoring;
  var DATA_URL = 'data/questions.json';
  var DRAFT_KEY = 'zhibo_draft_v1';

  var state = {
    data: null,
    config: CFG,
    directionId: '',
    answers: {},
    name: '',
    contact: '',
    grade: '大二',
    hours: '4–8 小时',
    consent: false,
    intro: '',
    short: {},
    order: {},
    report: null,
    submitting: false,
    submitted: false,
    autoSent: false
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(message, type, ms) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { el.className = 'toast hidden'; }, ms || 4200);
  }

  function notice(text) {
    var el = $('#mcq-notice');
    if (!el) return;
    if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  /* ---------------- 草稿（默认 sessionStorage：只在本标签页内有效） ---------------- */
  function storage() {
    try {
      if (CFG.draftStorage === 'none') return null;
      return CFG.draftStorage === 'local' ? window.localStorage : window.sessionStorage;
    } catch (err) { return null; }
  }

  function saveDraft() {
    var store = storage();
    if (!store) return;
    try {
      store.setItem(DRAFT_KEY, JSON.stringify({
        directionId: state.directionId,
        answers: state.answers,
        name: state.name,
        contact: state.contact,
        grade: state.grade,
        hours: state.hours,
        consent: state.consent,
        intro: state.intro,
        short: state.short
      }));
    } catch (err) { /* 隐私模式下忽略 */ }
  }

  function restoreDraft() {
    var store = storage();
    if (!store) return;
    try {
      var draft = JSON.parse(store.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      state.directionId = draft.directionId || state.directionId;
      state.answers = draft.answers || {};
      state.name = draft.name || '';
      state.contact = draft.contact || '';
      state.grade = draft.grade || state.grade;
      state.hours = draft.hours || state.hours;
      state.consent = !!draft.consent;
      state.intro = typeof draft.intro === 'string' ? draft.intro : '';
      state.short = draft.short || {};
    } catch (err) { /* 草稿坏了就当没有 */ }
  }

  function clearDraft() {
    var store = storage();
    try { if (store) store.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
  }

  /* ---------------- 渲染 ---------------- */
  function dims() { return state.data.dimensions || {}; }
  function questions() { return Scoring.questionsFor(state.data, state.directionId); }

  function renderIntro() {
    var intro = state.data.projectIntro || {};
    $('#project-title').textContent = intro.title || '项目介绍';
    $('#project-lead').textContent = intro.lead || '';
    $('#project-intro').innerHTML = (intro.sections || []).map(function (section) {
      return '<h3>' + esc(section.h) + '</h3>' +
        (section.p || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    }).join('');
  }

  function renderDirections() {
    var select = $('#cand-direction');
    select.innerHTML = state.data.directions.map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
    }).join('');
    select.value = state.directionId;

    $('#direction-cards').innerHTML = state.data.directions.map(function (d) {
      return '<div class="role-card" data-dir="' + esc(d.id) + '" role="button" tabindex="0">' +
        '<div class="role-name">' + esc(d.name) + '</div>' +
        '<div class="role-mission">' + esc(d.mission) + '</div>' +
        '<ul>' + (d.mustHave || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' +
        '</div>';
    }).join('');

    $$('#direction-cards .role-card').forEach(function (card) {
      card.addEventListener('click', function () { pickDirection(card.dataset.dir); });
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickDirection(card.dataset.dir); }
      });
    });
    select.addEventListener('change', function () { pickDirection(select.value); });
    paintDirections();
  }

  function paintDirections() {
    $$('#direction-cards .role-card').forEach(function (card) {
      var on = card.dataset.dir === state.directionId;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function pickDirection(id) {
    if (!id || id === state.directionId) return;
    state.directionId = id;
    state.answers = {};
    if ($('#cand-direction')) $('#cand-direction').value = id;
    paintDirections();
    renderMCQ();
    saveDraft();
    toast('已切换到「' + Scoring.directionOf(state.data, id).name + '」，题目已更新');
  }

  function renderMCQ() {
    var qs = questions();
    $('#mcq-list').innerHTML = qs.map(function (q, qi) {
      /* 每次都按同一份顺序渲染，但顺序是随机的：
         选项分值跟着选项对象走，打乱只影响位置，避免"按位置瞎选"拿分。 */
      if (!state.order[q.id]) {
        var idx = q.options.map(function (_, i) { return i; });
        for (var i = idx.length - 1; i > 0; i -= 1) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
        }
        state.order[q.id] = idx;
      }
      var order = state.order[q.id].filter(function (k) { return k < q.options.length; });
      return '<div class="q-card" data-qid="' + esc(q.id) + '">' +
        '<span class="q-tag">' + esc(q.tag) + '</span>' +
        '<div class="q-title">' + (qi + 1) + '. ' + esc(q.title) + '</div>' +
        '<div class="q-options">' + order.map(function (oi) {
          var o = q.options[oi];
          var checked = state.answers[q.id] === oi;
          return '<label class="opt' + (checked ? ' selected' : '') + '" data-oi="' + oi + '">' +
            '<input type="radio" name="q_' + esc(q.id) + '" value="' + oi + '"' + (checked ? ' checked' : '') + ' />' +
            '<span>' + esc(o.text) + '</span></label>';
        }).join('') + '</div></div>';
    }).join('');

    $$('#mcq-list .q-card').forEach(function (card) {
      var qid = card.dataset.qid;
      card.addEventListener('change', function (event) {
        var input = event.target;
        if (!input || input.type !== 'radio') return;
        state.answers[qid] = Number(input.value);
        $$('.opt', card).forEach(function (opt) { opt.classList.toggle('selected', opt.contains(input)); });
        card.classList.remove('error');
        notice('');
        saveDraft();
      });
    });
  }

  function renderShort() {
    var list = state.data.shortQuestions || [];
    $('#short-list').innerHTML = list.map(function (q, i) {
      var tag = (q.dimensionLabel || '') + (q.dimensionLabel ? ' · 占 30 分' : '');
      return '<div class="q-card" data-sid="' + esc(q.id) + '">' +
        (tag ? '<span class="q-tag">' + esc(tag) + '</span>' : '') +
        '<div class="q-title">' + (i + 1) + '. ' + esc(q.title) + '</div>' +
        '<p class="hint">' + esc(q.hint || '') + '</p>' +
        '<textarea class="short-input" rows="4" maxlength="' + (CFG.maxShortChars || 600) + '" ' +
        'placeholder="' + esc(q.placeholder || '写下你的回答……') + '">' + esc(state.short[q.id] || '') + '</textarea></div>';
    }).join('');

    $$('#short-list .short-input').forEach(function (area) {
      area.addEventListener('input', function () {
        state.short[area.closest('.q-card').dataset.sid] = area.value;
        saveDraft();
      });
    });
  }

  function renderRubric() {
    var wrap = $('#intro-rubric');
    if (!wrap) return;
    wrap.innerHTML = (state.data.introRubric || []).map(function (item) {
      return '<div><b>' + esc(item.label) + '</b>' + esc(item.desc) + '</div>';
    }).join('');
  }

  /* ---------------- 步骤 ---------------- */
  function goStep(n) {
    $$('.step').forEach(function (section) { section.classList.add('hidden'); });
    var target = $('#step' + n);
    if (target) {
      target.classList.remove('hidden');
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    $$('.stepper li').forEach(function (li) {
      var step = Number(li.dataset.step);
      li.classList.toggle('active', step === n);
      li.classList.toggle('done', step < n);
    });
    if (n === 5) renderReport();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 校验 ---------------- */
  function validateStep2() {
    if (!$('#consent').checked) {
      notice('请先勾选信息使用同意，团队才会保存你的联系方式。');
      $('#consent').focus();
      return false;
    }
    var contact = $('#cand-contact').value.trim();
    var contactEl = $('#cand-contact');
    if (!contact) {
      contactEl.classList.add('error');
      contactEl.focus();
      contactEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notice('联系方式是必填的：团队要靠它联系你。');
      return false;
    }
    contactEl.classList.remove('error');

    var missing = questions().filter(function (q) { return state.answers[q.id] === undefined; });
    if (missing.length) {
      $$('#mcq-list .q-card').forEach(function (card) {
        card.classList.toggle('error', state.answers[card.dataset.qid] === undefined);
      });
      var first = $('#mcq-list .q-card.error');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notice('还有 ' + missing.length + ' 道题没选完（已用红框标出）。');
      return false;
    }
    notice('');
    return true;
  }

  function validateStep3() {
    var text = $('#intro-text').value.trim();
    if (text.length < 10) {
      $('#intro-text').classList.add('error');
      $('#intro-text').focus();
      toast('自我介绍至少写一句，让团队知道你是谁', 'err');
      return false;
    }
    $('#intro-text').classList.remove('error');
    return true;
  }

  function validateStep4() {
    var list = state.data.shortQuestions || [];
    var short = list.filter(function (q) { return (state.short[q.id] || '').trim().length < 15; });
    if (short.length) {
      toast('还有 ' + short.length + ' 道简答题太短（少于 15 字），简答占了总分的 60%，认真写一句也行', 'err');
      var first = $('#short-list .short-input');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  /* ---------------- 报告 ---------------- */
  function currentInput() {
    return {
      directionId: state.directionId,
      answers: state.answers,
      name: state.name,
      contact: state.contact,
      grade: state.grade,
      hours: state.hours,
      intro: state.intro,
      short: state.short
    };
  }

  function criteriaList(block) {
    return (block.hits || []).map(function (item) {
      return '<li class="' + (item.hit ? 'hit' : 'miss') + '">' +
        '<span class="mark">' + (item.hit ? '✓' : '✗') + '</span>' +
        esc(item.label) + '<em>+' + item.weight + '</em></li>';
    }).join('');
  }

  function renderReport() {
    var report = Scoring.buildReport(state.data, currentInput());
    state.report = report;

    var verdictClass = report.verdict.level === 'maybe' ? ' maybe' : (report.verdict.level === 'weak' ? ' weak' : '');
    var dimHtml = report.dims.map(function (d) {
      return '<div class="dim">' +
        '<div class="dim-head"><span>' + esc(d.label) + ' <em>' + esc(d.competition) + '</em></span>' +
        '<span>' + d.value.toFixed(1) + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, d.value)) + '%"></i></div></div>';
    }).join('');

    var answered = report.mcq.answered + ' / ' + report.mcq.totalQuestions;
    var half = Math.round((report.weights.short / 2) * 10) / 10;

    var blocks =
      '<div class="text-block">' +
      '<div class="text-head"><b>简答 · 创意</b><span>' + report.creative.score + ' 分</span></div>' +
      '<ul class="criteria">' + criteriaList(report.creative) + '</ul></div>' +
      '<div class="text-block">' +
      '<div class="text-head"><b>简答 · 创业</b><span>' + report.startup.score + ' 分</span></div>' +
      '<ul class="criteria">' + criteriaList(report.startup) + '</ul></div>';

    $('#report').innerHTML =
      '<div class="big-score"><b>' + report.total.toFixed(1) + '</b><span>/ 100 参考分</span>' +
      '<span class="verdict' + verdictClass + '">' + esc(report.verdict.text) + '</span></div>' +
      '<p class="hint">' + esc(report.directionName) + ' 方向 · 已答 ' + answered + ' 题 · ' +
      esc(state.grade) + ' · 每周可投入 ' + esc(state.hours) + '</p>' +
      '<div class="split">' +
      '<div class="stat"><b>' + report.mcqTotal.toFixed(1) + '</b><span>选择题 · 占 ' + report.weights.mcq + '%</span></div>' +
      '<div class="stat"><b>' + report.creative.score + '</b><span>简答·创意 · 占 ' + half + '%</span></div>' +
      '<div class="stat"><b>' + report.startup.score + '</b><span>简答·创业 · 占 ' + half + '%</span></div>' +
      '</div>' +
      '<h3>选择题四维</h3>' +
      '<div class="dim-grid">' + dimHtml + '</div>' +
      '<h3>简答评分依据</h3>' +
      '<div class="text-scores">' + blocks + '</div>' +
      '<p class="note">' + esc(state.data.scoringNote || '') +
      ' 简答按规则逐条命中给分，没命中的项就是可以补的地方；分数只用于初筛，最终由团队人工复核。</p>';

    $('#preview-text').textContent = buildText();
    maybeAutoSubmit();
  }

  /* ---------------- 文本 ---------------- */
  function buildText() {
    var report = state.report || Scoring.buildReport(state.data, currentInput());
    var qs = questions();
    var lines = [];
    lines.push('【三创赛 · 智播兴农 组队报名】');
    lines.push('');
    lines.push('姓名：' + (report.extras.name || '（未填）'));
    lines.push('联系方式：' + (report.extras.contact || '（未填）'));
    lines.push('方向：' + report.directionName);
    lines.push('年级：' + (report.extras.grade || '（未填）'));
    lines.push('每周可投入：' + (report.extras.hours || '（未填）'));
    lines.push('提交时间：' + new Date().toLocaleString('zh-CN'));
    lines.push('');
    lines.push('—— 评估参考（本地规则计算，仅供初筛）——');
    lines.push('总分：' + report.total.toFixed(1) + ' / 100　' + report.verdict.text);
    lines.push('选择题（' + report.weights.mcq + '%）：' + report.mcqTotal.toFixed(1));
    lines.push('简答·创意（' + (report.weights.short / 2) + '%）：' + report.creative.score);
    lines.push('简答·创业（' + (report.weights.short / 2) + '%）：' + report.startup.score);
    lines.push('选择题四维：' + report.dims.map(function (d) { return d.label + ' ' + d.value.toFixed(1); }).join('，'));
    lines.push('创意得分点：' + hitLabels(report.creative));
    lines.push('创业得分点：' + hitLabels(report.startup));
    lines.push('');
    lines.push('—— 选择题 ——');
    qs.forEach(function (q, i) {
      var idx = state.answers[q.id];
      lines.push((i + 1) + '. ' + q.title);
      lines.push('   作答：' + (idx === undefined ? '（未作答）' : q.options[idx].text));
    });
    lines.push('');
    lines.push('—— 自我介绍 ——');
    lines.push((state.intro || '').trim() || '（未填写）');
    lines.push('');
    lines.push('—— 简答题 ——');
    (state.data.shortQuestions || []).forEach(function (q, i) {
      lines.push((i + 1) + '. ' + q.title);
      lines.push('   ' + ((state.short[q.id] || '').trim() || '（未填写）'));
    });
    return lines.join('\n');
  }

  function hitLabels(block) {
    var hit = (block.hits || []).filter(function (h) { return h.hit; }).map(function (h) { return h.label; });
    var miss = (block.hits || []).filter(function (h) { return !h.hit; }).map(function (h) { return h.label; });
    return (hit.length ? hit.join('；') : '无') + (miss.length ? '（未命中：' + miss.join('；') + '）' : '');
  }

  /* ---------------- 提交 ---------------- */
  function recipients() {
    var list = (CFG.recipients || []).slice();
    if (!list.length && CFG.teamMailbox) list = [CFG.teamMailbox];
    return list.filter(Boolean);
  }

  function recipientText() { return recipients().join('、'); }

  function submissionSubject(report) {
    return '【三创赛·智播兴农】报名：' + (report.extras.name || '同学') + ' · ' + report.directionName;
  }

  function copyText(text, okMessage) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      area.remove();
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  function onCopy() {
    var text = buildText();
    copyText(text).then(function (ok) {
      if (ok) {
        $('#send-status').textContent = '已复制。可粘贴到邮件正文，发给 ' + recipientText() + '。';
        toast('报名内容已复制', 'ok');
      } else {
        $('#send-status').textContent = '复制失败：请展开下面的预览，手动全选复制。';
        toast('复制失败，请手动复制', 'err');
      }
    });
  }

  function onDownload() {
    var text = buildText();
    var report = state.report || Scoring.buildReport(state.data, currentInput());
    var name = (report.extras.name || '报名').replace(/[\\/:*?"<>|\s]+/g, '') || '报名';
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '智播兴农-报名-' + name + '.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 3000);
    $('#send-status').textContent = '已下载 .txt，可作附件发到 ' + recipientText() + '。';
    toast('已下载报名文件', 'ok');
  }

  function openMailClient() {
    var report = state.report || Scoring.buildReport(state.data, currentInput());
    var to = recipients().join(',');
    copyText(buildText());
    window.location.href = 'mailto:' + to +
      '?subject=' + encodeURIComponent(submissionSubject(report)) +
      '&body=' + encodeURIComponent('（报名内容已复制到剪贴板，请粘贴到这里；太长就用下载的 .txt 作附件。）');
    $('#send-status').textContent = '已打开邮件客户端并复制内容：收件人 ' + recipientText() + '，粘贴后点发送即可。';
  }

  /* 提交：配了后端就自动投递，否则退化为打开邮件客户端 */
  function submit() {
    var url = (CFG.submitEndpoint || '').trim();
    if (url) return sendViaBackend(url);
    return openMailClient();
  }

  function sendViaBackend(url) {
    if (state.submitting || state.submitted) return;
    var button = $('#btn-submit');
    var report = state.report || Scoring.buildReport(state.data, currentInput());
    state.submitting = true;
    if (button) { button.disabled = true; button.textContent = '正在提交…'; }
    $('#send-status').textContent = '正在提交到 ' + recipientText() + '，最多等 15 秒…';

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: submissionSubject(report),
        text: buildText(),
        recipients: recipients(),
        submittedAt: new Date().toISOString()
      }),
      signal: controller.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().catch(function () { return { ok: true }; });
    }).then(function (data) {
      if (data && data.ok === false) throw new Error(data.error || '发送失败');
      state.submitting = false;
      state.submitted = true;
      if (data && data.dryRun) {
        if (button) { button.textContent = '已提交（测试）'; button.disabled = true; }
        $('#send-status').textContent = '已提交到发信服务，但当前是 dry-run 测试模式、没有真正发出邮件。团队配置发件邮箱后才会自动投递到 ' + recipientText() + '。';
        toast('已提交（测试模式，未真实发信）', 'ok');
        return;
      }
      if (button) { button.textContent = '已提交'; button.disabled = true; }
      $('#send-status').textContent = '✅ 已自动发送到 ' + recipientText() + '，可以关闭页面了。';
      toast('提交成功，团队会尽快联系你', 'ok');
    }).catch(function (err) {
      clearTimeout(timer);
      state.submitting = false;
      if (button) { button.disabled = false; button.textContent = '重新提交'; }
      $('#send-status').textContent = '提交失败（' + (err.message || '网络异常') + '）。可以点「复制内容」手动发到 ' + recipientText() + '。';
      toast('提交失败，请用复制或下载', 'err');
    });
  }

  /* 到达提交页后，先探测发信服务，可用就自动发送一次 */
  function maybeAutoSubmit() {
    var url = (CFG.submitEndpoint || '').trim();
    if (!url || !CFG.autoSubmit || state.autoSent || state.submitted || state.submitting) return;
    state.autoSent = true;
    var button = $('#btn-submit');
    if (button) { button.disabled = true; button.textContent = '检查发信服务…'; }

    fetch(url, { method: 'OPTIONS' })
      .then(function (res) { return res.ok || res.status === 204 || res.status === 200; })
      .catch(function () { return false; })
      .then(function (ok) {
        if (!ok) {
          state.autoSent = false;
          if (button) { button.disabled = false; button.textContent = '提交并发送'; }
          $('#send-status').textContent = '当前没有连上发信服务（' + url + '）：可以点「复制内容」或「下载 .txt」手动发到 ' + recipientText() + '。';
          return;
        }
        if (button) button.textContent = '自动提交中…';
        sendViaBackend(url);
      });
  }

  /* ---------------- 演示 ---------------- */
  function runDemo() {
    pickDirection(state.data.directions[0].id);
    $('#cand-name').value = '演示同学';
    state.name = '演示同学';
    $('#cand-contact').value = '13800000000';
    state.contact = '13800000000';
    $('#consent').checked = true;
    state.consent = true;
    state.hours = '8–15 小时';
    $('#cand-hours').value = state.hours;
    var qs = questions();
    qs.forEach(function (q, i) { state.answers[q.id] = Math.min(i, q.options.length - 1); });
    renderMCQ();
    state.intro = '大二做过校园二手交易账号，3 个月做到 1200 粉，单月成交 40 单，负责选品和客服。';
    $('#intro-text').value = state.intro;
    $('#intro-count').textContent = state.intro.length + ' / ' + (CFG.maxIntroChars || 3000);
    state.short.s1 = '先找 1 家合作社、2 个品类试播 4 场，看单场订单与退货率；如果 4 场都低于 8 单，就退回只做选品与话术工具，成本按每场 300 元算。';
    state.short.s2 = '大二做学院二手市集，我谈下 3 家摊主、定 5% 抽成，两天成交 61 单、流水 4300 元；第一场没明码标价被砍价，第二场改成明码标价加满减。';
    renderShort();
    goStep(5);
    maybeAutoSubmit();
  }

  /* ---------------- 初始化 ---------------- */
  function bind() {
    $('#btn-start').addEventListener('click', function () { goStep(2); });

    $('#cand-name').addEventListener('input', function (event) { state.name = event.target.value; saveDraft(); });
    $('#cand-contact').addEventListener('input', function (event) {
      state.contact = event.target.value;
      event.target.classList.remove('error');
      saveDraft();
    });
    $('#cand-grade').addEventListener('change', function (event) { state.grade = event.target.value; saveDraft(); });
    $('#cand-hours').addEventListener('change', function (event) { state.hours = event.target.value; saveDraft(); });
    $('#consent').addEventListener('change', function (event) { state.consent = event.target.checked; saveDraft(); });

    $('#intro-text').addEventListener('input', function (event) {
      state.intro = event.target.value;
      event.target.classList.remove('error');
      $('#intro-count').textContent = state.intro.length + ' / ' + (CFG.maxIntroChars || 3000);
      saveDraft();
    });

    $('#btn-to-step3').addEventListener('click', function () {
      state.name = $('#cand-name').value.trim();
      state.contact = $('#cand-contact').value.trim();
      state.grade = $('#cand-grade').value;
      if (!validateStep2()) return;
      saveDraft();
      goStep(3);
    });

    $('#btn-to-step4').addEventListener('click', function () {
      state.intro = $('#intro-text').value;
      if (!validateStep3()) return;
      saveDraft();
      goStep(4);
    });

    $('#btn-to-step5').addEventListener('click', function () {
      if (!validateStep4()) return;
      saveDraft();
      goStep(5);
    });

    $('#btn-submit').addEventListener('click', submit);
    $('#btn-copy').addEventListener('click', onCopy);
    $('#btn-download').addEventListener('click', onDownload);

    $('#btn-clear').addEventListener('click', function () {
      clearDraft();
      toast('本地草稿已清除', 'ok');
      $('#send-status').textContent = '草稿已清除；已填写的内容仍在本页，刷新后不再保留。';
    });

    $('#btn-restart').addEventListener('click', function () {
      clearDraft();
      window.location.href = window.location.pathname;
    });
  }

  function init() {
    if (!Scoring) {
      $('#project-intro').innerHTML = '<p class="hint">评分脚本加载失败，请检查 assets/scoring.js。</p>';
      return;
    }
    fetch(DATA_URL + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.data = data;
        state.directionId = (data.directions && data.directions[0] && data.directions[0].id) || '';
        restoreDraft();
        if (!state.directionId) state.directionId = (data.directions[0] || {}).id || '';

        if (data.competition && $('#stage-meta')) {
          $('#stage-meta').textContent = data.competition.edition + ' · ' + data.competition.track;
        }
        var school = (data.team && data.team.school) || '';
        if ($('#team-school')) $('#team-school').textContent = school;
        if ($('#footer-school')) $('#footer-school').textContent = school;
        if ($('#disclaimer')) $('#disclaimer').textContent = data.disclaimer || '';
        if ($('#team-mail')) $('#team-mail').textContent = recipientText();

        $('#cand-name').value = state.name;
        $('#cand-contact').value = state.contact;
        $('#cand-grade').value = state.grade;
        $('#cand-hours').value = state.hours;
        $('#consent').checked = state.consent;
        $('#intro-text').value = state.intro;
        $('#intro-count').textContent = state.intro.length + ' / ' + (CFG.maxIntroChars || 3000);

        renderIntro();
        renderDirections();
        renderMCQ();
        renderShort();
        renderRubric();
        bind();

        var demo = new URLSearchParams(window.location.search).get('demo') === '1';
        if (demo && CFG.allowDemo) runDemo(); else goStep(1);
      })
      .catch(function (err) {
        console.error(err);
        $('#project-intro').innerHTML =
          '<div class="notice">题库加载失败（' + esc(err.message) + '）。' +
          '请用本地服务器打开本页，例如在项目目录执行 <code>python -m http.server 8000</code>，' +
          '再访问 http://localhost:8000/。</div>';
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
