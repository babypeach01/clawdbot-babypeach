/**
 * 消息模板引擎（v9 - 三次推送体系）
 *
 * 早晨：总览（各部门今日到期任务概况）
 * 下午：核查（今日到期事项明细，供人工逐一核查）
 * 晚上：日报（当日完成情况小结）
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

class MessageTemplates {

  // ═══════════════════════════════════════
  // 早晨推送：总览性概括（一天的开始）
  // ═══════════════════════════════════════

  /**
   * 早晨总览消息
   * 重点：各部门今天有几项到截止时间、整体情况
   */
  generateMorningSummary(taskData, tableUrl = '') {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    // 统计今日到期
    const todayDue = this._countDueToday(departments, today);
    const overdue = this._countOverdue(departments, today);

    let msg = `## ${dateStr} ${weekday} · 早安总览\n\n`;
    msg += `> 全局 **${summary.totalTasks}** 项 ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${totalPending}** ┃ 达成率 **${rate}%**\n\n`;

    if (todayDue.total > 0 || overdue.total > 0) {
      msg += `---\n\n`;
      if (todayDue.total > 0) {
        msg += `> **今日到期 ${todayDue.total} 项**，需各部门今日办结\n\n`;
      }
      if (overdue.total > 0) {
        msg += `> **已逾期 ${overdue.total} 项**，需重点关注\n\n`;
      }
    }

    msg += `---\n\n`;

    // 各部门概况（一行一个）
    const depts = this._sortDepts(departments);
    for (const d of depts) {
      const done = d.completedCount || 0;
      const pend = d.pendingCount || 0;
      const total = done + pend;
      const r = this._deptRate(d);
      const dueCount = todayDue.byDept[this._shortDept(d.department)] || 0;
      const overdueCount = overdue.byDept[this._shortDept(d.department)] || 0;

      const icon = r >= 60 ? '🟢' : r >= 30 ? '🟡' : '🔴';
      let line = `> ${icon} **${this._shortDept(d.department)}** ${this._progressBar(r)} ${r}%（${done}/${total}）`;
      if (dueCount > 0) line += ` · 今日到期${dueCount}项`;
      if (overdueCount > 0) line += ` · 逾期${overdueCount}项`;
      msg += line + `\n\n`;
    }

    if (tableUrl) {
      msg += `---\n\n[查看完整明细表（可左右滑动）](${tableUrl})\n\n`;
    }

    msg += `*${today.format('HH:mm')} 自动生成*`;
    return { title: `${dateStr} 早安总览`, text: msg };
  }

  // ═══════════════════════════════════════
  // 下午推送：核查清单（人工逐一核查用）
  // ═══════════════════════════════════════

  /**
   * 下午核查消息 → 推送给管理者
   * 列出今天到截止日的所有事项，按部门分组
   */
  generateAfternoonCheck(taskData) {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const { departments } = taskData;

    // 收集今日到期 + 逾期的事项
    const items = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        if (!task.deadline) continue;
        const dl = dayjs(task.deadline);
        const diffDays = dl.diff(today, 'day');
        if (diffDays <= 0) { // 今天到期或已逾期
          items.push({
            dept: this._shortDept(dept.department),
            deptOwner: dept.owner || '',
            title: task.title,
            owner: task.owner || dept.owner || '',
            deadline: dl.format('M/D'),
            overdueDays: diffDays < 0 ? Math.abs(diffDays) : 0,
            isDueToday: diffDays === 0,
            status: task.status || '推进中',
            statusKey: task.statusKey,
          });
        }
      }
    }

    if (items.length === 0) {
      return {
        title: `${dateStr} 核查`,
        text: `## ${dateStr} 下午核查\n\n> 今日无到期事项，各部门正常推进中\n\n*${today.format('HH:mm')} 自动检测*`,
      };
    }

    // 按部门分组
    const byDept = {};
    for (const item of items) {
      if (!byDept[item.dept]) byDept[item.dept] = [];
      byDept[item.dept].push(item);
    }

    let msg = `## ${dateStr} 下午核查\n\n`;
    msg += `> 以下 **${items.length}** 项今日到期或已逾期，请逐一核查\n\n`;
    msg += `---\n\n`;

    for (const [dept, tasks] of Object.entries(byDept)) {
      msg += `### ${dept}\n\n`;
      for (const t of tasks) {
        if (t.overdueDays > 0) {
          msg += `> ⏰ **${this._truncate(t.title, 28)}** · 逾期${t.overdueDays}天 · ${t.owner}\n\n`;
        } else {
          msg += `> 📌 **${this._truncate(t.title, 28)}** · 今日到期 · ${t.owner}\n\n`;
        }
      }
    }

    msg += `---\n\n> 请核查后回复处理进展\n\n`;
    msg += `*${today.format('HH:mm')} 自动检测*`;
    return { title: `${dateStr} 核查清单`, text: msg, items };
  }

  /**
   * 给部门负责人的私聊催进度消息
   */
  generateDeptReminder(deptName, tasks, today) {
    if (!today) today = dayjs();
    const dateStr = today.format('M/D');

    let msg = `## ${deptName} · 今日事项跟进\n\n`;
    msg += `> 以下 ${tasks.length} 项今日需要更新进展\n\n`;

    for (const t of tasks) {
      if (t.overdueDays > 0) {
        msg += `> ⏰ **${this._truncate(t.title, 28)}** · 逾期${t.overdueDays}天\n\n`;
      } else {
        msg += `> 📌 **${this._truncate(t.title, 28)}** · 今日到期\n\n`;
      }
    }

    msg += `---\n\n请回复各事项最新进展，谢谢 🙏`;
    return { title: `${dateStr} ${deptName}事项跟进`, text: msg };
  }

  // ═══════════════════════════════════════
  // 晚上推送：当日小日报
  // ═══════════════════════════════════════

  /**
   * 晚上日报消息
   * 重点：今天各部门完成了什么、还剩什么、有没有重点/额外事项
   */
  generateEveningSummary(taskData, tableUrl = '', extraNotes = '') {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;
    const totalPending = summary.totalTasks - summary.completedTasks;

    const todayDue = this._countDueToday(departments, today);
    const overdue = this._countOverdue(departments, today);

    let msg = `## ${dateStr} ${weekday} · 当日小结\n\n`;
    msg += `> 全局达成率 **${rate}%** ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${totalPending}** ┃ 异常 **${(summary.blockedTasks || 0) + overdue.total}**\n\n`;
    msg += `---\n\n`;

    // 各部门完成情况
    const depts = this._sortDepts(departments);
    for (const d of depts) {
      const done = d.completedCount || 0;
      const pend = d.pendingCount || 0;
      const total = done + pend;
      const r = this._deptRate(d);

      const icon = r >= 60 ? '🟢' : r >= 30 ? '🟡' : '🔴';
      const bar = this._progressBar(r);
      msg += `> ${icon} **${this._shortDept(d.department)}** ${bar} ${r}%（${done}/${total}）\n\n`;
    }

    // 异常汇总
    const alerts = this._collectAlerts(departments, today);
    if (alerts.length > 0) {
      const blocked = alerts.filter(a => a.icon === '🚫').length;
      const overdueN = alerts.filter(a => a.icon === '⏰').length;
      msg += `---\n\n`;
      msg += `> ⚠️ **${alerts.length}项异常**`;
      const parts = [];
      if (blocked) parts.push(`${blocked}阻塞`);
      if (overdueN) parts.push(`${overdueN}逾期`);
      msg += `（${parts.join(' ')}）\n\n`;
    }

    // 额外备注（老板交代的事项等）
    if (extraNotes) {
      msg += `---\n\n> 📝 **重点备注**：${extraNotes}\n\n`;
    }

    if (tableUrl) {
      msg += `---\n\n[查看完整明细表](${tableUrl})\n\n`;
    }

    msg += `*${today.format('HH:mm')} 自动生成*`;
    return { title: `${dateStr} 当日小结`, text: msg };
  }

  // ═══════════════════════════════════════
  // 保留：兼容旧接口
  // ═══════════════════════════════════════

  generateDailySummary(taskData, dashboardUrl = '') {
    return this.generateMorningSummary(taskData, dashboardUrl);
  }

  generateWeeklyReview(taskData) {
    const today = dayjs();
    const weekStart = today.subtract(4, 'day').format('M/D');
    const weekEnd = today.format('M/D');
    const { summary, departments } = taskData;

    let msg = `## 📅 本周回顾 ${weekStart}-${weekEnd}\n\n`;
    msg += `> 总 **${summary.totalTasks}** ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${summary.totalTasks - summary.completedTasks}**\n\n`;
    msg += `---\n\n`;

    const depts = departments
      .map(d => ({ name: this._shortDept(d.department), rate: this._deptRate(d), done: d.completedCount || 0, total: (d.pendingCount || 0) + (d.completedCount || 0) }))
      .filter(d => d.total > 0)
      .sort((a, b) => b.rate - a.rate);

    for (let i = 0; i < depts.length; i++) {
      const d = depts[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '　';
      msg += `> ${medal} **${d.name}** ${this._progressBar(d.rate)} ${d.rate}%（${d.done}/${d.total}）\n\n`;
    }

    msg += `*${today.format('HH:mm')} 自动生成*`;
    return { title: `本周回顾 ${weekStart}-${weekEnd}`, text: msg };
  }

  // ═══════════════════════════════════════
  // 工具函数
  // ═══════════════════════════════════════

  _progressBar(rate) {
    const filled = Math.round(rate / 20); // 0-5
    return '■'.repeat(filled) + '□'.repeat(5 - filled);
  }

  _deptRate(d) {
    const total = (d.pendingCount || 0) + (d.completedCount || 0);
    return total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
  }

  _sortDepts(departments) {
    return [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => this._deptRate(a) - this._deptRate(b)); // 差的排前面
  }

  /**
   * 统计今日到期的任务数（按部门）
   */
  _countDueToday(departments, today) {
    let total = 0;
    const byDept = {};
    for (const dept of departments) {
      const dName = this._shortDept(dept.department);
      let count = 0;
      for (const t of dept.tasks || []) {
        if (t.isCompleted || !t.deadline) continue;
        if (dayjs(t.deadline).isSame(today, 'day')) {
          count++;
          total++;
        }
      }
      if (count > 0) byDept[dName] = count;
    }
    return { total, byDept };
  }

  /**
   * 统计已逾期的任务数（按部门）
   */
  _countOverdue(departments, today) {
    let total = 0;
    const byDept = {};
    for (const dept of departments) {
      const dName = this._shortDept(dept.department);
      let count = 0;
      for (const t of dept.tasks || []) {
        if (t.isCompleted || !t.deadline) continue;
        if (dayjs(t.deadline).isBefore(today, 'day')) {
          count++;
          total++;
        }
      }
      if (count > 0) byDept[dName] = count;
    }
    return { total, byDept };
  }

  _collectAlerts(departments, today) {
    const alerts = [];
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '';
        const deptName = this._shortDept(dept.department);
        if (task.statusKey === 'blocked')
          alerts.push({ icon: '🚫', type: '阻塞', dept: deptName, title: this._truncate(task.title, 22), owner, level: 3 });
        if (task.deadline && dayjs(task.deadline).isBefore(today, 'day')) {
          const days = today.diff(dayjs(task.deadline), 'day');
          alerts.push({ icon: '⏰', type: `逾期${days}天`, dept: deptName, title: this._truncate(task.title, 22), owner, level: days > 5 ? 3 : 2 });
        }
      }
    }
    return alerts.sort((a, b) => b.level - a.level);
  }

  _truncate(str, len) { if (!str) return ''; return str.length > len ? str.slice(0, len) + '...' : str; }
  _shortDept(name) { if (!name) return '未分类'; return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8); }
}

module.exports = new MessageTemplates();
