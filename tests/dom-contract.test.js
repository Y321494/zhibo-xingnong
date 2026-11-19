const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'assets', 'config.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'questions.json'), 'utf8'));

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const used = new Set([...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
const missing = [...used].filter((id) => !ids.has(id));

const unusedHtmlIds = [...ids].filter((id) => !used.has(id));

const cfgKeys = ['recipients', 'submitEndpoint', 'autoSubmit', 'allowDemo', 'draftStorage', 'maxIntroChars', 'maxShortChars'];
const missingCfg = cfgKeys.filter((k) => !new RegExp(k + ':').test(config));
const cfgUsed = [...config.matchAll(/^\s{2}([A-Za-z]+):/gm)].map((m) => m[1]);
const unusedCfg = cfgUsed.filter((k) => !app.includes('CFG.' + k) && !app.includes("'APP_CONFIG'") && k !== 'teamMailbox');

console.log('index.html ids:', ids.size, '| app.js 使用的 id:', used.size);
console.log('缺失的 DOM 节点:', missing.length ? missing : '无');
console.log('HTML 中未被 JS 引用的 id:', unusedHtmlIds.length ? unusedHtmlIds : '无');
console.log('config 缺字段:', missingCfg.length ? missingCfg : '无');
console.log('config 中未被使用的字段:', unusedCfg.length ? unusedCfg : '无');

const dirs = data.directions.map((d) => d.id);
const qids = new Set();
data.directions.forEach((d) => {
  [...data.generalQuestions, data.projectQuestion, ...d.roleQuestions].forEach((q) => qids.add(q.id));
});
console.log('题目 id 总数:', qids.size, '| 方向:', dirs.join(', '));
console.log('维度:', Object.keys(data.dimensions).join(', '), '| 权重合计:', Object.values(data.weights).reduce((a, b) => a + b, 0));

if (missing.length || missingCfg.length) process.exit(1);
