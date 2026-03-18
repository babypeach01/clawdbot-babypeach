/**
 * 高端 HTML 看板页面生成器
 * 生成包含 ECharts 交互式图表的精美 HTML 页面
 * 上传到 OSS 后通过钉钉 ActionCard 链接打开
 */
const dayjs = require('dayjs');

class DashboardHtml {
  /**
   * 生成完整的看板 HTML 页面
   * @param {object} taskData - 任务数据
   * @param {object} chartUrls - OSS 图片链接（可选，用于静态图备选）
   * @returns {string} 完整 HTML
   */
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

    const deptLabels = JSON.stringify(deptSorted.map(d => this._short(d.department)));
    const deptPending = JSON.stringify(deptSorted.map(d => d.pendingCount || 0));
    const deptCompleted = JSON.stringify(deptSorted.map(d => d.completedCount || 0));

    // 状态数据
    const statusData = JSON.stringify([
      { name: '推进中', value: summary.inProgressTasks || 0 },
      { name: '催办中', value: summary.pendingResponseTasks || 0 },
      { name: '阻塞', value: summary.blockedTasks || 0 },
      { name: '暂缓', value: summary.onHoldTasks || 0 },
      { name: '待启动', value: summary.notStartedTasks || 0 },
      { name: '已完成', value: summary.completedTasks || 0 },
    ].filter(d => d.value > 0));

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
    const personSorted = Object.entries(personMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const personLabels = JSON.stringify(personSorted.map(([n]) => n));
    const personData = JSON.stringify(personSorted.map(([, c]) => c));

    // 异常事项
    const alerts = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        if (task.statusKey === 'blocked') {
          alerts.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 30), owner: task.owner || dept.owner, type: '阻塞', color: '#ff4d4f' });
        }
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alerts.push({ dept: this._short(dept.department), title: (task.title || '').slice(0, 30), owner: task.owner || dept.owner, type: `逾期${days}天`, color: '#fa8c16' });
        }
      }
    }
    const alertsHtml = alerts.slice(0, 8).map(a =>
      `<div class="alert-item"><span class="alert-badge" style="background:${a.color}">${a.type}</span><span class="alert-dept">${a.dept}</span><span class="alert-title">${a.title}</span><span class="alert-owner">→ ${a.owner}</span></div>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>工作任务管理看板 · ${today.format('M/D')}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;background:linear-gradient(135deg,#0c1426 0%,#1a2740 50%,#0d1b2a 100%);color:#e8edf3;min-height:100vh}
.header{background:linear-gradient(90deg,rgba(22,119,255,0.15),rgba(114,46,209,0.1));border-bottom:1px solid rgba(255,255,255,0.06);padding:20px 24px;text-align:center}
.header h1{font-size:22px;font-weight:600;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header .sub{color:#8899aa;font-size:13px;margin-top:6px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 16px 0}
.metric{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;text-align:center;backdrop-filter:blur(10px)}
.metric .num{font-size:32px;font-weight:700;line-height:1.2}
.metric .label{font-size:12px;color:#8899aa;margin-top:4px}
.metric.danger .num{color:#ff6b6b}
.metric.warning .num{color:#ffd43b}
.metric.success .num{color:#51cf66}
.metric.info .num{color:#60a5fa}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}
.chart-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;backdrop-filter:blur(10px)}
.chart-card.full{grid-column:1/-1}
.chart-box{width:100%;height:300px}
.alerts-section{padding:0 16px 16px}
.alerts-card{background:rgba(255,77,79,0.06);border:1px solid rgba(255,77,79,0.15);border-radius:12px;padding:16px}
.alerts-card h3{font-size:15px;color:#ff6b6b;margin-bottom:12px}
.alert-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
.alert-item:last-child{border:none}
.alert-badge{padding:2px 8px;border-radius:4px;color:#fff;font-size:11px;font-weight:600;white-space:nowrap}
.alert-dept{color:#8899aa;min-width:56px}
.alert-title{flex:1;color:#ccd6e0}
.alert-owner{color:#60a5fa;white-space:nowrap}
.footer{text-align:center;padding:20px;color:#556677;font-size:12px}
.footer .ai-tag{display:inline-block;background:linear-gradient(90deg,#1677ff,#722ed1);padding:4px 12px;border-radius:20px;color:#fff;font-size:11px;margin-bottom:8px}
@media(max-width:600px){.metrics{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}.metric .num{font-size:24px}}
</style>
</head>
<body>

<div class="header">
  <h1>📊 部门工作任务管理看板</h1>
  <div class="sub">${dateStr} ${weekday} · AI 智能任务跟踪系统</div>
</div>

<div class="metrics">
  <div class="metric info"><div class="num">${totalPending}</div><div class="label">待办事项</div></div>
  <div class="metric success"><div class="num">${summary.completedTasks}</div><div class="label">已完成</div></div>
  <div class="metric danger"><div class="num">${summary.blockedTasks}</div><div class="label">阻塞</div></div>
  <div class="metric warning"><div class="num">${summary.pendingResponseTasks || 0}</div><div class="label">催办中</div></div>
</div>

<div class="charts">
  <div class="chart-card full"><div id="deptChart" class="chart-box"></div></div>
  <div class="chart-card"><div id="statusChart" class="chart-box"></div></div>
  <div class="chart-card"><div id="personChart" class="chart-box"></div></div>
</div>

${alerts.length > 0 ? `
<div class="alerts-section">
  <div class="alerts-card">
    <h3>⚠️ 异常事项 (${alerts.length})</h3>
    ${alertsHtml}
  </div>
</div>` : ''}

<div class="footer">
  <div class="ai-tag">🤖 AI 智能生成</div>
  <div>由 AI 任务跟踪系统自动分析生成 · ${today.format('YYYY-MM-DD HH:mm')}</div>
</div>

<script>
const dark = {bg:'transparent',text:'#ccd6e0',axis:'#334155',grid:'rgba(255,255,255,0.04)'};

// 部门任务分布
echarts.init(document.getElementById('deptChart')).setOption({
  title:{text:'部门任务分布',textStyle:{color:dark.text,fontSize:16},left:'center'},
  tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
  legend:{data:['待办','已完成'],textStyle:{color:dark.text},top:30},
  grid:{left:80,right:20,top:60,bottom:20},
  xAxis:{type:'value',splitLine:{lineStyle:{color:dark.grid}},axisLabel:{color:dark.text}},
  yAxis:{type:'category',data:${deptLabels},inverse:true,axisLabel:{color:dark.text,fontSize:13}},
  series:[
    {name:'待办',type:'bar',stack:'t',data:${deptPending},itemStyle:{color:'#ff6b6b',borderRadius:[0,4,4,0]},barWidth:18},
    {name:'已完成',type:'bar',stack:'t',data:${deptCompleted},itemStyle:{color:'#51cf66',borderRadius:[0,4,4,0]},barWidth:18}
  ]
});

// 任务状态
echarts.init(document.getElementById('statusChart')).setOption({
  title:{text:'任务状态',textStyle:{color:dark.text,fontSize:15},left:'center'},
  tooltip:{trigger:'item',formatter:'{b}: {c} ({d}%)'},
  legend:{orient:'vertical',right:10,top:'middle',textStyle:{color:dark.text,fontSize:12}},
  series:[{
    type:'pie',radius:['45%','72%'],center:['40%','55%'],
    label:{show:false},
    data:${statusData},
    itemStyle:{borderColor:'#1a2740',borderWidth:3},
    color:['#60a5fa','#ffd43b','#ff6b6b','#a78bfa','#868e96','#51cf66']
  }]
});

// 个人负荷
echarts.init(document.getElementById('personChart')).setOption({
  title:{text:'个人负荷 Top',textStyle:{color:dark.text,fontSize:15},left:'center'},
  tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
  grid:{left:70,right:20,top:40,bottom:10},
  xAxis:{type:'value',splitLine:{lineStyle:{color:dark.grid}},axisLabel:{color:dark.text}},
  yAxis:{type:'category',data:${personLabels},inverse:true,axisLabel:{color:dark.text,fontSize:12}},
  series:[{
    type:'bar',data:${personData},barWidth:16,
    itemStyle:{color:function(p){var v=p.data;return v>30?'#ff6b6b':v>20?'#ffa94d':v>10?'#ffd43b':'#60a5fa'},borderRadius:[0,4,4,0]},
    label:{show:true,position:'right',color:dark.text,fontSize:12}
  }]
});
</script>
</body>
</html>`;
  }

  _short(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 6);
  }
}

module.exports = new DashboardHtml();
