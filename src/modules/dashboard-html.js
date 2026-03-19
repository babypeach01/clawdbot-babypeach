/**
 * 交互式看板生成器（v7 - 总览卡片式 + 下钻 + 人工调整）
 *
 * 设计理念：
 *   顶部：大字KPI（总完成率环形 + 4个指标）
 *   中部：部门卡片（每部门一张，进度条+数字，点击展开）
 *   展开：任务列表（✓完成 —排除，实时重算）
 *   无G2Plot依赖，纯CSS实现，加载快、移动端友好
 */
const dayjs = require('dayjs');

class DashboardHtml {
  generate(taskData, serverBaseUrl = '') {
    const { departments, summary } = taskData;
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];

    const deptData = departments
      .filter(d => ((d.pendingCount || 0) + (d.completedCount || 0) > 0) || (d.tasks || []).length > 0)
      .map((d, di) => {
        const tasks = (d.tasks || []).map((t, ti) => ({
          id: `d${di}_t${ti}`,
          title: t.title || '',
          owner: t.owner || d.owner || '',
          status: t.status || '',
          statusKey: t.statusKey || 'in_progress',
          deadline: t.deadline || null,
          isCompleted: !!t.isCompleted,
          isBlocked: !!t.isBlocked,
          overrideStatus: t.isCompleted ? 'completed' : 'pending',
          excluded: false,
        }));
        return {
          name: this._short(d.department),
          fullName: d.department,
          owner: d.owner || '',
          tasks,
        };
      });

    const deptDataJson = JSON.stringify(deptData);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>工作总览 · ${dateStr}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#F0F2F5;--card:#FFF;--border:#E5E7EB;--text:#111827;--sub:#6B7280;--dim:#9CA3AF;--accent:#3B82F6;--green:#10B981;--red:#EF4444;--amber:#F59E0B;--ring-size:140px}
html{font-size:15px}
body{font-family:-apple-system,"PingFang SC","SF Pro Text","Helvetica Neue",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased;padding-bottom:60px}

/* ━━ 顶部标题栏 ━━ */
.topbar{background:#FFF;padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar h1{font-size:17px;font-weight:700;letter-spacing:-0.3px}
.topbar .date{font-size:13px;color:var(--sub)}
.save-msg{font-size:12px;color:var(--green);opacity:0;transition:opacity .3s}
.save-msg.show{opacity:1}

/* ━━ 总览区域 ━━ */
.overview{display:flex;align-items:center;gap:20px;padding:24px 20px 16px;flex-wrap:wrap;justify-content:center}
.ring-wrap{position:relative;width:var(--ring-size);height:var(--ring-size);flex-shrink:0}
.ring-wrap svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:#E5E7EB;stroke-width:10}
.ring-fg{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset .8s ease,stroke .3s}
.ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-num{font-size:36px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.ring-lbl{font-size:11px;color:var(--sub);margin-top:2px;font-weight:500}

.kpi-group{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;min-width:90px;text-align:center}
.kpi .v{font-size:24px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi .l{font-size:11px;color:var(--sub);margin-top:3px;font-weight:500}
.kpi.c1 .v{color:var(--accent)}
.kpi.c2 .v{color:var(--amber)}
.kpi.c3 .v{color:var(--green)}
.kpi.c4 .v{color:var(--red)}

/* ━━ 分割线标题 ━━ */
.section-title{padding:20px 20px 10px;font-size:13px;font-weight:600;color:var(--sub);letter-spacing:0.5px;display:flex;align-items:center;justify-content:space-between}
.section-title .hint{font-weight:400;font-size:11px;color:var(--dim)}

/* ━━ 部门卡片 ━━ */
.dept-cards{padding:0 12px}
.dept-card{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden;transition:box-shadow .2s}
.dept-card.open{box-shadow:0 4px 20px rgba(0,0,0,0.08)}

.dept-head{padding:16px 18px;cursor:pointer;display:flex;align-items:center;gap:14px;user-select:none;-webkit-tap-highlight-color:transparent;transition:background .12s}
.dept-head:active{background:#F9FAFB}

.dept-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#FFF;flex-shrink:0}

.dept-body{flex:1;min-width:0}
.dept-name{font-size:15px;font-weight:600;line-height:1.2}
.dept-sub{font-size:12px;color:var(--sub);margin-top:2px}
.dept-bar-wrap{margin-top:8px;height:6px;background:#F3F4F6;border-radius:3px;overflow:hidden}
.dept-bar-fill{height:100%;border-radius:3px;transition:width .5s ease,background .3s}

.dept-right{text-align:right;flex-shrink:0}
.dept-pct{font-size:22px;font-weight:700;line-height:1}
.dept-pct.high{color:var(--green)}
.dept-pct.mid{color:var(--amber)}
.dept-pct.low{color:var(--red)}
.dept-detail{font-size:11px;color:var(--dim);margin-top:2px}

.dept-arrow{font-size:11px;color:var(--dim);transition:transform .2s;flex-shrink:0}
.dept-card.open .dept-arrow{transform:rotate(90deg)}

/* ━━ 任务列表 ━━ */
.task-panel{display:none;border-top:1px solid #F3F4F6;background:#FAFBFC}
.dept-card.open .task-panel{display:block}

.task-row{display:flex;align-items:center;padding:12px 18px;border-bottom:1px solid #F3F4F6;gap:10px;transition:background .1s}
.task-row:last-child{border-bottom:none}
.task-row:active{background:#F3F4F6}
.task-row.is-excluded{opacity:0.35}
.task-row.is-done .t-title{text-decoration:line-through;color:var(--dim)}

.t-btns{display:flex;gap:4px;flex-shrink:0}
.t-btn{width:30px;height:30px;border-radius:8px;border:1.5px solid #D1D5DB;background:#FFF;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s;color:#9CA3AF;-webkit-tap-highlight-color:transparent}
.t-btn:active{transform:scale(0.92)}
.t-btn.on-done{background:var(--green);border-color:var(--green);color:#FFF}
.t-btn.on-excl{background:#9CA3AF;border-color:#9CA3AF;color:#FFF}

.t-info{flex:1;min-width:0}
.t-title{font-size:14px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-meta{font-size:11px;color:var(--sub);margin-top:1px;display:flex;gap:6px;flex-wrap:wrap}
.t-tag{font-size:10px;padding:1px 6px;border-radius:4px;font-weight:500;flex-shrink:0}
.tag-progress{background:#DBEAFE;color:#2563EB}
.tag-blocked{background:#FEE2E2;color:#DC2626}
.tag-pending{background:#FEF3C7;color:#D97706}
.tag-hold{background:#F3F4F6;color:#6B7280}
.tag-done{background:#D1FAE5;color:#059669}
.t-overdue{color:var(--red);font-weight:600}

/* ━━ 底部 ━━ */
.foot{text-align:center;padding:24px 20px;font-size:11px;color:var(--dim)}

/* ━━ 操作说明浮层 ━━ */
.guide{position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,0.96);backdrop-filter:blur(8px);border-top:1px solid var(--border);padding:8px 16px;display:flex;justify-content:center;gap:16px;font-size:11px;color:var(--sub);z-index:50}
.guide span{display:flex;align-items:center;gap:4px}
.guide .dot{width:8px;height:8px;border-radius:3px;flex-shrink:0}

@media(max-width:480px){
  :root{--ring-size:110px}
  .kpi .v{font-size:20px}
  .overview{gap:14px;padding:16px 14px 10px}
  .dept-cards{padding:0 8px}
}
</style>
</head>
<body>

<div class="topbar">
  <div>
    <h1>工作总览</h1>
    <div class="date">${dateStr} ${weekday}</div>
  </div>
  <span class="save-msg" id="saveMsg">已保存 ✓</span>
</div>

<div class="overview">
  <div class="ring-wrap">
    <svg viewBox="0 0 160 160">
      <circle class="ring-bg" cx="80" cy="80" r="65"/>
      <circle class="ring-fg" id="ringFg" cx="80" cy="80" r="65" stroke-dasharray="408.4" stroke-dashoffset="408.4"/>
    </svg>
    <div class="ring-center">
      <div class="ring-num" id="ringNum">0%</div>
      <div class="ring-lbl">总达成率</div>
    </div>
  </div>
  <div class="kpi-group">
    <div class="kpi c1"><div class="v" id="kAll">-</div><div class="l">统计总数</div></div>
    <div class="kpi c2"><div class="v" id="kPend">-</div><div class="l">待办</div></div>
    <div class="kpi c3"><div class="v" id="kDone">-</div><div class="l">已完成</div></div>
    <div class="kpi c4"><div class="v" id="kAlert">-</div><div class="l">异常</div></div>
  </div>
</div>

<div class="section-title">
  <span>各部门进展</span>
  <span class="hint">点击展开 · 可调整状态</span>
</div>

<div class="dept-cards" id="deptCards"></div>

<div class="foot">ClawdBot · ${today.format('YYYY-MM-DD HH:mm')} · 调整后自动保存</div>

<div class="guide">
  <span><span class="dot" style="background:var(--green)"></span>✓ 完成</span>
  <span><span class="dot" style="background:#9CA3AF"></span>— 排除统计</span>
  <span>点击部门展开明细</span>
</div>

<script>
var D=${deptDataJson};
var SERVER='${serverBaseUrl}';
var COLORS=['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16'];

// 恢复覆盖
(function(){
  try{
    var s=localStorage.getItem('cb_ov');
    if(!s)return;
    var m=JSON.parse(s);
    D.forEach(function(d){d.tasks.forEach(function(t){
      if(m[t.id]){t.overrideStatus=m[t.id].s||t.overrideStatus;t.excluded=!!m[t.id].e;}
    });});
  }catch(e){}
})();

function save(){
  var m={};
  D.forEach(function(d){d.tasks.forEach(function(t){
    var def=t.isCompleted?'completed':'pending';
    if(t.overrideStatus!==def||t.excluded)m[t.id]={s:t.overrideStatus,e:t.excluded};
  });});
  localStorage.setItem('cb_ov',JSON.stringify(m));
  if(SERVER){fetch(SERVER+'/api/overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrides:m,updatedAt:new Date().toISOString()})}).catch(function(){});}
  var el=document.getElementById('saveMsg');el.classList.add('show');setTimeout(function(){el.classList.remove('show');},1500);
}

function stats(d){
  var tot=0,done=0,alert=0;
  d.tasks.forEach(function(t){
    if(t.excluded)return;
    tot++;
    if(t.overrideStatus==='completed')done++;
    if(t.statusKey==='blocked'||t.statusKey==='pending_response')alert++;
  });
  return{tot:tot,done:done,pend:tot-done,rate:tot>0?Math.round(done/tot*100):0,alert:alert};
}

function globalStats(){
  var tot=0,done=0,alert=0;
  D.forEach(function(d){var s=stats(d);tot+=s.tot;done+=s.done;alert+=s.alert;});
  return{tot:tot,done:done,pend:tot-done,rate:tot>0?Math.round(done/tot*100):0,alert:alert};
}

function updateTop(){
  var g=globalStats();
  document.getElementById('kAll').textContent=g.tot;
  document.getElementById('kPend').textContent=g.pend;
  document.getElementById('kDone').textContent=g.done;
  document.getElementById('kAlert').textContent=g.alert;
  document.getElementById('ringNum').textContent=g.rate+'%';
  var circ=408.4;
  var fg=document.getElementById('ringFg');
  fg.style.strokeDashoffset=circ-(circ*g.rate/100);
  fg.style.stroke=g.rate>=60?'#10B981':g.rate>=30?'#F59E0B':'#EF4444';
}

function tagClass(k){
  var m={in_progress:'tag-progress',blocked:'tag-blocked',pending_response:'tag-pending',on_hold:'tag-hold',completed:'tag-done',not_started:'tag-hold'};
  return m[k]||'tag-progress';
}
function tagText(k){
  var m={in_progress:'推进中',blocked:'阻塞',pending_response:'催办中',on_hold:'暂缓',completed:'已完成',not_started:'待启动'};
  return m[k]||'推进中';
}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function render(){
  updateTop();
  var box=document.getElementById('deptCards');
  // 保留open状态
  var openSet={};
  box.querySelectorAll('.dept-card.open').forEach(function(el){openSet[el.dataset.idx]=true;});

  var html='';
  D.forEach(function(dept,di){
    var s=stats(dept);
    var pctClass=s.rate>=60?'high':s.rate>=30?'mid':'low';
    var barColor=s.rate>=60?'#10B981':s.rate>=30?'#F59E0B':'#EF4444';
    var bgColor=COLORS[di%COLORS.length];
    var initial=dept.name.charAt(0);
    var isOpen=openSet[di]?'open':'';
    var exclCount=dept.tasks.length-s.tot;

    html+='<div class="dept-card '+isOpen+'" data-idx="'+di+'">';
    html+='<div class="dept-head" onclick="toggle(this)">';
    html+='<div class="dept-icon" style="background:'+bgColor+'">'+initial+'</div>';
    html+='<div class="dept-body">';
    html+='<div class="dept-name">'+esc(dept.name)+'</div>';
    html+='<div class="dept-sub">';
    html+=s.done+'完成 · '+s.pend+'待办';
    if(exclCount>0)html+=' · '+exclCount+'排除';
    if(dept.owner)html+=' · '+esc(dept.owner);
    html+='</div>';
    html+='<div class="dept-bar-wrap"><div class="dept-bar-fill" style="width:'+s.rate+'%;background:'+barColor+'"></div></div>';
    html+='</div>';
    html+='<div class="dept-right"><div class="dept-pct '+pctClass+'">'+s.rate+'%</div><div class="dept-detail">'+s.done+'/'+s.tot+'</div></div>';
    html+='<span class="dept-arrow">▶</span>';
    html+='</div>';

    // 任务面板
    html+='<div class="task-panel">';
    dept.tasks.forEach(function(t,ti){
      var isDone=t.overrideStatus==='completed';
      var isExcl=t.excluded;
      var cls='task-row'+(isDone?' is-done':'')+(isExcl?' is-excluded':'');

      html+='<div class="'+cls+'">';
      html+='<div class="t-btns">';
      html+='<div class="t-btn'+(isDone?' on-done':'')+'" onclick="tDone('+di+','+ti+')">✓</div>';
      html+='<div class="t-btn'+(isExcl?' on-excl':'')+'" onclick="tExcl('+di+','+ti+')">—</div>';
      html+='</div>';
      html+='<div class="t-info">';
      html+='<div class="t-title">'+esc(t.title)+'</div>';
      html+='<div class="t-meta">';
      if(t.owner)html+='<span>'+esc(t.owner)+'</span>';
      if(t.deadline){
        var dl=new Date(t.deadline);var now=new Date();var over=!isDone&&dl<now;
        html+='<span'+(over?' class="t-overdue"':'')+'>截止'+(dl.getMonth()+1)+'/'+ dl.getDate()+(over?' ⚠':'')+'</span>';
      }
      html+='</div></div>';
      html+='<span class="t-tag '+tagClass(t.statusKey)+'">'+tagText(t.statusKey)+'</span>';
      html+='</div>';
    });
    html+='</div></div>';
  });
  box.innerHTML=html;
}

function toggle(el){el.closest('.dept-card').classList.toggle('open');}
function tDone(di,ti){D[di].tasks[ti].overrideStatus=D[di].tasks[ti].overrideStatus==='completed'?'pending':'completed';render();save();}
function tExcl(di,ti){D[di].tasks[ti].excluded=!D[di].tasks[ti].excluded;render();save();}

render();
<\/script>
</body>
</html>`;
  }

  /**
   * 生成可左右滑动的明细表格页面
   * 手机友好，横向滚动，原生滚动条
   */
  generateScrollableTable(taskData) {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { departments } = taskData;

    // 扁平化所有任务
    const rows = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        const dl = task.deadline ? dayjs(task.deadline) : null;
        let urgency = '';
        let urgencyClass = '';
        if (task.isCompleted) {
          urgency = '已完成';
          urgencyClass = 'u-done';
        } else if (task.statusKey === 'blocked') {
          urgency = '阻塞';
          urgencyClass = 'u-blocked';
        } else if (dl && dl.isBefore(today, 'day')) {
          const days = today.diff(dl, 'day');
          urgency = `逾期${days}天`;
          urgencyClass = 'u-overdue';
        } else if (dl && dl.isSame(today, 'day')) {
          urgency = '今日到期';
          urgencyClass = 'u-today';
        } else if (dl) {
          const days = dl.diff(today, 'day');
          urgency = `剩${days}天`;
          urgencyClass = days <= 3 ? 'u-soon' : 'u-ok';
        } else {
          urgency = '无截止日';
          urgencyClass = 'u-none';
        }

        rows.push({
          dept: this._short(dept.department),
          title: task.title || '',
          owner: task.owner || dept.owner || '',
          status: task.status || '',
          statusKey: task.statusKey || '',
          deadline: dl ? dl.format('M/D') : '-',
          urgency,
          urgencyClass,
          notes: task.notes || '',
          isCompleted: task.isCompleted,
        });
      }
    }

    // 按紧急程度排序：阻塞 > 逾期 > 今日到期 > 即将到期 > 其他 > 已完成
    const urgencyOrder = { 'u-blocked': 0, 'u-overdue': 1, 'u-today': 2, 'u-soon': 3, 'u-ok': 4, 'u-none': 5, 'u-done': 6 };
    rows.sort((a, b) => (urgencyOrder[a.urgencyClass] || 5) - (urgencyOrder[b.urgencyClass] || 5));

    const rowsHtml = rows.map((r, i) => {
      const cls = r.isCompleted ? 'row-done' : '';
      return `<tr class="${cls}">
        <td class="col-idx">${i + 1}</td>
        <td class="col-dept">${this._esc(r.dept)}</td>
        <td class="col-title">${this._esc(r.title)}</td>
        <td class="col-owner">${this._esc(r.owner)}</td>
        <td class="col-status"><span class="st st-${r.statusKey}">${this._esc(r.status)}</span></td>
        <td class="col-dl">${r.deadline}</td>
        <td class="col-urgency"><span class="${r.urgencyClass}">${r.urgency}</span></td>
      </tr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>事项明细 · ${dateStr}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","SF Pro Text","Helvetica Neue",sans-serif;background:#F5F6F8;color:#1a1a2e;-webkit-font-smoothing:antialiased}

.header{background:#FFF;padding:16px 20px;border-bottom:1px solid #E5E7EB;position:sticky;top:0;z-index:10}
.header h1{font-size:17px;font-weight:700}
.header .sub{font-size:13px;color:#6B7280;margin-top:2px}

.hint{padding:10px 20px;font-size:12px;color:#9CA3AF;background:#FFF;border-bottom:1px solid #F3F4F6}
.hint span{color:#3B82F6}

/* 表格容器：左右可滚动 */
.table-wrap{
  overflow-x:auto;
  -webkit-overflow-scrolling:touch;
  background:#FFF;
  margin:0;
  padding-bottom:80px;
}

/* 滚动条样式 */
.table-wrap::-webkit-scrollbar{height:6px}
.table-wrap::-webkit-scrollbar-track{background:#F3F4F6}
.table-wrap::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:3px}

table{
  width:max-content;
  min-width:100%;
  border-collapse:collapse;
  font-size:14px;
}

thead{position:sticky;top:0;z-index:5}
th{
  background:#F8FAFC;
  color:#374151;
  font-weight:600;
  font-size:13px;
  padding:12px 14px;
  text-align:left;
  white-space:nowrap;
  border-bottom:2px solid #E5E7EB;
  position:sticky;top:0;
}
td{
  padding:11px 14px;
  border-bottom:1px solid #F3F4F6;
  white-space:nowrap;
  vertical-align:middle;
}
tr:active{background:#F9FAFB}

/* 列宽 */
.col-idx{width:36px;color:#9CA3AF;font-size:12px;text-align:center}
.col-dept{min-width:80px;font-weight:600;color:#374151}
.col-title{min-width:200px;max-width:320px;white-space:normal;word-break:break-all;font-size:14px;line-height:1.4}
.col-owner{min-width:70px;color:#6B7280}
.col-status{min-width:70px}
.col-dl{min-width:60px;color:#6B7280}
.col-urgency{min-width:80px;font-weight:600;font-size:13px}

/* 状态标签 */
.st{font-size:12px;padding:2px 8px;border-radius:4px;font-weight:500}
.st-in_progress{background:#DBEAFE;color:#2563EB}
.st-blocked{background:#FEE2E2;color:#DC2626}
.st-pending_response{background:#FEF3C7;color:#D97706}
.st-on_hold{background:#F3F4F6;color:#6B7280}
.st-completed{background:#D1FAE5;color:#059669}
.st-not_started{background:#F3F4F6;color:#9CA3AF}

/* 紧急程度颜色 */
.u-blocked{color:#DC2626}
.u-overdue{color:#DC2626}
.u-today{color:#D97706;background:#FEF3C7;padding:2px 6px;border-radius:4px}
.u-soon{color:#D97706}
.u-ok{color:#059669}
.u-none{color:#9CA3AF}
.u-done{color:#059669}

.row-done td{opacity:0.45;text-decoration:line-through}
.row-done .col-idx,.row-done .col-urgency{text-decoration:none}

.foot{text-align:center;padding:20px;font-size:11px;color:#9CA3AF;position:fixed;bottom:0;left:0;right:0;background:rgba(245,246,248,0.95)}

@media(max-width:480px){
  th,td{padding:9px 10px;font-size:13px}
  .col-title{min-width:160px}
}
</style>
</head>
<body>

<div class="header">
  <h1>事项明细表</h1>
  <div class="sub">${dateStr} ${weekday} · 共${rows.length}项</div>
</div>
<div class="hint">👈 <span>左右滑动</span> 查看更多列</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>部门</th>
        <th>事项名称</th>
        <th>负责人</th>
        <th>状态</th>
        <th>截止日</th>
        <th>紧急程度</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</div>

<div class="foot">ClawdBot · ${today.format('YYYY-MM-DD HH:mm')}</div>

</body>
</html>`;
  }

  _short(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8);
  }

  _esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

module.exports = new DashboardHtml();
