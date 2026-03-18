/**
 * 高端可视化看板页面生成器（v4 - 暗色驾驶舱 · AntV G2Plot）
 *
 * 6个图表 + KPI卡片 + 异常明细表 + 渐变装饰
 * 视觉对标：飞书数据看板 / Grafana Dark / 大屏驾驶舱
 */
const dayjs = require('dayjs');

class DashboardHtml {
  generate(taskData) {
    const { departments, summary } = taskData;
    const today = dayjs();
    const dateStr = today.format('YYYY年M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const totalPending = summary.totalTasks - summary.completedTasks;

    const deptSorted = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0));

    // ━━━ 数据准备 ━━━
    const deptBarData = [];
    for (const d of deptSorted) {
      const name = this._short(d.department);
      deptBarData.push({ dept: name, type: '待办', count: d.pendingCount || 0 });
      deptBarData.push({ dept: name, type: '已完成', count: d.completedCount || 0 });
    }

    const statusData = [
      { status: '推进中', count: summary.inProgressTasks || 0 },
      { status: '催办中', count: summary.pendingResponseTasks || 0 },
      { status: '阻塞', count: summary.blockedTasks || 0 },
      { status: '暂缓', count: summary.onHoldTasks || 0 },
      { status: '待启动', count: summary.notStartedTasks || 0 },
      { status: '已完成', count: summary.completedTasks || 0 },
    ].filter(d => d.count > 0);

    const completionData = deptSorted.map(d => {
      const total = (d.pendingCount || 0) + (d.completedCount || 0);
      return { dept: this._short(d.department), rate: total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0 };
    }).sort((a, b) => b.rate - a.rate);

    // 异常信号数据
    const healthData = [];
    for (const d of departments) {
      const blocked = (d.tasks || []).filter(t => t.statusKey === 'blocked' && !t.isCompleted).length;
      const overdue = (d.tasks || []).filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isBefore(today, 'day')).length;
      const urgent = (d.tasks || []).filter(t => t.statusKey === 'pending_response' && !t.isCompleted).length;
      if (blocked + overdue + urgent > 0) {
        const name = this._short(d.department);
        healthData.push({ dept: name, type: '阻塞', count: blocked });
        healthData.push({ dept: name, type: '逾期', count: overdue });
        healthData.push({ dept: name, type: '催办中', count: urgent });
      }
    }

    // 逾期天数分布
    const overdueDistrib = [];
    for (const dept of departments) {
      for (const t of dept.tasks || []) {
        if (t.isCompleted || !t.deadline) continue;
        if (dayjs(t.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(t.deadline), 'day');
          const bucket = days <= 3 ? '1-3天' : days <= 7 ? '4-7天' : days <= 14 ? '8-14天' : '15天+';
          overdueDistrib.push({ range: bucket, dept: this._short(dept.department), count: 1 });
        }
      }
    }
    // 聚合
    const overdueAgg = {};
    for (const d of overdueDistrib) {
      const key = `${d.range}|${d.dept}`;
      overdueAgg[key] = overdueAgg[key] || { range: d.range, dept: d.dept, count: 0 };
      overdueAgg[key].count += d.count;
    }
    const overdueData = Object.values(overdueAgg);

    // 异常表格
    const alertRows = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '';
        const deptName = this._short(dept.department);
        if (task.statusKey === 'blocked')
          alertRows.push({ status: '阻塞', color: '#ef4444', dept: deptName, title: (task.title || '').slice(0, 28), owner, deadline: task.deadline ? dayjs(task.deadline).format('M/D') : '—', level: 3 });
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alertRows.push({ status: `逾期${days}天`, color: days > 5 ? '#ef4444' : '#f97316', dept: deptName, title: (task.title || '').slice(0, 28), owner, deadline: dayjs(task.deadline).format('M/D'), level: days > 5 ? 3 : 2 });
        }
        if (task.statusKey === 'pending_response')
          alertRows.push({ status: '催办中', color: '#f59e0b', dept: deptName, title: (task.title || '').slice(0, 28), owner, deadline: task.deadline ? dayjs(task.deadline).format('M/D') : '—', level: 1 });
      }
    }
    alertRows.sort((a, b) => b.level - a.level);
    const tableRows = alertRows.slice(0, 25).map(a =>
      `<tr><td><span class="badge" style="background:${a.color}">${a.status}</span></td><td>${a.dept}</td><td class="cell-title">${a.title}</td><td>${a.owner}</td><td>${a.deadline}</td></tr>`
    ).join('');

    // 完成率
    const overallRate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 任务驾驶舱 · ${today.format('M/D')}</title>
<script src="https://unpkg.com/@antv/g2plot@2/dist/g2plot.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#060a14;--card:#0d1424;--card-hover:#111b30;--border:rgba(100,130,200,0.08);--glow:rgba(59,130,246,0.15);--text:#e2e8f0;--sub:#64748b;--dim:#475569}
body{font-family:"SF Pro Display","PingFang SC",-apple-system,"Helvetica Neue",sans-serif;background:var(--bg);color:var(--text);min-height:100vh}

/* ━━ 顶部渐变横幅 ━━ */
.banner{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#172554 100%);border-bottom:1px solid rgba(99,102,241,0.2);padding:20px 28px;position:relative;overflow:hidden}
.banner::before{content:'';position:absolute;top:-50%;right:-10%;width:300px;height:300px;background:radial-gradient(circle,rgba(99,102,241,0.12) 0%,transparent 70%);pointer-events:none}
.banner-inner{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.brand{display:flex;align-items:center;gap:12px}
.brand .pulse{width:10px;height:10px;border-radius:50%;background:#10b981;box-shadow:0 0 12px #10b981;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 12px #10b981}50%{box-shadow:0 0 4px #10b981}}
.brand h1{font-size:18px;font-weight:700;background:linear-gradient(90deg,#818cf8,#60a5fa,#34d399);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.brand-sub{font-size:12px;color:var(--sub);margin-top:2px}
.banner-right{text-align:right}
.banner-right .date{font-size:13px;color:#a5b4fc}
.banner-right .rate{font-size:11px;color:var(--sub);margin-top:4px}

/* ━━ KPI 卡片 ━━ */
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px 28px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center;position:relative;overflow:hidden;transition:transform 0.2s,box-shadow 0.2s}
.kpi:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3)}
.kpi .glow{position:absolute;top:-1px;left:20%;right:20%;height:2px;border-radius:0 0 4px 4px}
.kpi .num{font-size:36px;font-weight:800;line-height:1.1;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.kpi .lbl{font-size:11px;color:var(--sub);margin-top:6px;text-transform:uppercase;letter-spacing:1.5px;font-weight:500}
.c-blue .glow{background:linear-gradient(90deg,transparent,#3b82f6,transparent)}.c-blue .num{color:#60a5fa}
.c-green .glow{background:linear-gradient(90deg,transparent,#10b981,transparent)}.c-green .num{color:#34d399}
.c-amber .glow{background:linear-gradient(90deg,transparent,#f59e0b,transparent)}.c-amber .num{color:#fbbf24}
.c-red .glow{background:linear-gradient(90deg,transparent,#ef4444,transparent)}.c-red .num{color:#f87171}
.c-purple .glow{background:linear-gradient(90deg,transparent,#8b5cf6,transparent)}.c-purple .num{color:#a78bfa}

/* ━━ 图表网格 ━━ */
.charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 28px 12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;transition:box-shadow 0.2s}
.card:hover{box-shadow:0 0 20px var(--glow)}
.card.full{grid-column:1/-1}
.card-head{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:13px;font-weight:600;color:var(--sub);letter-spacing:0.3px}
.card-head .dot{width:4px;height:16px;border-radius:2px;background:linear-gradient(180deg,#6366f1,#3b82f6)}
.chart-el{width:100%;height:280px}

/* ━━ 表格 ━━ */
.tbl-wrap{max-height:400px;overflow-y:auto;border-radius:10px;border:1px solid var(--border);scrollbar-width:thin;scrollbar-color:#334155 transparent}
.tbl-wrap::-webkit-scrollbar{width:5px}
.tbl-wrap::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead{position:sticky;top:0;z-index:2}
th{background:#111827;color:var(--sub);font-weight:500;padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
td{padding:9px 12px;border-bottom:1px solid var(--border)}
tr:nth-child(even) td{background:rgba(255,255,255,0.01)}
tr:hover td{background:rgba(99,102,241,0.06)}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-size:11px;font-weight:600;white-space:nowrap}
.cell-title{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ━━ 底部 ━━ */
.foot{text-align:center;padding:20px 28px;color:#334155;font-size:11px}
.foot .ai{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:4px 16px;border-radius:20px;color:rgba(255,255,255,0.9);font-size:10px;font-weight:500;margin-bottom:6px;letter-spacing:0.5px}

@media(max-width:680px){.kpis{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}.kpi .num{font-size:26px}}
</style>
</head>
<body>

<div class="banner">
  <div class="banner-inner">
    <div class="brand">
      <span class="pulse"></span>
      <div><h1>AI 任务管理驾驶舱</h1><div class="brand-sub">Department Task Cockpit</div></div>
    </div>
    <div class="banner-right">
      <div class="date">${dateStr} ${weekday}</div>
      <div class="rate">Overall Completion ${overallRate}%</div>
    </div>
  </div>
</div>

<div class="kpis">
  <div class="kpi c-blue"><div class="glow"></div><div class="num">${summary.totalTasks}</div><div class="lbl">Total</div></div>
  <div class="kpi c-amber"><div class="glow"></div><div class="num">${totalPending}</div><div class="lbl">Pending</div></div>
  <div class="kpi c-green"><div class="glow"></div><div class="num">${summary.completedTasks}</div><div class="lbl">Done</div></div>
  <div class="kpi c-red"><div class="glow"></div><div class="num">${summary.blockedTasks}</div><div class="lbl">Blocked</div></div>
  <div class="kpi c-purple"><div class="glow"></div><div class="num">${summary.pendingResponseTasks || 0}</div><div class="lbl">Follow-up</div></div>
</div>

<div class="charts">
  <div class="card full"><div class="card-head"><span class="dot"></span>部门任务分布</div><div id="c1" class="chart-el"></div></div>
  <div class="card"><div class="card-head"><span class="dot"></span>任务状态总览</div><div id="c2" class="chart-el"></div></div>
  <div class="card"><div class="card-head"><span class="dot"></span>部门完成率</div><div id="c3" class="chart-el"></div></div>
  ${healthData.length > 0 ? '<div class="card"><div class="card-head"><span class="dot"></span>异常信号</div><div id="c4" class="chart-el"></div></div>' : ''}
  ${overdueData.length > 0 ? '<div class="card"><div class="card-head"><span class="dot"></span>逾期天数分布</div><div id="c5" class="chart-el"></div></div>' : ''}
  ${alertRows.length > 0 ? `<div class="card full"><div class="card-head"><span class="dot"></span>异常事项明细 (${alertRows.length})</div><div class="tbl-wrap"><table><thead><tr><th>状态</th><th>部门</th><th>事项</th><th>负责人</th><th>截止</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>` : ''}
</div>

<div class="foot"><div class="ai">AI Powered · ClawdBot</div><div>${today.format('YYYY-MM-DD HH:mm')} 自动生成</div></div>

<script>
var P=G2Plot,T={domStyles:{'g2-tooltip':{background:'#1e293b',border:'1px solid rgba(100,130,200,0.15)',borderRadius:'10px',color:'#e2e8f0',boxShadow:'0 8px 32px rgba(0,0,0,0.5)',fontSize:'12px',padding:'10px 14px'}}};

new P.Bar('c1',Object.assign({data:${JSON.stringify(deptBarData)},isStack:true,xField:'count',yField:'dept',seriesField:'type',color:['#f87171','#34d399'],barWidthRatio:.5,label:{position:'middle',style:{fill:'#fff',fontSize:11,fontWeight:600}},legend:{position:'top-right',itemName:{style:{fill:'#94a3b8',fontSize:12}}},xAxis:{grid:{line:{style:{stroke:'rgba(148,163,184,0.06)'}}},label:{style:{fill:'#64748b'}}},yAxis:{label:{style:{fill:'#cbd5e1',fontSize:13,fontWeight:500}}},theme:{background:'transparent'},barStyle:{radius:[0,5,5,0]},interactions:[{type:'active-region'}]},T)).render();

new P.Pie('c2',Object.assign({data:${JSON.stringify(statusData)},angleField:'count',colorField:'status',radius:.88,innerRadius:.62,color:['#60a5fa','#fbbf24','#f87171','#a78bfa','#64748b','#34d399'],label:{type:'spider',content:'{name} {value}',style:{fill:'#94a3b8',fontSize:11}},legend:{position:'bottom',itemName:{style:{fill:'#94a3b8',fontSize:12}},maxRow:2},statistic:{title:{content:'总计',style:{color:'#64748b',fontSize:'12px',fontWeight:400}},content:{content:'${summary.totalTasks}',style:{color:'#e2e8f0',fontSize:'28px',fontWeight:800}}},theme:{background:'transparent'},pieStyle:{stroke:'#0d1424',lineWidth:3},interactions:[{type:'element-active'}]},T)).render();

new P.Bar('c3',Object.assign({data:${JSON.stringify(completionData)},xField:'rate',yField:'dept',seriesField:'dept',color:function(d){var v=d.rate||0;return v>=50?'#34d399':v>=20?'#fbbf24':'#f87171'},barWidthRatio:.5,legend:false,label:{position:'right',content:function(d){return d.rate+'%'},style:{fill:'#94a3b8',fontSize:11}},xAxis:{max:100,grid:{line:{style:{stroke:'rgba(148,163,184,0.06)'}}},label:{style:{fill:'#64748b'},formatter:function(v){return v+'%'}}},yAxis:{label:{style:{fill:'#cbd5e1',fontSize:13,fontWeight:500}}},theme:{background:'transparent'},barStyle:{radius:[0,5,5,0]},interactions:[{type:'active-region'}]},T)).render();

${healthData.length > 0 ? `new P.Bar('c4',Object.assign({data:${JSON.stringify(healthData)},isStack:true,xField:'count',yField:'dept',seriesField:'type',color:['#f87171','#fb923c','#fbbf24'],barWidthRatio:.5,label:{position:'middle',style:{fill:'#fff',fontSize:11,fontWeight:600}},legend:{position:'top-right',itemName:{style:{fill:'#94a3b8',fontSize:12}}},xAxis:{grid:{line:{style:{stroke:'rgba(148,163,184,0.06)'}}},label:{style:{fill:'#64748b'}},tickInterval:1},yAxis:{label:{style:{fill:'#cbd5e1',fontSize:13,fontWeight:500}}},theme:{background:'transparent'},barStyle:{radius:[0,4,4,0]},interactions:[{type:'active-region'}]},T)).render();` : ''}

${overdueData.length > 0 ? `new P.Column('c5',Object.assign({data:${JSON.stringify(overdueData)},isGroup:true,xField:'range',yField:'count',seriesField:'dept',color:['#6366f1','#06b6d4','#f43f5e','#f59e0b','#10b981','#8b5cf6','#64748b','#ec4899'],columnWidthRatio:.6,label:{position:'top',style:{fill:'#94a3b8',fontSize:10}},legend:{position:'top-right',itemName:{style:{fill:'#94a3b8',fontSize:11}}},xAxis:{label:{style:{fill:'#cbd5e1',fontSize:12}}},yAxis:{grid:{line:{style:{stroke:'rgba(148,163,184,0.06)'}}},label:{style:{fill:'#64748b'}},tickInterval:1},theme:{background:'transparent'},columnStyle:{radius:[4,4,0,0]},interactions:[{type:'active-region'}]},T)).render();` : ''}
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
