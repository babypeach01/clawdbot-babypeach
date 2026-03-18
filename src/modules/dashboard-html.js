/**
 * 高端可视化看板页面生成器（v3 - AntV G2Plot 暗色大屏驾驶舱）
 *
 * 5个图表面板：
 * 1. 部门任务分布（堆叠横向条形图）
 * 2. 任务状态总览（环形图）
 * 3. 部门完成率排行（进度条形图）
 * 4. 逾期/阻塞事项时间线（散点图）
 * 5. 异常事项明细表（可滚动表格）
 */
const dayjs = require('dayjs');

class DashboardHtml {
  generate(taskData, chartUrls = {}) {
    const { departments, summary } = taskData;
    const today = dayjs();
    const dateStr = today.format('YYYY年M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const totalPending = summary.totalTasks - summary.completedTasks;

    // ━━━ 部门数据 ━━━
    const deptSorted = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0));

    // 堆叠条形图数据
    const deptBarData = [];
    for (const d of deptSorted) {
      const name = this._short(d.department);
      deptBarData.push({ dept: name, type: '待办', count: d.pendingCount || 0 });
      deptBarData.push({ dept: name, type: '已完成', count: d.completedCount || 0 });
    }

    // 状态环形图数据
    const statusData = [
      { status: '推进中', count: summary.inProgressTasks || 0 },
      { status: '催办中', count: summary.pendingResponseTasks || 0 },
      { status: '阻塞', count: summary.blockedTasks || 0 },
      { status: '暂缓', count: summary.onHoldTasks || 0 },
      { status: '待启动', count: summary.notStartedTasks || 0 },
      { status: '已完成', count: summary.completedTasks || 0 },
    ].filter(d => d.count > 0);

    // 部门完成率数据
    const completionData = deptSorted.map(d => {
      const total = (d.pendingCount || 0) + (d.completedCount || 0);
      const rate = total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
      return { dept: this._short(d.department), rate };
    }).sort((a, b) => b.rate - a.rate);

    // 逾期/阻塞散点数据
    const timelineData = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        if (task.statusKey === 'blocked') {
          timelineData.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 18), type: '阻塞', days: 0, owner: task.owner || dept.owner || '' });
        }
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          timelineData.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 18), type: '逾期', days, owner: task.owner || dept.owner || '' });
        }
      }
    }
    timelineData.sort((a, b) => b.days - a.days);

    // 异常事项表格数据
    const alertRows = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '';
        const deptName = this._short(dept.department);
        if (task.statusKey === 'blocked') {
          alertRows.push({ status: '🚫 阻塞', dept: deptName, title: (task.title || '').slice(0, 24), owner, deadline: task.deadline ? dayjs(task.deadline).format('M/D') : '—', level: 3 });
        }
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alertRows.push({ status: `⏰ 逾期${days}天`, dept: deptName, title: (task.title || '').slice(0, 24), owner, deadline: dayjs(task.deadline).format('M/D'), level: days > 5 ? 3 : 2 });
        }
        if (task.statusKey === 'pending_response') {
          alertRows.push({ status: '📞 催办中', dept: deptName, title: (task.title || '').slice(0, 24), owner, deadline: task.deadline ? dayjs(task.deadline).format('M/D') : '—', level: 1 });
        }
      }
    }
    alertRows.sort((a, b) => b.level - a.level);

    const alertTableHtml = alertRows.slice(0, 20).map(a =>
      `<tr><td class="td-status">${a.status}</td><td>${a.dept}</td><td class="td-title">${a.title}</td><td>${a.owner}</td><td>${a.deadline}</td></tr>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>AI 任务管理驾驶舱 · ${today.format('M/D')}</title>
<script src="https://unpkg.com/@antv/g2plot@2/dist/g2plot.min.js"><\/script>
<style>
:root{--bg:#0b0f1a;--card:#111827;--card2:#1a2332;--border:rgba(255,255,255,0.06);--text:#e5e7eb;--sub:#6b7280;--accent:#3b82f6;--green:#10b981;--red:#ef4444;--orange:#f59e0b;--purple:#8b5cf6}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","SF Pro Display","Helvetica Neue",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}

/* ━━ 顶栏 ━━ */
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:linear-gradient(135deg,rgba(59,130,246,0.08),rgba(139,92,246,0.06));border-bottom:1px solid var(--border)}
.topbar .logo{display:flex;align-items:center;gap:10px}
.topbar .logo .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.topbar .logo h1{font-size:16px;font-weight:600;letter-spacing:0.5px;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.topbar .time{font-size:12px;color:var(--sub)}

/* ━━ KPI 指标卡 ━━ */
.kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:14px 24px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;position:relative;overflow:hidden;text-align:center}
.kpi::after{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.kpi.c1::after{background:linear-gradient(90deg,#3b82f6,#60a5fa)}
.kpi.c2::after{background:linear-gradient(90deg,#10b981,#34d399)}
.kpi.c3::after{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.kpi.c4::after{background:linear-gradient(90deg,#ef4444,#f87171)}
.kpi.c5::after{background:linear-gradient(90deg,#8b5cf6,#a78bfa)}
.kpi .v{font-size:32px;font-weight:700;line-height:1.1}
.kpi.c1 .v{color:#60a5fa}.kpi.c2 .v{color:#34d399}.kpi.c3 .v{color:#fbbf24}.kpi.c4 .v{color:#f87171}.kpi.c5 .v{color:#a78bfa}
.kpi .l{font-size:11px;color:var(--sub);margin-top:4px;letter-spacing:0.5px}

/* ━━ 图表面板 ━━ */
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 24px 10px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;min-height:300px}
.panel.wide{grid-column:1/-1}
.panel-head{font-size:13px;font-weight:600;color:var(--sub);margin-bottom:10px;display:flex;align-items:center;gap:6px}
.panel-head::before{content:'';width:3px;height:12px;border-radius:2px;background:var(--accent)}
.chart-box{width:100%;height:260px}

/* ━━ 异常表格 ━━ */
.table-wrap{max-height:360px;overflow-y:auto;border-radius:8px;border:1px solid var(--border)}
.table-wrap::-webkit-scrollbar{width:4px}
.table-wrap::-webkit-scrollbar-thumb{background:#374151;border-radius:2px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead{position:sticky;top:0;z-index:1}
th{background:#1e293b;color:#9ca3af;font-weight:500;padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);font-size:12px}
td{padding:7px 10px;border-bottom:1px solid var(--border);color:var(--text)}
tr:hover td{background:rgba(59,130,246,0.06)}
.td-status{white-space:nowrap;font-weight:600;font-size:12px}
.td-title{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ━━ 底栏 ━━ */
.footer{text-align:center;padding:16px;color:#374151;font-size:11px}
.footer .badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:3px 12px;border-radius:16px;color:#fff;font-size:10px;font-weight:500;margin-bottom:4px}

@media(max-width:640px){.kpi-row{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.kpi .v{font-size:24px}}
</style>
</head>
<body>

<div class="topbar">
  <div class="logo"><span class="dot"></span><h1>AI 任务管理驾驶舱</h1></div>
  <div class="time">${dateStr} ${weekday}</div>
</div>

<div class="kpi-row">
  <div class="kpi c1"><div class="v">${summary.totalTasks}</div><div class="l">总事项</div></div>
  <div class="kpi c3"><div class="v">${totalPending}</div><div class="l">待办中</div></div>
  <div class="kpi c2"><div class="v">${summary.completedTasks}</div><div class="l">已完成</div></div>
  <div class="kpi c4"><div class="v">${summary.blockedTasks}</div><div class="l">阻塞</div></div>
  <div class="kpi c5"><div class="v">${summary.pendingResponseTasks || 0}</div><div class="l">催办中</div></div>
</div>

<div class="grid">
  <!-- 部门任务分布（堆叠条形图）-->
  <div class="panel wide">
    <div class="panel-head">部门任务分布</div>
    <div id="deptChart" class="chart-box"></div>
  </div>

  <!-- 任务状态总览（环形图）-->
  <div class="panel">
    <div class="panel-head">任务状态总览</div>
    <div id="statusChart" class="chart-box"></div>
  </div>

  <!-- 部门完成率（条形图）-->
  <div class="panel">
    <div class="panel-head">部门完成率排行</div>
    <div id="completionChart" class="chart-box"></div>
  </div>

  <!-- 逾期/阻塞散点图 -->
  ${timelineData.length > 0 ? `
  <div class="panel wide">
    <div class="panel-head">逾期 & 阻塞事项分布</div>
    <div id="timelineChart" class="chart-box"></div>
  </div>` : ''}

  <!-- 异常事项明细表 -->
  ${alertRows.length > 0 ? `
  <div class="panel wide">
    <div class="panel-head">异常事项明细 (${alertRows.length})</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>状态</th><th>部门</th><th>事项</th><th>负责人</th><th>截止日</th></tr></thead>
        <tbody>${alertTableHtml}</tbody>
      </table>
    </div>
  </div>` : ''}
</div>

<div class="footer">
  <div class="badge">AI Powered</div>
  <div>AI 智能任务跟踪系统自动生成 · ${today.format('YYYY-MM-DD HH:mm')}</div>
</div>

<script>
var G2 = G2Plot;
var tooltipStyle = {domStyles:{'g2-tooltip':{background:'#1f2937',border:'1px solid #374151',borderRadius:'8px',color:'#e5e7eb',boxShadow:'0 4px 20px rgba(0,0,0,0.4)',fontSize:'12px'}}};

// ━━━ 1. 部门任务堆叠条形图 ━━━
new G2.Bar('deptChart', Object.assign({
  data: ${JSON.stringify(deptBarData)},
  isStack: true,
  xField: 'count', yField: 'dept', seriesField: 'type',
  color: ['#f87171','#34d399'],
  barWidthRatio: 0.5,
  label: {position:'middle',style:{fill:'#fff',fontSize:11,fontWeight:600}},
  legend: {position:'top-right',itemName:{style:{fill:'#9ca3af',fontSize:12}}},
  xAxis: {grid:{line:{style:{stroke:'rgba(255,255,255,0.04)'}}},label:{style:{fill:'#6b7280'}}},
  yAxis: {label:{style:{fill:'#d1d5db',fontSize:13}}},
  theme: {background:'transparent'},
  barStyle: {radius:[0,4,4,0]},
}, tooltipStyle)).render();

// ━━━ 2. 状态环形图 ━━━
new G2.Pie('statusChart', Object.assign({
  data: ${JSON.stringify(statusData)},
  angleField: 'count', colorField: 'status',
  radius: 0.85, innerRadius: 0.6,
  color: ['#60a5fa','#fbbf24','#f87171','#a78bfa','#6b7280','#34d399'],
  label: {type:'inner',content:'{value}',style:{fill:'#fff',fontSize:12,fontWeight:600},offset:'-25%'},
  legend: {position:'right',itemName:{style:{fill:'#9ca3af',fontSize:12}},itemSpacing:8},
  statistic: {
    title:{content:'总计',style:{color:'#6b7280',fontSize:'12px'}},
    content:{content:'${summary.totalTasks}',style:{color:'#e5e7eb',fontSize:'26px',fontWeight:700}},
  },
  theme: {background:'transparent'},
  pieStyle: {stroke:'#111827',lineWidth:2},
}, tooltipStyle)).render();

// ━━━ 3. 部门完成率条形图 ━━━
new G2.Bar('completionChart', Object.assign({
  data: ${JSON.stringify(completionData)},
  xField: 'rate', yField: 'dept',
  color: function(d) { var v = d.rate||0; return v>=50?'#34d399':v>=20?'#fbbf24':'#f87171'; },
  barWidthRatio: 0.5,
  legend: false,
  label: {position:'right',content:function(d){return d.rate+'%'},style:{fill:'#9ca3af',fontSize:11}},
  xAxis: {max:100,grid:{line:{style:{stroke:'rgba(255,255,255,0.04)'}}},label:{style:{fill:'#6b7280'},formatter:function(v){return v+'%'}}},
  yAxis: {label:{style:{fill:'#d1d5db',fontSize:13}}},
  theme: {background:'transparent'},
  barStyle: {radius:[0,4,4,0]},
}, tooltipStyle)).render();

${timelineData.length > 0 ? `
// ━━━ 4. 逾期/阻塞散点图 ━━━
new G2.Scatter('timelineChart', Object.assign({
  data: ${JSON.stringify(timelineData)},
  xField: 'dept', yField: 'days',
  colorField: 'type',
  color: ['#f87171','#fbbf24'],
  sizeField: 'days',
  size: [6, 20],
  shape: 'circle',
  pointStyle: {fillOpacity:0.7,stroke:'transparent'},
  xAxis: {label:{style:{fill:'#d1d5db',fontSize:12}}},
  yAxis: {title:{text:'逾期天数',style:{fill:'#6b7280',fontSize:12}},label:{style:{fill:'#6b7280'}},grid:{line:{style:{stroke:'rgba(255,255,255,0.04)'}}}},
  legend: {position:'top-right',itemName:{style:{fill:'#9ca3af',fontSize:12}}},
  theme: {background:'transparent'},
  tooltip: Object.assign({fields:['title','type','days','owner'],formatter:function(d){return{name:d.title,value:(d.type==='逾期'?d.days+'天':'阻塞')+' · '+d.owner}}}, tooltipStyle),
}, tooltipStyle)).render();` : ''}
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
