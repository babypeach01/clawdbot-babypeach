/**
 * 可视化看板页面生成器（v5 - 浅色简约 · AntV G2Plot）
 *
 * 白底 + 低饱和色 + 精致排版 + 轻量圆角
 * 风格：苹果/无印良品式极简，拒绝花哨
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
          alertRows.push({ status: '阻塞', color: '#E8676B', dept: deptName, title: (task.title || '').slice(0, 28), owner, deadline: task.deadline ? dayjs(task.deadline).format('M/D') : '—', level: 3 });
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alertRows.push({ status: `逾期${days}天`, color: days > 5 ? '#E8676B' : '#F0A551', dept: deptName, title: (task.title || '').slice(0, 28), owner, deadline: dayjs(task.deadline).format('M/D'), level: days > 5 ? 3 : 2 });
        }
        if (task.statusKey === 'pending_response')
          alertRows.push({ status: '催办中', color: '#F0A551', dept: deptName, title: (task.title || '').slice(0, 28), owner, deadline: task.deadline ? dayjs(task.deadline).format('M/D') : '—', level: 1 });
      }
    }
    alertRows.sort((a, b) => b.level - a.level);
    const tableRows = alertRows.slice(0, 25).map(a =>
      `<tr><td><span class="badge" style="background:${a.color}">${a.status}</span></td><td>${a.dept}</td><td class="cell-title">${a.title}</td><td>${a.owner}</td><td>${a.deadline}</td></tr>`
    ).join('');

    const overallRate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>任务进展总览 · ${today.format('M/D')}</title>
<script src="https://unpkg.com/@antv/g2plot@2/dist/g2plot.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f7f8fa;
  --card:#ffffff;
  --border:rgba(0,0,0,0.06);
  --shadow:0 1px 3px rgba(0,0,0,0.04);
  --text:#1a1a2e;
  --sub:#8e8e93;
  --dim:#b0b0b8;
  --accent:#5B8DEF;
}
body{font-family:"SF Pro Display","PingFang SC",-apple-system,"Helvetica Neue",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* ━━ 顶栏 ━━ */
.header{background:var(--card);border-bottom:1px solid var(--border);padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:17px;font-weight:600;color:var(--text);letter-spacing:-0.2px}
.header .meta{font-size:12px;color:var(--sub);margin-top:3px}
.header-right{text-align:right}
.header-right .rate-num{font-size:28px;font-weight:700;color:var(--accent);line-height:1}
.header-right .rate-label{font-size:11px;color:var(--sub);margin-top:2px}

/* ━━ KPI 卡片 ━━ */
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px 32px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 14px;text-align:center;box-shadow:var(--shadow)}
.kpi .num{font-size:28px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi .lbl{font-size:11px;color:var(--sub);margin-top:5px;font-weight:500}
.kpi.c-blue .num{color:#5B8DEF}
.kpi.c-amber .num{color:#F0A551}
.kpi.c-green .num{color:#5BBD72}
.kpi.c-red .num{color:#E8676B}
.kpi.c-purple .num{color:#9B8FD9}

/* ━━ 图表区域 ━━ */
.charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 32px 12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;box-shadow:var(--shadow)}
.card.full{grid-column:1/-1}
.card-head{font-size:13px;font-weight:600;color:var(--text);margin-bottom:14px;display:flex;align-items:center;gap:8px}
.card-head::before{content:'';width:3px;height:14px;border-radius:2px;background:var(--accent)}
.chart-el{width:100%;height:280px}

/* ━━ 表格 ━━ */
.tbl-wrap{max-height:380px;overflow-y:auto;border-radius:8px;border:1px solid var(--border);scrollbar-width:thin;scrollbar-color:#ddd transparent}
.tbl-wrap::-webkit-scrollbar{width:4px}
.tbl-wrap::-webkit-scrollbar-thumb{background:#ddd;border-radius:2px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead{position:sticky;top:0;z-index:2}
th{background:#f7f8fa;color:var(--sub);font-weight:500;padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;letter-spacing:0.3px}
td{padding:10px 12px;border-bottom:1px solid var(--border)}
tr:hover td{background:#f7f8fa}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-size:11px;font-weight:500;white-space:nowrap}
.cell-title{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3a3a4a}

/* ━━ 底部 ━━ */
.foot{text-align:center;padding:20px 32px;color:var(--dim);font-size:11px}
.foot .tag{display:inline-block;background:#f0f1f5;color:var(--sub);padding:3px 12px;border-radius:12px;font-size:10px;font-weight:500;margin-bottom:6px}

@media(max-width:680px){.kpis{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}.kpi .num{font-size:22px}}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>任务进展总览</h1>
    <div class="meta">${dateStr} ${weekday}</div>
  </div>
  <div class="header-right">
    <div class="rate-num">${overallRate}%</div>
    <div class="rate-label">整体完成率</div>
  </div>
</div>

<div class="kpis">
  <div class="kpi c-blue"><div class="num">${summary.totalTasks}</div><div class="lbl">全部事项</div></div>
  <div class="kpi c-amber"><div class="num">${totalPending}</div><div class="lbl">进行中</div></div>
  <div class="kpi c-green"><div class="num">${summary.completedTasks}</div><div class="lbl">已完成</div></div>
  <div class="kpi c-red"><div class="num">${summary.blockedTasks}</div><div class="lbl">阻塞</div></div>
  <div class="kpi c-purple"><div class="num">${summary.pendingResponseTasks || 0}</div><div class="lbl">待跟进</div></div>
</div>

<div class="charts">
  <div class="card full"><div class="card-head">部门任务分布</div><div id="c1" class="chart-el"></div></div>
  <div class="card"><div class="card-head">任务状态总览</div><div id="c2" class="chart-el"></div></div>
  <div class="card"><div class="card-head">部门完成率</div><div id="c3" class="chart-el"></div></div>
  ${healthData.length > 0 ? '<div class="card"><div class="card-head">异常信号</div><div id="c4" class="chart-el"></div></div>' : ''}
  ${overdueData.length > 0 ? '<div class="card"><div class="card-head">逾期天数分布</div><div id="c5" class="chart-el"></div></div>' : ''}
  ${alertRows.length > 0 ? `<div class="card full"><div class="card-head">异常事项 (${alertRows.length})</div><div class="tbl-wrap"><table><thead><tr><th>状态</th><th>部门</th><th>事项</th><th>负责人</th><th>截止</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>` : ''}
</div>

<div class="foot"><div class="tag">ClawdBot · AI 生成</div><div>${today.format('YYYY-MM-DD HH:mm')} 自动生成</div></div>

<script>
var P=G2Plot;
var chartColors = {
  pending: '#F09A7E',
  done: '#7ED6A8',
  status: ['#5B8DEF','#F0A551','#E8676B','#9B8FD9','#C8C8CE','#5BBD72'],
  health: ['#E8676B','#F0A551','#E8C94A'],
  dept: ['#5B8DEF','#5AC8C8','#9B8FD9','#E88CB4','#F0A551','#5BBD72','#A0A4B0','#F09A7E']
};
var T={theme:'light'};

new P.Bar('c1',Object.assign({data:${JSON.stringify(deptBarData)},isStack:true,xField:'count',yField:'dept',seriesField:'type',color:[chartColors.pending, chartColors.done],barWidthRatio:.45,label:{position:'middle',style:{fill:'#fff',fontSize:11,fontWeight:500}},legend:{position:'top-right',itemName:{style:{fill:'#8e8e93',fontSize:12}}},xAxis:{grid:{line:{style:{stroke:'rgba(0,0,0,0.04)'}}},label:{style:{fill:'#8e8e93'}}},yAxis:{label:{style:{fill:'#3a3a4a',fontSize:13,fontWeight:500}}},barStyle:{radius:[0,4,4,0]},interactions:[{type:'active-region'}]},T)).render();

new P.Pie('c2',Object.assign({data:${JSON.stringify(statusData)},angleField:'count',colorField:'status',radius:.88,innerRadius:.62,color:chartColors.status,label:{type:'spider',content:'{name} {value}',style:{fill:'#8e8e93',fontSize:11}},legend:{position:'bottom',itemName:{style:{fill:'#8e8e93',fontSize:12}},maxRow:2},statistic:{title:{content:'总计',style:{color:'#8e8e93',fontSize:'12px',fontWeight:400}},content:{content:'${summary.totalTasks}',style:{color:'#1a1a2e',fontSize:'28px',fontWeight:700}}},pieStyle:{stroke:'#fff',lineWidth:3},interactions:[{type:'element-active'}]},T)).render();

new P.Bar('c3',Object.assign({data:${JSON.stringify(completionData)},xField:'rate',yField:'dept',seriesField:'dept',color:function(d){var v=d.rate||0;return v>=50?'#5BBD72':v>=20?'#F0A551':'#E8676B'},barWidthRatio:.45,legend:false,label:{position:'right',content:function(d){return d.rate+'%'},style:{fill:'#8e8e93',fontSize:11}},xAxis:{max:100,grid:{line:{style:{stroke:'rgba(0,0,0,0.04)'}}},label:{style:{fill:'#8e8e93'},formatter:function(v){return v+'%'}}},yAxis:{label:{style:{fill:'#3a3a4a',fontSize:13,fontWeight:500}}},barStyle:{radius:[0,4,4,0]},interactions:[{type:'active-region'}]},T)).render();

${healthData.length > 0 ? `new P.Bar('c4',Object.assign({data:${JSON.stringify(healthData)},isStack:true,xField:'count',yField:'dept',seriesField:'type',color:chartColors.health,barWidthRatio:.45,label:{position:'middle',style:{fill:'#fff',fontSize:11,fontWeight:500}},legend:{position:'top-right',itemName:{style:{fill:'#8e8e93',fontSize:12}}},xAxis:{grid:{line:{style:{stroke:'rgba(0,0,0,0.04)'}}},label:{style:{fill:'#8e8e93'}},tickInterval:1},yAxis:{label:{style:{fill:'#3a3a4a',fontSize:13,fontWeight:500}}},barStyle:{radius:[0,4,4,0]},interactions:[{type:'active-region'}]},T)).render();` : ''}

${overdueData.length > 0 ? `new P.Column('c5',Object.assign({data:${JSON.stringify(overdueData)},isGroup:true,xField:'range',yField:'count',seriesField:'dept',color:chartColors.dept,columnWidthRatio:.55,label:{position:'top',style:{fill:'#8e8e93',fontSize:10}},legend:{position:'top-right',itemName:{style:{fill:'#8e8e93',fontSize:11}}},xAxis:{label:{style:{fill:'#3a3a4a',fontSize:12}}},yAxis:{grid:{line:{style:{stroke:'rgba(0,0,0,0.04)'}}},label:{style:{fill:'#8e8e93'}},tickInterval:1},columnStyle:{radius:[4,4,0,0]},interactions:[{type:'active-region'}]},T)).render();` : ''}
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
