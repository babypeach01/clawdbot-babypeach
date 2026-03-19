/**
 * 消息模板引擎（v7 - 总结汇报导向）
 *
 * 工作流：
 *   1. 自动 → 群：宏观总结卡片（互动卡片，1-2张原生图表）
 *   2. 自动 → 管理者私信：重点事项预警（逾期/阻塞/停滞）
 *   3. 手动 → 群：管理者审核后的正式闭环报送
 *   4. 辅助 → 催办@相关人员，收集回复
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

class MessageTemplates {

  // ════════════════════════════════════════════
  //  1. 宏观总结卡片（互动卡片，发到群）
  //     老板看大盘：KPI + 部门待办分布图
  // ════════════════════════════════════════════

  generateCardData(taskData) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;
    const completionRate = summary.totalTasks > 0
      ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    // 部门待办数量柱状图
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

    // 底部简短摘要（不放详细异常，异常走私信）
    const alertCount = this._collectAlerts(departments, today).length;
    const alertsText = alertCount > 0
      ? `⚠️ ${alertCount}项异常待处理（逾期/阻塞）`
      : '✅ 各部门运转正常';

    return {
      title: `📊 ${dateStr} ${weekday} 工作总览`,
      completionRate: `${completionRate}%`,
      pendingCount: `${totalPending}`,
      completedCount: `${summary.completedTasks}`,
      chartData,
      alerts: alertsText,
    };
  }

  // ════════════════════════════════════════════
  //  2. 重点事项预警（私信给管理者）
  //     逾期/阻塞/停滞，按严重程度排序
  //     管理者收到后人工核查、决定处理方式
  // ════════════════════════════════════════════

  generatePrivateAlert(taskData) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const { departments } = taskData;

    const alerts = this._collectAlerts(departments, today);
    if (alerts.length === 0) return null;

    let msg = `## ⚠️ ${dateStr} 重点事项预警\n\n`;
    msg += `> 以下 **${alerts.length}** 项需要您核查确认\n\n`;

    // 按类型分组
    const blocked = alerts.filter(a => a.icon === '🚫');
    const overdue = alerts.filter(a => a.icon === '⏰');
    const pending = alerts.filter(a => a.icon === '📞');

    if (blocked.length > 0) {
      msg += `### 🚫 阻塞 ${blocked.length}项\n\n`;
      for (const a of blocked) {
        msg += `> **${a.title}**\n> ${a.dept} → ${a.owner}\n\n`;
      }
    }

    if (overdue.length > 0) {
      msg += `### ⏰ 逾期 ${overdue.length}项\n\n`;
      for (const a of overdue) {
        msg += `> **${a.title}**（${a.type}）\n> ${a.dept} → ${a.owner}${a.extra ? ' · ' + a.extra : ''}\n\n`;
      }
    }

    if (pending.length > 0) {
      msg += `### 📞 催办中 ${pending.length}项\n\n`;
      for (const a of pending.slice(0, 10)) {
        msg += `> **${a.title}** → ${a.owner}（${a.dept}）\n\n`;
      }
      if (pending.length > 10) msg += `> ...还有${pending.length - 10}项\n\n`;
    }

    msg += `---\n\n`;
    msg += `📌 **操作提示：**\n\n`;
    msg += `> 回复 \`催办 部门名\` → 机器人@该部门负责人催办\n\n`;
    msg += `> 回复 \`推送\` → 将今日总结发送到群\n\n`;
    msg += `*${today.format('HH:mm')} 自动检测*`;

    return { title: `${dateStr} 重点事项预警`, text: msg };
  }

  // ════════════════════════════════════════════
  //  3. 正式闭环报送（管理者手动触发 → 发到群）
  //     经过人工审核确认的当日总结
  // ════════════════════════════════════════════

  generateFormalReport(taskData, managerNotes = '') {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const totalPending = summary.totalTasks - summary.completedTasks;
    const completionRate = summary.totalTasks > 0
      ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    let msg = `## 📋 ${dateStr} ${weekday} · 当日工作总结\n\n`;

    // 全局数据
    msg += `> 完成率 **${completionRate}%** ┃ 总事项 **${summary.totalTasks}** ┃ 待办 **${totalPending}** ┃ 已完成 **${summary.completedTasks}**\n\n`;

    // 部门进展
    const deptSorted = [...departments]
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0));

    msg += `---\n\n### 📊 各部门进展\n\n`;
    for (const dept of deptSorted) {
      const pending = dept.pendingCount || 0;
      const completed = dept.completedCount || 0;
      const total = pending + completed;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
      const icon = rate >= 50 ? '🟢' : rate >= 20 ? '🟡' : '🔴';
      msg += `> ${icon} **${this._shortDept(dept.department)}** ${rate}% ┃ ${pending}待办 ${completed}完成\n\n`;
    }

    // 异常概况
    const alerts = this._collectAlerts(departments, today);
    if (alerts.length > 0) {
      msg += `---\n\n### ⚠️ 需关注事项（${alerts.length}项）\n\n`;
      for (const a of alerts.slice(0, 8)) {
        msg += `> ${a.icon} ${a.dept} · ${this._truncate(a.title, 18)} → ${a.owner}\n\n`;
      }
      if (alerts.length > 8) msg += `> ...还有${alerts.length - 8}项\n\n`;
    }

    // 管理者备注
    if (managerNotes) {
      msg += `---\n\n### 💬 管理者备注\n\n`;
      msg += `> ${managerNotes}\n\n`;
    }

    msg += `---\n\n*${today.format('HH:mm')} 发布*`;
    return { title: `${dateStr} 工作总结`, text: msg };
  }

  // ════════════════════════════════════════════
  //  4. 催办消息（@指定人员）
  // ════════════════════════════════════════════

  generateReminder(taskData, deptName) {
    const today = dayjs();
    const dept = taskData.departments.find(d =>
      d.department.includes(deptName) || this._shortDept(d.department) === deptName
    );
    if (!dept) return null;

    const issues = (dept.tasks || []).filter(t => {
      if (t.isCompleted) return false;
      if (t.statusKey === 'blocked') return true;
      if (t.deadline && dayjs(t.deadline).isBefore(today, 'day')) return true;
      return false;
    });

    if (issues.length === 0) return null;

    let msg = `## 📌 事项跟进提醒\n\n`;
    msg += `**${this._shortDept(dept.department)}** 有 ${issues.length} 项待处理：\n\n`;

    for (const t of issues.slice(0, 5)) {
      const owner = t.owner || dept.owner || '';
      if (t.statusKey === 'blocked') {
        msg += `> 🚫 **${this._truncate(t.title, 25)}** → ${owner}\n> 当前阻塞，请回复处理方案\n\n`;
      } else {
        const days = today.diff(dayjs(t.deadline), 'day');
        msg += `> ⏰ **${this._truncate(t.title, 25)}** → ${owner}\n> 已逾期${days}天，请回复预计完成时间\n\n`;
      }
    }

    msg += `---\n\n请相关负责人回复处理进展 ⬇️`;

    return {
      title: `催办·${this._shortDept(dept.department)}`,
      text: msg,
      atUserIds: [dept.owner].filter(Boolean),
    };
  }

  // ════════════════════════════════════════════
  //  周五回顾（替代当日总结）
  // ════════════════════════════════════════════

  generateWeeklyReview(taskData) {
    const today = dayjs();
    const weekStart = today.subtract(4, 'day').format('M/D');
    const weekEnd = today.format('M/D');
    const { summary, departments } = taskData;

    let msg = `## 📅 本周回顾 ${weekStart}-${weekEnd}\n\n`;

    msg += `> 总事项 **${summary.totalTasks}** ┃ 待办 **${summary.totalTasks - summary.completedTasks}** ┃ 已完成 **${summary.completedTasks}**\n\n`;

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
      msg += `> ${medal} **${d.name}** **${d.rate}%** (${d.completed}/${d.completed + d.pending})\n\n`;
    }

    // 待推动事项
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
