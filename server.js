/* ============================================================
   减脂挑战赛 · 共享后台（零依赖 Node.js）
   - 托管 index.html
   - GET  /api/state          读取全部数据
   - POST /api/bulk           按日期批量写入 4 人体重 {date, values:{id:kg}}
   - POST /api/record         单条写入 {date, person, weight}
   - POST /api/baseline       修改初始体重 {person, baseline}
   - POST /api/reset          重置为初始数据
   数据持久化在 data.json（与脚本同目录）。
   可选口令：启动时设置环境变量 PASS，写操作需带请求头 x-pass。
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PASS = process.env.PASS || '';

/* 初始数据（与 Excel 一致，用于首次启动 / 重置） */
const SEED = {
  comp: { start: "2026-08-01", end: "2026-10-31" },
  participants: [
    { id: "丹", name: "丹", color: "#ff3b6b", baseline: 131.6, join: "2026-08-01" },
    { id: "婷", name: "婷", color: "#3b82f6", baseline: 131.5, join: "2026-08-01" },
    { id: "莹", name: "莹", color: "#10b981", baseline: 137.6, join: "2026-08-06" },
    { id: "超", name: "超", color: "#f59e0b", baseline: 128.6, join: "2026-08-01" }
  ],
  records: {
    "2026-08-01": { 丹: 131.6, 婷: 129.3, 莹: null, 超: 125 },
    "2026-08-02": { 丹: 131.8, 婷: 128,   莹: null, 超: 127 },
    "2026-08-03": { 丹: 133,   婷: 128.7, 莹: null, 超: 127.6 },
    "2026-08-04": { 丹: 132.8, 婷: 129.3, 莹: null, 超: 127 },
    "2026-08-05": { 丹: 132.8, 婷: 128.6, 莹: null, 超: 127.4 },
    "2026-08-06": { 丹: 132.4, 婷: 128.2, 莹: 137.6, 超: 127 },
    "2026-08-07": { 丹: 131.4, 婷: 128.3, 莹: 137.1, 超: 126.5 },
    "2026-08-08": { 丹: 131.2, 婷: 128.3, 莹: 135.8, 超: 127 },
    "2026-08-09": { 丹: 130,   婷: 128.2, 莹: 136.2, 超: 127.3 },
    "2026-08-10": { 丹: 129.6, 婷: 128.9, 莹: 135.4, 超: 127.6 },
    "2026-08-11": { 丹: 129.6, 婷: 128.3, 莹: 136,   超: null }
  }
};

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const o = JSON.parse(raw);
    if (o && o.participants && o.records) return o;
  } catch (e) { /* 文件不存在或损坏，用种子 */ }
  return JSON.parse(JSON.stringify(SEED));
}
function saveData(data) {
  data.savedAt = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* 串行化所有写操作，避免并发覆盖 */
let writeChain = Promise.resolve();
function withWrite(fn) { writeChain = writeChain.then(fn, fn); return writeChain; }

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function passOk(req) { return !PASS || (req.headers['x-pass'] || '') === PASS; }
function norm(v) { return (v === null || v === '' || v === undefined) ? null : Number(v); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* 静态页面 */
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }

  /* 读取全部数据（公开） */
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return send(res, 200, loadData());
  }

  /* —— 以下为写操作，受口令保护 —— */
  if (req.method === 'POST' && url.pathname === '/api/bulk') {
    if (!passOk(req)) return send(res, 403, { error: '口令错误' });
    const b = await readBody(req);
    return withWrite(() => {
      if (!b.date || !b.values) return send(res, 400, { error: '缺少 date / values' });
      const data = loadData();
      if (!data.records[b.date]) data.records[b.date] = {};
      Object.keys(b.values).forEach(person => { data.records[b.date][person] = norm(b.values[person]); });
      saveData(data);
      return send(res, 200, data);
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/record') {
    if (!passOk(req)) return send(res, 403, { error: '口令错误' });
    const b = await readBody(req);
    return withWrite(() => {
      if (!b.date || !b.person) return send(res, 400, { error: '缺少 date / person' });
      const data = loadData();
      if (!data.records[b.date]) data.records[b.date] = {};
      data.records[b.date][b.person] = norm(b.weight);
      saveData(data);
      return send(res, 200, data);
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/baseline') {
    if (!passOk(req)) return send(res, 403, { error: '口令错误' });
    const b = await readBody(req);
    return withWrite(() => {
      const data = loadData();
      const p = data.participants.find(x => x.id === b.person);
      if (!p) return send(res, 400, { error: '未知选手' });
      p.baseline = Number(b.baseline);
      saveData(data);
      return send(res, 200, data);
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    if (!passOk(req)) return send(res, 403, { error: '口令错误' });
    return withWrite(() => {
      const data = JSON.parse(JSON.stringify(SEED));
      saveData(data);
      return send(res, 200, data);
    });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`🔥 减脂挑战赛服务已启动：http://localhost:${PORT}${PASS ? '（已启用编辑口令）' : ''}`);
});
