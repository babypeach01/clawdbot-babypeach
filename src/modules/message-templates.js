/**
 * 消息模板引擎（v5 - 钉钉原生嵌入式可滚动风格）
 *
 * 5种消息类型：
 * 1. morningBrief    - 晨报焦点（半屏，只看异常）
 * 2. dashboard       - 部门看板 ActionCard（原生表格风格，可滚动）
 * 3. urgentAlert     - 单项催办（独立消息，5行以内）
 * 4. weeklyReview    - 周五回顾（图表 + 精简总结）
 * 5. detailTable     - 事项明细表（原生滚动长列表）
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

class MessageTemplates {
  /**
   * ═══════════════════════════════════════
   *  晨报 - 极简焦点卡（半屏，10秒看完）
   * ═══════════════════════════════════════
   */
  generateMorningBrief(taskData) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];

    const overdue = [];
    const blocked = [];
    const urgent = [];

    for (const dept of taskData.departments) {
      for (const task of dept.tasks) {
        if (task.isCompleted) continue;
        if (task.deadline) {
          const dl = dayjs(task.deadline);
          if (dl.isBefore(today, 'day')) {
            overdue.push({ title: this._truncate(task.title, 25), owner: task.owner || dept.owner, dept: this._shortDept(dept.department), days: today.diff(dl, 'day') });
          }
        }
        if (task.statusKey === 'blocked') {
          blocked.push({ title: this._truncate(task.title, 25), owner: task.owner || dept.owner, dept: this._shortDept(dept.department) });
        }
        if (task.statusKey === 'pending_response') {
          urgent.push({ title: this._truncate(task.title, 25), owner: task.owner || dept.owner, dept: this._shortDept(dept.department) });
        }
      }
    }

    let msg = `## ☀️ ${dateStr} ${weekday} · 今日焦点\n\n`;

    if (overdue.length > 0) {
      msg += `**🔴 逾期 ${overdue.length}项**\n\n`;
      for (const item of overdue.slice(0, 5)) {
        msg += `> ${item.title}（逾期${item.days}天）→ ${item.owner}\n\n`;
      }
      if (overdue.length > 5) msg += `> ...还有${overdue.length - 5}项\n\n`;
    }

    if (blocked.length > 0) {
      msg += `**🚫 阻塞 ${blocked.length}项**\n\n`;
      for (const item of blocked.slice(0, 3)) {
        msg += `> ${item.title} → ${item.owner}\n\n`;
      }
    }

    if (urgent.length > 0) {
      msg += `**🟡 催办中 ${urgent.length}项**\n\n`;
      for (const item of urgent.slice(0, 5)) {
        msg += `> ${item.title} → ${item.owner}\n\n`;
      }
      if (urgent.length > 5) msg += `> ...还有${urgent.length - 5}项\n\n`;
    }

    if (overdue.length === 0 && blocked.length === 0 && urgent.length === 0) {
      msg += `✅ 当前无逾期、阻塞或催办事项\n\n`;
    }

    msg += `---\n\n📌 请相关负责人今日回复处理方案`;
    return { title: `${dateStr} 今日焦点`, text: msg };
  }

  /**
   * ═══════════════════════════════════════
   *  部门看板 - 钉钉原生嵌入式可滚动 ActionCard
   *  （文字模拟表格 + 进度条 + 分部门明细）
   * ═══════════════════════════════════════
   */
  generateDashboard(taskData, chartUrls) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;

    let msg = `## 📊 ${dateStr} ${weekday} · 部门工作看板\n\n`;

    // ━━━ KPI 指标卡 ━━━
    msg += `### 📋 全局概览\n\n`;
    msg += `> **${summary.totalTasks}** 总事项 ┃ `;
    msg += `**${totalPending}** 待办 ┃ `;
    msg += `**${summary.completedTasks}** 已完成\n\n`;
    msg += `> 🔵推进中 **${summary.inProgressTasks}** ┃ `;
    msg += `🟡催办中 **${summary.pendingResponseTasks || 0}** ┃ `;
    msg += `🔴阻塞 **${summary.blockedTasks}** ┃ `;
    msg += `⏸暂缓 **${summary.onHoldTasks || 0}**\n\n`;

    // ━━━ 部门排行（条形图模拟） ━━━
    msg += `---\n\n### 📊 部门任务排行\n\n`;
    const deptSorted = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0));

    const maxPending = Math.max(...deptSorted.map(d => d.pendingCount || 0), 1);

    for (const dept of deptSorted) {
      const name = this._shortDept(dept.department).padEnd(4, '　');
      const pending = dept.pendingCount || 0;
      const completed = dept.completedCount || 0;
      const barLen = Math.round((pending / maxPending) * 8);
      const bar = '🟥'.repeat(barLen) + '⬜'.repeat(Math.max(0, 8 - barLen));
      msg += `> ${name} ${bar} **${pending}**待办 ${completed}完成\n\n`;
    }

    // ━━━ 嵌入图表图片 ━━━
    if (chartUrls?.deptBarUrl) {
      msg += `\n![部门任务分布](${chartUrls.deptBarUrl})\n\n`;
    }
    if (chartUrls?.healthChartUrl) {
      msg += `![异常信号](${chartUrls.healthChartUrl})\n\n`;
    }

    // ━━━ 异常事项明细（原生表格风格） ━━━
    const alerts = this._collectAlerts(departments, today);
    if (alerts.length > 0) {
      msg += `---\n\n### ⚠️ 异常事项 (${alerts.length})\n\n`;
      for (const a of alerts.slice(0, 8)) {
        msg += `> ${a.icon} **${a.type}** ┃ ${a.dept} ┃ ${a.title}\n`;
        msg += `> 　　　负责人: ${a.owner}${a.extra ? ' · ' + a.extra : ''}\n\n`;
      }
      if (alerts.length > 8) {
        msg += `> ...还有 ${alerts.length - 8} 项异常\n\n`;
      }
    }

    // ━━━ 各部门进展摘要 ━━━
    msg += `---\n\n### 📁 各部门进展\n\n`;
    for (const dept of deptSorted.slice(0, 8)) {
      const pending = dept.pendingCount || 0;
      const completed = dept.completedCount || 0;
      const total = pending + completed;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
      const statusIcon = rate >= 50 ? '🟢' : rate >= 20 ? '🟡' : '🔴';
      msg += `> ${statusIcon} **${this._shortDept(dept.department)}** ┃ 完成率${rate}% ┃ ${pending}待办/${completed}完成\n\n`;

      // 列出该部门的阻塞/逾期事项（最多2条）
      const deptAlerts = (dept.tasks || []).filter(t => !t.isCompleted && (t.statusKey === 'blocked' || (t.deadline && dayjs(t.deadline).isBefore(today, 'day')))).slice(0, 2);
      for (const t of deptAlerts) {
        const owner = t.owner || dept.owner || '';
        if (t.statusKey === 'blocked') {
          msg += `> 　🚫 ${this._truncate(t.title, 20)} → ${owner}\n\n`;
        } else {
          const days = today.diff(dayjs(t.deadline), 'day');
          msg += `> 　⏰ ${this._truncate(t.title, 20)}（逾期${days}天）→ ${owner}\n\n`;
        }
      }
    }

    msg += `---\n\n*🤖 AI 智能任务跟踪系统 · ${today.format('HH:mm')} 自动生成*`;

    return { title: `${dateStr} 部门看板`, text: msg };
  }

  /**
   * ═══════════════════════════════════════
   *  事项明细表（原生钉钉滚动长列表）
   *  作为单独一条消息发送，可在钉钉内滚动查看
   * ═══════════════════════════════════════
   */
  generateDetailTable(taskData) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const { departments } = taskData;

    let msg = `## 📋 ${dateStr} 事项明细表\n\n`;

    for (const dept of departments) {
      const tasks = (dept.tasks || []).filter(t => !t.isCompleted);
      if (tasks.length === 0) continue;

      msg += `### ${this._shortDept(dept.department)} (${tasks.length})\n\n`;

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const owner = t.owner || dept.owner || '—';
        const statusIcon = this._statusIcon(t.statusKey);
        const deadline = t.deadline ? dayjs(t.deadline).format('M/D') : '—';
        const isOverdue = t.deadline && dayjs(t.deadline).isBefore(today, 'day');

        msg += `> ${statusIcon} **${this._truncate(t.title, 28)}**\n`;
        msg += `> 　${owner} ┃ 截止${deadline}${isOverdue ? '⚠️' : ''} ┃ ${this._statusLabel(t.statusKey)}\n\n`;
      }
    }

    msg += `---\n\n*共 ${taskData.summary.totalTasks - taskData.summary.completedTasks} 项待办 · ${today.format('HH:mm')}*`;

    return { title: `${dateStr} 事项明细`, text: msg };
  }

  /**
   * ═══════════════════════════════════════
   *  单项催办 - 独立消息（5行以内）
   * ═══════════════════════════════════════
   */
  generateUrgentAlerts(taskData) {
    const today = dayjs();
    const alerts = [];

    for (const dept of taskData.departments) {
      for (const task of dept.tasks) {
        if (task.isCompleted) continue;

        let reason = null;
        let icon = '';

        if (task.deadline) {
          const dl = dayjs(task.deadline);
          if (dl.isBefore(today, 'day')) {
            const days = today.diff(dl, 'day');
            reason = `⏰ 原定${dl.format('M/D')} → 已逾期${days}天`;
            icon = '🔴';
          }
        }

        if (task.statusKey === 'blocked') {
          reason = '🚫 当前阻塞，需协调解决';
          icon = '🚫';
        }

        if (!reason) continue;

        const owner = task.owner || dept.owner || '未指定';
        const deptName = this._shortDept(dept.department);

        let msg = `## ${icon} 催办提醒\n\n`;
        msg += `**${this._truncate(task.title, 40)}**\n\n`;
        msg += `${reason}\n\n`;
        msg += `👤 ${owner}（${deptName}）\n\n`;
        if (task.notes && task.notes.length < 50 && !task.notes.includes('###')) {
          msg += `📋 ${task.notes}\n\n`;
        }
        msg += `请回复预计完成时间 ⬇️`;

        alerts.push({
          title: `催办·${deptName}·${owner}`,
          text: msg,
          owner,
          dept: deptName,
          priority: icon === '🔴' ? 1 : 2,
        });
      }
    }

    alerts.sort((a, b) => a.priority - b.priority);
    return alerts;
  }

  /**
   * ═══════════════════════════════════════
   *  周五回顾（替代当日晚报）
   * ═══════════════════════════════════════
   */
  generateWeeklyReview(taskData, weekSnapshots, chartUrls) {
    const today = dayjs();
    const weekStart = today.subtract(4, 'day').format('M/D');
    const weekEnd = today.format('M/D');
    const { summary, departments } = taskData;

    let msg = `## 📅 本周回顾 ${weekStart}-${weekEnd}\n\n`;

    // 本周成果
    if (weekSnapshots && weekSnapshots.length >= 2) {
      const first = weekSnapshots[0];
      const last = weekSnapshots[weekSnapshots.length - 1];
      const newCompleted = (last.taskData?.summary?.completedTasks || 0) - (first.taskData?.summary?.completedTasks || 0);
      const newTasks = (last.taskData?.summary?.totalTasks || 0) - (first.taskData?.summary?.totalTasks || 0);
      msg += `> ✅ 本周完成 **+${Math.max(0, newCompleted)}** 项`;
      if (newTasks > 0) msg += ` ┃ 🆕 新增 **+${newTasks}** 项`;
      msg += `\n\n`;
    }

    // 周概览数据
    msg += `### 📋 周末数据快照\n\n`;
    msg += `> 总事项 **${summary.totalTasks}** ┃ 待办 **${summary.totalTasks - summary.completedTasks}** ┃ 已完成 **${summary.completedTasks}**\n\n`;
    msg += `> 🔵推进中 **${summary.inProgressTasks}** ┃ 🟡催办 **${summary.pendingResponseTasks || 0}** ┃ 🔴阻塞 **${summary.blockedTasks}** ┃ ⏸暂缓 **${summary.onHoldTasks || 0}**\n\n`;

    // 部门完成率排行
    msg += `---\n\n### 🏆 部门完成率排行\n\n`;
    const deptRates = departments
      .map(d => {
        const total = (d.pendingCount || 0) + (d.completedCount || 0);
        const rate = total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
        return { name: this._shortDept(d.department), rate, completed: d.completedCount || 0, pending: d.pendingCount || 0 };
      })
      .filter(d => d.completed + d.pending > 0)
      .sort((a, b) => b.rate - a.rate);

    for (let i = 0; i < deptRates.length; i++) {
      const d = deptRates[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '　';
      const barLen = Math.round(d.rate / 12.5);
      const bar = '🟩'.repeat(barLen) + '⬜'.repeat(Math.max(0, 8 - barLen));
      msg += `> ${medal} ${d.name} ${bar} **${d.rate}%** (${d.completed}/${d.completed + d.pending})\n\n`;
    }

    // 嵌入图表
    if (chartUrls?.deptBarUrl) msg += `![部门任务分布](${chartUrls.deptBarUrl})\n\n`;
    if (chartUrls?.statusPieUrl) msg += `![任务状态总览](${chartUrls.statusPieUrl})\n\n`;

    // 持续未动
    const stuckItems = [];
    for (const dept of departments) {
      for (const t of dept.tasks) {
        if (t.isCompleted) continue;
        if (t.statusKey === 'blocked' || t.statusKey === 'pending_response') {
          stuckItems.push({ title: this._truncate(t.title, 25), owner: t.owner || dept.owner });
        }
      }
    }

    if (stuckItems.length > 0) {
      msg += `---\n\n### ⚠️ 待推动 ${stuckItems.length}项\n\n`;
      for (const item of stuckItems.slice(0, 5)) {
        msg += `> · ${item.title} → ${item.owner}\n\n`;
      }
      if (stuckItems.length > 5) msg += `> ...还有${stuckItems.length - 5}项\n\n`;
    }

    msg += `---\n\n*🤖 周报自动生成 ${today.format('HH:mm')}*`;
    return { title: `本周回顾 ${weekStart}-${weekEnd}`, text: msg };
  }

  // ── 内部工具函数 ──

  _collectAlerts(departments, today) {
    const alerts = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '';
        const deptName = this._shortDept(dept.department);

        if (task.statusKey === 'blocked') {
          alerts.push({ icon: '🚫', type: '阻塞', dept: deptName, title: this._truncate(task.title, 22), owner, extra: '', level: 3 });
        }
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alerts.push({ icon: '⏰', type: `逾期${days}天`, dept: deptName, title: this._truncate(task.title, 22), owner, extra: `截止${dayjs(task.deadline).format('M/D')}`, level: days > 5 ? 3 : 2 });
        }
        if (task.statusKey === 'pending_response') {
          alerts.push({ icon: '📞', type: '催办中', dept: deptName, title: this._truncate(task.title, 22), owner, extra: '', level: 1 });
        }
      }
    }
    return alerts.sort((a, b) => b.level - a.level);
  }

  _statusIcon(statusKey) {
    const map = { in_progress: '🔵', pending_response: '🟡', blocked: '🚫', on_hold: '⏸', not_started: '⚪', completed: '✅' };
    return map[statusKey] || '🔵';
  }

  _statusLabel(statusKey) {
    const map = { in_progress: '推进中', pending_response: '催办中', blocked: '阻塞', on_hold: '暂缓', not_started: '待启动', completed: '已完成' };
    return map[statusKey] || '推进中';
  }

  _truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  _shortDept(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 6);
  }
}

module.exports = new MessageTemplates();
