/**
 * 高端可视化看板页面生成器（v2 - AntV G2Plot 暗色大屏风格）
 * 生成精美交互式 HTML 页面，上传到 OSS 通过钉钉 ActionCard 打开
 */
const dayjs = require('dayjs');

class DashboardHtml {
  generate(taskData, chartUrls = {}) {
    const { departments, summary } = taskData;
    const today = dayjs();
    const dateStr = today.format('YYYY年M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const totalPending = summary.totalTasks - summary.completedTasks;

    // 部门数据
    const deptSorted = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0));

    const deptChartData = [];
    for (const d of deptSorted) {
      const name = this._short(d.department);
      deptChartData.push({ dept: name, type: '待办', count: d.pendingCount || 0 });
      deptChartData.push({ dept: name, type: '已完成', count: d.completedCount || 0 });
    }

    // 状态数据
    const statusData = [
      { status: '推进中', count: summary.inProgressTasks || 0 },
      { status: '催办中', count: summary.pendingResponseTasks || 0 },
      { status: '阻塞', count: summary.blockedTasks || 0 },
      { status: '暂缓', count: summary.onHoldTasks || 0 },
      { status: '待启动', count: summary.notStartedTasks || 0 },
      { status: '已完成', count: summary.completedTasks || 0 },
    ].filter(d => d.count > 0);

    // 个人负荷
    const personMap = {};
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '';
        if (!owner) continue;
        personMap[owner] = (personMap[owner] || 0) + 1;
      }
    }
    const personData = Object.entries(personMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count }));

    // 异常事项
    const alerts = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        if (task.statusKey === 'blocked') {
          alerts.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 30), owner: task.owner || dept.owner || '', type: '阻塞', color: '#ff4d4f', level: 3 });
        }
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alerts.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 30), owner: task.owner || dept.owner || '', type: `逾期${days}天`, color: days > 5 ? '#ff4d4f' : '#fa8c16', level: days > 5 ? 3 : 2 });
        }
        if (task.statusKey === 'pending_response') {
          alerts.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 30), owner: task.owner || dept.owner || '', type: '催办中', color: '#faad14', level: 1 });
        }
      }
    }
    alerts.sort((a, b) => b.level - a.level);

    const alertsHtml = alerts.slice(0, 10).map(a =>
      `<div class="alert-row"><span class="tag" style="background:${a.color}">${a.type}</span><span class="dept">${a.dept}</span><span class="title">${a.title}</span><span class="owner">${a.owner}</span></div>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>任务管理看板 · ${today.format('M/D')}</title>
<script src="https://unpkg.com/@antv/g2plot@2/dist/g2plot.min.js"><\/script>
<style>
:root{--bg:#0a0e1a;--card:#111827;--border:rgba(255,255,255,0.06);--text:#e5e7eb;--sub:#6b7280;--accent:#3b82f6;--green:#10b981;--red:#ef4444;--orange:#f59e0b;--purple:#8b5cf6}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","SF Pro Display","Helvetica Neue",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}

.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
.topbar .logo{display:flex;align-items:center;gap:10px}
.topbar .logo .dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}
.topbar .logo h1{font-size:17px;font-weight:600;letter-spacing:0.5px}
.topbar .time{font-size:13px;color:var(--sub)}

.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 16px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:14px 14px 0 0}
.kpi.blue::before{background:linear-gradient(90deg,#3b82f6,#60a5fa)}
.kpi.green::before{background:linear-gradient(90deg,#10b981,#34d399)}
.kpi.red::before{background:linear-gradient(90deg,#ef4444,#f87171)}
.kpi.orange::before{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.kpi .value{font-size:36px;font-weight:700;letter-spacing:-1px;line-height:1}
.kpi.blue .value{color:#60a5fa}
.kpi.green .value{color:#34d399}
.kpi.red .value{color:#f87171}
.kpi.orange .value{color:#fbbf24}
.kpi .label{font-size:12px;color:var(--sub);margin-top:6px;text-transform:uppercase;letter-spacing:1px}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 20px 16px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;min-height:320px}
.panel.wide{grid-column:1/-1}
.panel-title{font-size:14px;font-weight:600;color:var(--sub);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.panel-title::before{content:'';width:3px;height:14px;border-radius:2px;background:var(--accent)}
.chart-box{width:100%;height:280px}

.alert-section{padding:0 20px 16px}
.alert-panel{background:var(--card);border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:16px}
.alert-panel h3{font-size:14px;color:#f87171;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.alert-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
.alert-row:last-child{border:none}
.tag{padding:2px 8px;border-radius:4px;color:#fff;font-size:11px;font-weight:600;white-space:nowrap}
.dept{color:var(--sub);min-width:50px;font-size:12px}
.title{flex:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.owner{color:var(--accent);white-space:nowrap;font-size:12px}

.footer{text-align:center;padding:20px;color:#374151;font-size:12px}
.footer .badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:4px 14px;border-radius:20px;color:#fff;font-size:11px;font-weight:500;margin-bottom:6px}

@media(max-width:640px){.kpi-row{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.kpi .value{font-size:28px}}
</style>
</head>
<body>

<div class="topbar">
  <div class="logo"><span class="dot"></span><h1>AI 任务管理驾驶舱</h1></div>
  <div class="time">${dateStr} ${weekday}</div>
</div>

<div class="kpi-row">
  <div class="kpi blue"><div class="value">${totalPending}</div><div class="label">待办事项</div></div>
  <div class="kpi green"><div class="value">${summary.completedTasks}</div><div class="label">已完成</div></div>
  <div class="kpi red"><div class="value">${summary.blockedTasks}</div><div class="label">阻塞</div></div>
  <div class="kpi orange"><div class="value">${summary.pendingResponseTasks || 0}</div><div class="label">催办中</div></div>
</div>

<div class="grid">
  <div class="panel wide">
    <div class="panel-title">部门任务分布</div>
    <div id="deptChart" class="chart-box"></div>
  </div>
  <div class="panel">
    <div class="panel-title">任务状态</div>
    <div id="statusChart" class="chart-box"></div>
  </div>
  <div class="panel">
    <div class="panel-title">个人负荷 TOP</div>
    <div id="personChart" class="chart-box"></div>
  </div>
</div>

${alerts.length > 0 ? `
<div class="alert-section">
  <div class="alert-panel">
    <h3>⚠ 异常事项 (${alerts.length})</h3>
    ${alertsHtml}
  </div>
</div>` : ''}

<div class="footer">
  <div class="badge">🤖 AI Powered</div>
  <div>AI 智能任务跟踪系统自动生成 · ${today.format('YYYY-MM-DD HH:mm')}</div>
</div>

<script>
var deptData = ${JSON.stringify(deptChartData)};
var statusData = ${JSON.stringify(statusData)};
var personData = ${JSON.stringify(personData)};

// 部门任务堆叠条形图
new G2Plot.Bar('deptChart', {
  data: deptData,
  isStack: true,
  xField: 'count',
  yField: 'dept',
  seriesField: 'type',
  color: ['#f87171', '#34d399'],
  barWidthRatio: 0.5,
  label: { position: 'middle', style: { fill: '#fff', fontSize: 12, fontWeight: 600 } },
  legend: { position: 'top-right', itemName: { style: { fill: '#9ca3af', fontSize: 12 } } },
  xAxis: { grid: { line: { style: { stroke: 'rgba(255,255,255,0.04)' } } }, label: { style: { fill: '#6b7280' } } },
  yAxis: { label: { style: { fill: '#d1d5db', fontSize: 13 } } },
  theme: { background: 'transparent' },
  barStyle: { radius: [0, 4, 4, 0] },
  tooltip: { domStyles: { 'g2-tooltip': { background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' } } },
}).render();

// 状态环形图
new G2Plot.Pie('statusChart', {
  data: statusData,
  angleField: 'count',
  colorField: 'status',
  radius: 0.85,
  innerRadius: 0.6,
  color: ['#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#6b7280', '#34d399'],
  label: { type: 'inner', content: '{value}', style: { fill: '#fff', fontSize: 13, fontWeight: 600 }, offset: '-25%' },
  legend: { position: 'right', itemName: { style: { fill: '#9ca3af', fontSize: 12 } }, itemSpacing: 8 },
  statistic: {
    title: { content: '总计', style: { color: '#6b7280', fontSize: '13px' } },
    content: { content: '${summary.totalTasks}', style: { color: '#e5e7eb', fontSize: '28px', fontWeight: 700 } },
  },
  theme: { background: 'transparent' },
  tooltip: { domStyles: { 'g2-tooltip': { background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' } } },
  pieStyle: { stroke: '#111827', lineWidth: 3 },
}).render();

// 个人负荷条形图
new G2Plot.Bar('personChart', {
  data: personData,
  xField: 'count',
  yField: 'name',
  seriesField: 'name',
  color: function(d) { var v = d.count || 0; return v > 30 ? '#f87171' : v > 20 ? '#fb923c' : v > 10 ? '#fbbf24' : '#60a5fa'; },
  barWidthRatio: 0.5,
  legend: false,
  label: { position: 'right', style: { fill: '#9ca3af', fontSize: 12 } },
  xAxis: { grid: { line: { style: { stroke: 'rgba(255,255,255,0.04)' } } }, label: { style: { fill: '#6b7280' } } },
  yAxis: { label: { style: { fill: '#d1d5db', fontSize: 13 } } },
  theme: { background: 'transparent' },
  barStyle: { radius: [0, 4, 4, 0] },
  tooltip: { domStyles: { 'g2-tooltip': { background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' } } },
}).render();
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
