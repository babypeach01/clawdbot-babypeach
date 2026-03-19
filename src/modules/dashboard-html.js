/**
 * 交互式看板生成器（v6 - 下钻 + 人工调整）
 *
 * 功能：
 *   1. 宏观图表：部门达成率柱状图 + KPI卡片
 *   2. 点击部门 → 展开任务明细（哪些完成/未完成/不计入）
 *   3. 人工调整：标记完成/未完成/排除统计，实时重算达成率
 *   4. 调整结果保存到服务器（POST /api/overrides）
 */
const dayjs = require('dayjs');

class DashboardHtml {
  generate(taskData, serverBaseUrl = '') {
    const { departments, summary } = taskData;
    const today = dayjs();
    const dateStr = today.format('YYYY年M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];

    // 构建完整的部门+任务数据（嵌入到HTML中）
    const deptData = departments
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0 || (d.tasks || []).length > 0)
      .map(d => {
        const tasks = (d.tasks || []).map((t, idx) => ({
          id: `${this._short(d.department)}_${idx}`,
          title: t.title || '',
          owner: t.owner || d.owner || '',
          status: t.status || '',
          statusKey: t.statusKey || 'in_progress',
          deadline: t.deadline || null,
          isCompleted: !!t.isCompleted,
          isBlocked: !!t.isBlocked,
          // 默认：已完成的计入完成，未完成的计入待办，都参与统计
          overrideStatus: t.isCompleted ? 'completed' : 'pending',
          excluded: false, // 是否排除出统计
        }));
        return {
          name: this._short(d.department),
          fullName: d.department,
          owner: d.owner || '',
          tasks,
        };
      });

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>工作看板 · ${today.format('M/D')}</title>
<script src="https://unpkg.com/@antv/g2plot@2/dist/g2plot.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f5f6fa;--card:#fff;--border:#e8eaef;--shadow:0 2px 8px rgba(0,0,0,0.06);--text:#1a1a2e;--sub:#8e8e93;--accent:#4A7FE5;--green:#45B369;--red:#E05858;--amber:#F0A050;--purple:#8B7FD4}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* 顶栏 */
.header{background:var(--card);border-bottom:1px solid var(--border);padding:18px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.header h1{font-size:16px;font-weight:600}
.header .meta{font-size:12px;color:var(--sub);margin-top:2px}
.save-hint{font-size:12px;color:var(--green);opacity:0;transition:opacity .3s}
.save-hint.show{opacity:1}

/* KPI */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 24px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;box-shadow:var(--shadow)}
.kpi .num{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi .lbl{font-size:11px;color:var(--sub);margin-top:3px}
.kpi.blue .num{color:var(--accent)}
.kpi.green .num{color:var(--green)}
.kpi.amber .num{color:var(--amber)}
.kpi.red .num{color:var(--red)}

/* 图表 */
.chart-section{padding:0 24px 10px}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;box-shadow:var(--shadow);margin-bottom:12px}
.chart-title{font-size:13px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.chart-title::before{content:'';width:3px;height:13px;border-radius:2px;background:var(--accent)}
#mainChart{width:100%;height:320px}

/* 部门列表 */
.dept-list{padding:0 24px 20px}
.dept-item{background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;box-shadow:var(--shadow);overflow:hidden;transition:all .2s}
.dept-header{padding:14px 18px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;transition:background .15s}
.dept-header:hover{background:#f8f9fc}
.dept-header:active{background:#f0f2f8}
.dept-left{display:flex;align-items:center;gap:10px}
.dept-name{font-size:14px;font-weight:600}
.dept-owner{font-size:12px;color:var(--sub)}
.dept-stats{display:flex;align-items:center;gap:12px}
.dept-rate{font-size:18px;font-weight:700;min-width:48px;text-align:right}
.dept-rate.high{color:var(--green)}
.dept-rate.mid{color:var(--amber)}
.dept-rate.low{color:var(--red)}
.dept-bar{width:80px;height:6px;background:#eee;border-radius:3px;overflow:hidden}
.dept-bar-fill{height:100%;border-radius:3px;transition:width .3s,background .3s}
.dept-arrow{font-size:12px;color:var(--sub);transition:transform .2s}
.dept-item.open .dept-arrow{transform:rotate(90deg)}
.dept-counts{font-size:11px;color:var(--sub);white-space:nowrap}

/* 任务列表 */
.task-list{display:none;border-top:1px solid var(--border);background:#fafbfd}
.dept-item.open .task-list{display:block}
.task-row{display:flex;align-items:center;padding:10px 18px;border-bottom:1px solid #f0f1f5;gap:10px;transition:background .1s}
.task-row:last-child{border-bottom:none}
.task-row:hover{background:#f4f5fa}
.task-row.excluded{opacity:.45}

/* 控制按钮 */
.task-controls{display:flex;gap:4px;flex-shrink:0}
.ctrl-btn{width:28px;height:28px;border-radius:6px;border:1.5px solid #ddd;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .15s}
.ctrl-btn:hover{border-color:#bbb;background:#f8f8f8}
.ctrl-btn.active-done{background:var(--green);border-color:var(--green);color:#fff}
.ctrl-btn.active-excl{background:#bbb;border-color:#bbb;color:#fff}

.task-info{flex:1;min-width:0}
.task-title{font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.task-row.completed .task-title{text-decoration:line-through;color:var(--sub)}
.task-meta{font-size:11px;color:var(--sub);margin-top:1px;display:flex;gap:8px}
.task-status{flex-shrink:0;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500}
.s-progress{background:#E8F0FE;color:#4A7FE5}
.s-blocked{background:#FEECEC;color:#E05858}
.s-pending{background:#FFF3E0;color:#F0A050}
.s-hold{background:#F0F0F5;color:#8e8e93}
.s-done{background:#E8F8EE;color:#45B369}
.overdue-tag{color:var(--red);font-weight:500}

/* 图例 */
.legend{display:flex;gap:16px;padding:10px 24px;font-size:12px;color:var(--sub)}
.legend-item{display:flex;align-items:center;gap:4px}
.legend-dot{width:8px;height:8px;border-radius:2px}

/* 底部 */
.foot{text-align:center;padding:20px;color:var(--sub);font-size:11px}

@media(max-width:600px){.kpis{grid-template-columns:repeat(2,1fr)}.dept-bar{display:none}}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>📊 工作看板</h1>
    <div class="meta">${dateStr} ${weekday}</div>
  </div>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="save-hint" id="saveHint">✓ 已保存</span>
  </div>
</div>

<div class="kpis">
  <div class="kpi blue"><div class="num" id="kTotal">-</div><div class="lbl">统计总数</div></div>
  <div class="kpi amber"><div class="num" id="kPending">-</div><div class="lbl">待办</div></div>
  <div class="kpi green"><div class="num" id="kDone">-</div><div class="lbl">已完成</div></div>
  <div class="kpi red"><div class="num" id="kRate">-</div><div class="lbl">达成率</div></div>
</div>

<div class="chart-section">
  <div class="chart-card">
    <div class="chart-title">部门达成率</div>
    <div id="mainChart"></div>
  </div>
</div>

<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> 点击 ✓ = 标记完成</div>
  <div class="legend-item"><div class="legend-dot" style="background:#bbb"></div> 点击 — = 排除统计</div>
  <div class="legend-item">点击部门行展开任务明细</div>
</div>

<div class="dept-list" id="deptList"></div>

<div class="foot">ClawdBot · ${today.format('YYYY-MM-DD HH:mm')} 生成 · 点击部门查看明细 · 调整后自动保存</div>

<script>
// ━━━ 嵌入数据 ━━━
var DEPTS = ${JSON.stringify(deptData)};
var SERVER = '${serverBaseUrl}';
var chart = null;

// ━━━ 从localStorage恢复覆盖状态 ━━━
function loadOverrides() {
  try {
    var saved = localStorage.getItem('clawdbot_overrides');
    if (!saved) return;
    var map = JSON.parse(saved);
    DEPTS.forEach(function(d) {
      d.tasks.forEach(function(t) {
        if (map[t.id]) {
          if (map[t.id].status) t.overrideStatus = map[t.id].status;
          if (map[t.id].excluded !== undefined) t.excluded = map[t.id].excluded;
        }
      });
    });
  } catch(e) {}
}

function saveOverrides() {
  var map = {};
  DEPTS.forEach(function(d) {
    d.tasks.forEach(function(t) {
      var defaultStatus = t.isCompleted ? 'completed' : 'pending';
      if (t.overrideStatus !== defaultStatus || t.excluded) {
        map[t.id] = { status: t.overrideStatus, excluded: t.excluded };
      }
    });
  });
  localStorage.setItem('clawdbot_overrides', JSON.stringify(map));
  // 尝试同步到服务器
  if (SERVER) {
    fetch(SERVER + '/api/overrides', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ overrides: map, updatedAt: new Date().toISOString() })
    }).catch(function(){});
  }
  var hint = document.getElementById('saveHint');
  hint.classList.add('show');
  setTimeout(function(){ hint.classList.remove('show'); }, 2000);
}

// ━━━ 计算统计 ━━━
function calcDeptStats(dept) {
  var total = 0, done = 0;
  dept.tasks.forEach(function(t) {
    if (t.excluded) return;
    total++;
    if (t.overrideStatus === 'completed') done++;
  });
  return { total: total, done: done, pending: total - done, rate: total > 0 ? Math.round(done / total * 100) : 0 };
}

function calcGlobalStats() {
  var total = 0, done = 0;
  DEPTS.forEach(function(d) {
    var s = calcDeptStats(d);
    total += s.total;
    done += s.done;
  });
  return { total: total, done: done, pending: total - done, rate: total > 0 ? Math.round(done / total * 100) : 0 };
}

// ━━━ 渲染KPI ━━━
function renderKPIs() {
  var g = calcGlobalStats();
  document.getElementById('kTotal').textContent = g.total;
  document.getElementById('kPending').textContent = g.pending;
  document.getElementById('kDone').textContent = g.done;
  document.getElementById('kRate').textContent = g.rate + '%';
}

// ━━━ 渲染图表 ━━━
function renderChart() {
  var data = DEPTS.map(function(d) {
    var s = calcDeptStats(d);
    return { dept: d.name, rate: s.rate, done: s.done, total: s.total };
  }).filter(function(d){ return d.total > 0; }).sort(function(a,b){ return a.rate - b.rate; });

  if (chart) { chart.changeData(data); return; }

  chart = new G2Plot.Bar('mainChart', {
    data: data,
    xField: 'rate',
    yField: 'dept',
    seriesField: 'dept',
    color: function(d) {
      var v = d.rate || 0;
      return v >= 60 ? '#45B369' : v >= 30 ? '#F0A050' : '#E05858';
    },
    maxBarWidth: 28,
    barWidthRatio: 0.5,
    legend: false,
    label: {
      position: 'right',
      content: function(d) { return d.rate + '% (' + d.done + '/' + d.total + ')'; },
      style: { fill: '#8e8e93', fontSize: 12 }
    },
    xAxis: { max: 100, grid: { line: { style: { stroke: 'rgba(0,0,0,0.04)' }}}, label: { style: { fill: '#8e8e93' }, formatter: function(v){ return v+'%'; } } },
    yAxis: { label: { style: { fill: '#3a3a4a', fontSize: 13, fontWeight: 600 } } },
    barStyle: { radius: [0, 6, 6, 0] },
    interactions: [{ type: 'active-region' }],
    theme: 'light'
  });
  chart.render();

  // 点击图表跳转到对应部门
  chart.on('element:click', function(ev) {
    var d = ev.data && ev.data.data;
    if (d && d.dept) {
      var el = document.querySelector('[data-dept="' + d.dept + '"]');
      if (el) { el.classList.add('open'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
  });
}

// ━━━ 状态样式 ━━━
function statusClass(key) {
  var m = { in_progress:'s-progress', blocked:'s-blocked', pending_response:'s-pending', on_hold:'s-hold', completed:'s-done', not_started:'s-hold' };
  return m[key] || 's-progress';
}
function statusLabel(key) {
  var m = { in_progress:'推进中', blocked:'阻塞', pending_response:'催办中', on_hold:'暂缓', completed:'已完成', not_started:'待启动' };
  return m[key] || '推进中';
}

// ━━━ 渲染部门列表 ━━━
function renderDeptList() {
  var container = document.getElementById('deptList');
  container.innerHTML = '';

  DEPTS.forEach(function(dept, di) {
    var stats = calcDeptStats(dept);
    var rateClass = stats.rate >= 60 ? 'high' : stats.rate >= 30 ? 'mid' : 'low';
    var barColor = stats.rate >= 60 ? 'var(--green)' : stats.rate >= 30 ? 'var(--amber)' : 'var(--red)';

    var el = document.createElement('div');
    el.className = 'dept-item';
    el.setAttribute('data-dept', dept.name);

    // 部门头
    var header = '<div class="dept-header" onclick="toggleDept(this)">';
    header += '<div class="dept-left">';
    header += '<span class="dept-arrow">▶</span>';
    header += '<span class="dept-name">' + dept.name + '</span>';
    if (dept.owner) header += '<span class="dept-owner">' + dept.owner + '</span>';
    header += '</div>';
    header += '<div class="dept-stats">';
    header += '<span class="dept-counts">' + stats.done + '完成 / ' + stats.pending + '待办' + (stats.total < dept.tasks.length ? ' / ' + (dept.tasks.length - stats.total) + '排除' : '') + '</span>';
    header += '<div class="dept-bar"><div class="dept-bar-fill" style="width:' + stats.rate + '%;background:' + barColor + '"></div></div>';
    header += '<span class="dept-rate ' + rateClass + '">' + stats.rate + '%</span>';
    header += '</div></div>';

    // 任务列表
    var taskHtml = '<div class="task-list">';
    dept.tasks.forEach(function(task, ti) {
      var isDone = task.overrideStatus === 'completed';
      var isExcl = task.excluded;
      var rowClass = 'task-row' + (isDone ? ' completed' : '') + (isExcl ? ' excluded' : '');

      taskHtml += '<div class="' + rowClass + '" data-di="' + di + '" data-ti="' + ti + '">';

      // 控制按钮
      taskHtml += '<div class="task-controls">';
      taskHtml += '<button class="ctrl-btn' + (isDone ? ' active-done' : '') + '" onclick="toggleDone(' + di + ',' + ti + ')" title="标记完成/未完成">✓</button>';
      taskHtml += '<button class="ctrl-btn' + (isExcl ? ' active-excl' : '') + '" onclick="toggleExcl(' + di + ',' + ti + ')" title="排除/纳入统计">—</button>';
      taskHtml += '</div>';

      // 任务信息
      taskHtml += '<div class="task-info">';
      taskHtml += '<div class="task-title">' + escHtml(task.title) + '</div>';
      taskHtml += '<div class="task-meta">';
      if (task.owner) taskHtml += '<span>' + escHtml(task.owner) + '</span>';
      if (task.deadline) {
        var dl = new Date(task.deadline);
        var now = new Date();
        var isOverdue = !isDone && dl < now;
        taskHtml += '<span' + (isOverdue ? ' class="overdue-tag"' : '') + '>截止 ' + (dl.getMonth()+1) + '/' + dl.getDate() + (isOverdue ? ' ⚠️' : '') + '</span>';
      }
      taskHtml += '</div></div>';

      // 原始状态标签
      taskHtml += '<span class="task-status ' + statusClass(task.statusKey) + '">' + statusLabel(task.statusKey) + '</span>';
      taskHtml += '</div>';
    });
    taskHtml += '</div>';

    el.innerHTML = header + taskHtml;
    container.appendChild(el);
  });
}

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ━━━ 交互逻辑 ━━━
function toggleDept(headerEl) {
  headerEl.parentElement.classList.toggle('open');
}

function toggleDone(di, ti) {
  var task = DEPTS[di].tasks[ti];
  task.overrideStatus = task.overrideStatus === 'completed' ? 'pending' : 'completed';
  refresh();
  saveOverrides();
}

function toggleExcl(di, ti) {
  var task = DEPTS[di].tasks[ti];
  task.excluded = !task.excluded;
  refresh();
  saveOverrides();
}

function refresh() {
  renderKPIs();
  renderChart();
  renderDeptList();
}

// ━━━ 初始化 ━━━
loadOverrides();
refresh();
<\/script>
</body>
</html>`;
  }

  _short(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 6);
  }
}

module.exports = new DashboardHtml();
