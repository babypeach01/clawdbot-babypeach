/**
 * 消息模板引擎（v8 - 极简总览）
 *
 * 核心原则：一条消息看完全局，不啰嗦
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

class MessageTemplates {

  /**
   * 每日总览（钉钉Markdown，一条消息看完）
   * 格式：大标题 + 一行总数据 + 紧凑部门列表 + 异常摘要
   */
  generateDailySummary(taskData, dashboardUrl = '') {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    let msg = `## 📊 ${dateStr} ${weekday} 工作总览\n\n`;
    msg += `> 达成率 **${rate}%** ┃ 共 **${summary.totalTasks}** 项 ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${totalPending}**\n\n`;
    msg += `---\n\n`;

    // 紧凑部门列表：一行一个部门，进度条 + 数字
    const depts = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => {
        const ra = this._deptRate(a);
        const rb = this._deptRate(b);
        return ra - rb; // 差的排前面
      });

    for (const d of depts) {
      const done = d.completedCount || 0;
      const pend = d.pendingCount || 0;
      const total = done + pend;
      const r = this._deptRate(d);
      const bar = this._progressBar(r);
      const icon = r >= 60 ? '🟢' : r >= 30 ? '🟡' : '🔴';
      msg += `> ${icon} **${this._shortDept(d.department)}** ${bar} ${r}%（${done}/${total}）\n\n`;
    }

    // 异常摘要（一行带过）
    const alerts = this._collectAlerts(departments, today);
    if (alerts.length > 0) {
      const blocked = alerts.filter(a => a.icon === '🚫').length;
      const overdue = alerts.filter(a => a.icon === '⏰').length;
      const parts = [];
      if (blocked) parts.push(`${blocked}阻塞`);
      if (overdue) parts.push(`${overdue}逾期`);
      msg += `---\n\n> ⚠️ **${alerts.length}项异常**（${parts.join(' ')}）\n\n`;
    }

    if (dashboardUrl) {
      msg += `---\n\n[📋 查看明细看板](${dashboardUrl})\n\n`;
    }

    msg += `*${today.format('HH:mm')} 自动生成*`;
    return { title: `${dateStr} 工作总览`, text: msg };
  }

  /**
   * 互动卡片数据（钉钉原生卡片）
   */
  generateCardData(taskData) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;
    const completionRate = summary.totalTasks > 0
      ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    const deptSorted = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0));

    const chartData = {
      type: 'histogram',
      data: deptSorted.slice(0, 10).map(d => ({
        x: this._shortDept(d.department),
        y: d.pendingCount || 0,
        type: this._shortDept(d.department),
      })),
      config: {},
    };

    const alertCount = this._collectAlerts(departments, today).length;
    const alertsText = alertCount > 0
      ? `⚠️ ${alertCount}项异常`
      : '✅ 运转正常';

    return {
      title: `📊 ${dateStr} ${weekday} 工作总览`,
      completionRate: `${completionRate}%`,
      pendingCount: `${totalPending}`,
      completedCount: `${summary.completedTasks}`,
      chartData,
      alerts: alertsText,
    };
  }

  /**
   * 重点事项预警（私信给管理者）
   */
  generatePrivateAlert(taskData) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const { departments } = taskData;

    const alerts = this._collectAlerts(departments, today);
    if (alerts.length === 0) return null;

    let msg = `## ⚠️ ${dateStr} 重点事项预警\n\n`;
    msg += `> 以下 **${alerts.length}** 项需要您核查\n\n`;

    const blocked = alerts.filter(a => a.icon === '🚫');
    const overdue = alerts.filter(a => a.icon === '⏰');
    const pending = alerts.filter(a => a.icon === '📞');

    if (blocked.length > 0) {
      msg += `### 🚫 阻塞 ${blocked.length}项\n\n`;
      for (const a of blocked) {
        msg += `> **${a.title}** → ${a.owner}（${a.dept}）\n\n`;
      }
    }
    if (overdue.length > 0) {
      msg += `### ⏰ 逾期 ${overdue.length}项\n\n`;
      for (const a of overdue) {
        msg += `> **${a.title}**（${a.type}）→ ${a.owner}（${a.dept}）\n\n`;
      }
    }
    if (pending.length > 0) {
      msg += `### 📞 催办中 ${pending.length}项\n\n`;
      for (const a of pending.slice(0, 5)) {
        msg += `> **${a.title}** → ${a.owner}（${a.dept}）\n\n`;
      }
    }

    msg += `---\n\n*${today.format('HH:mm')} 自动检测*`;
    return { title: `${dateStr} 重点事项预警`, text: msg };
  }

  /**
   * 正式闭环报送（管理者手动触发 → 群）
   */
  generateFormalReport(taskData, managerNotes = '') {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    let msg = `## 📋 ${dateStr} ${weekday} · 工作总结\n\n`;
    msg += `> 达成率 **${rate}%** ┃ 总 **${summary.totalTasks}** ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${totalPending}**\n\n`;
    msg += `---\n\n`;

    const depts = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => this._deptRate(a) - this._deptRate(b));

    for (const d of depts) {
      const done = d.completedCount || 0;
      const pend = d.pendingCount || 0;
      const r = this._deptRate(d);
      const bar = this._progressBar(r);
      const icon = r >= 60 ? '🟢' : r >= 30 ? '🟡' : '🔴';
      msg += `> ${icon} **${this._shortDept(d.department)}** ${bar} ${r}%（${done}/${done + pend}）\n\n`;
    }

    const alerts = this._collectAlerts(departments, today);
    if (alerts.length > 0) {
      msg += `---\n\n> ⚠️ ${alerts.length}项异常需关注\n\n`;
    }

    if (managerNotes) {
      msg += `---\n\n> 💬 ${managerNotes}\n\n`;
    }

    msg += `*${today.format('HH:mm')} 发布*`;
    return { title: `${dateStr} 工作总结`, text: msg };
  }

  /**
   * 催办（@指定部门）
   */
  generateReminder(taskData, deptName) {
    const today = dayjs();
    const dept = taskData.departments.find(d =>
      d.department.includes(deptName) || this._shortDept(d.department) === deptName
    );
    if (!dept) return null;

    const issues = (dept.tasks || []).filter(t => {
      if (t.isCompleted) return false;
      return t.statusKey === 'blocked' || (t.deadline && dayjs(t.deadline).isBefore(today, 'day'));
    });
    if (issues.length === 0) return null;

    let msg = `## 📌 ${this._shortDept(dept.department)} · ${issues.length}项待跟进\n\n`;
    for (const t of issues.slice(0, 5)) {
      const owner = t.owner || dept.owner || '';
      if (t.statusKey === 'blocked') {
        msg += `> 🚫 **${this._truncate(t.title, 25)}** → ${owner}\n\n`;
      } else {
        const days = today.diff(dayjs(t.deadline), 'day');
        msg += `> ⏰ **${this._truncate(t.title, 25)}** 逾期${days}天 → ${owner}\n\n`;
      }
    }
    msg += `请回复处理进展 ⬇️`;
    return { title: `催办·${this._shortDept(dept.department)}`, text: msg, atUserIds: [dept.owner].filter(Boolean) };
  }

  /**
   * 周五回顾
   */
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

  // ── 工具函数 ──

  _progressBar(rate) {
    const filled = Math.round(rate / 20); // 0-5
    return '■'.repeat(filled) + '□'.repeat(5 - filled);
  }

  _deptRate(d) {
    const total = (d.pendingCount || 0) + (d.completedCount || 0);
    return total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
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
        if (task.statusKey === 'pending_response')
          alerts.push({ icon: '📞', type: '催办中', dept: deptName, title: this._truncate(task.title, 22), owner, level: 1 });
      }
    }
    return alerts.sort((a, b) => b.level - a.level);
  }

  _truncate(str, len) { if (!str) return ''; return str.length > len ? str.slice(0, len) + '...' : str; }
  _shortDept(name) { if (!name) return '未分类'; return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8); }
}

module.exports = new MessageTemplates();
