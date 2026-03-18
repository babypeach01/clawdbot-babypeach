/**
 * 消息模板引擎（v4 - 图表图片嵌入，文字极简）
 *
 * 4种消息类型：
 * 1. morningBrief  - 晨报焦点（半屏，只看异常）
 * 2. dashboard     - 部门看板（图片图表 + 一行摘要）
 * 3. urgentAlert   - 单项催办（独立消息，5行以内）
 * 4. weeklyReview  - 周五回顾（图表 + 精简总结）
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');
const chartGenerator = require('./chart-generator');

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

    // 收集异常事项
    const overdue = [];
    const blocked = [];
    const urgent = []; // 催办中

    for (const dept of taskData.departments) {
      for (const task of dept.tasks) {
        if (task.isCompleted) continue;

        if (task.deadline) {
          const dl = dayjs(task.deadline);
          if (dl.isBefore(today, 'day')) {
            const days = today.diff(dl, 'day');
            overdue.push({
              title: this._truncate(task.title, 25),
              owner: task.owner || dept.owner,
              dept: this._shortDept(dept.department),
              days,
            });
          }
        }

        if (task.statusKey === 'blocked') {
          blocked.push({
            title: this._truncate(task.title, 25),
            owner: task.owner || dept.owner,
            dept: this._shortDept(dept.department),
          });
        }

        if (task.statusKey === 'pending_response') {
          urgent.push({
            title: this._truncate(task.title, 25),
            owner: task.owner || dept.owner,
            dept: this._shortDept(dept.department),
          });
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
   *  部门看板 - 高清图表（异步，需 await）
   *  chartUrls 由调用方传入（已上传到 OSS）
   * ═══════════════════════════════════════
   */
  generateDashboard(taskData, chartUrls) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary } = taskData;

    let msg = `## 📊 ${dateStr} ${weekday} · 部门工作看板\n\n`;

    // 数字摘要（一行）
    const totalPending = summary.totalTasks - summary.completedTasks;
    msg += `**${totalPending}** 待办 · **${summary.completedTasks}** 已完成 · `;
    msg += `🔴 ${summary.blockedTasks}阻塞 · 🟡 ${summary.pendingResponseTasks || 0}催办\n\n`;

    // 嵌入图表图片（如果有 OSS URL）
    if (chartUrls?.deptBarUrl) msg += `![部门任务分布](${chartUrls.deptBarUrl})\n\n`;
    if (chartUrls?.healthChartUrl) msg += `![异常信号](${chartUrls.healthChartUrl})\n\n`;

    // 异常部门标记（只列有问题的，最多3个）
    const problemDepts = [];
    for (const dept of taskData.departments) {
      const blockedCount = (dept.tasks || []).filter(t => t.statusKey === 'blocked').length;
      const overdueCount = (dept.tasks || []).filter(t => {
        if (t.isCompleted || !t.deadline) return false;
        return dayjs(t.deadline).isBefore(today, 'day');
      }).length;
      if (blockedCount > 0 || overdueCount > 0) {
        problemDepts.push({ name: this._shortDept(dept.department), blocked: blockedCount, overdue: overdueCount });
      }
    }

    if (problemDepts.length > 0) {
      msg += `**⚠️ 需关注**\n\n`;
      for (const d of problemDepts.slice(0, 3)) {
        const issues = [];
        if (d.blocked > 0) issues.push(`${d.blocked}项阻塞`);
        if (d.overdue > 0) issues.push(`${d.overdue}项逾期`);
        msg += `· ${d.name}: ${issues.join('、')}\n\n`;
      }
    }

    msg += `---\n\n*🤖 AI 智能任务跟踪系统 · ${today.format('HH:mm')}*`;

    return { title: `${dateStr} 部门看板`, text: msg };
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

        // 逾期
        if (task.deadline) {
          const dl = dayjs(task.deadline);
          if (dl.isBefore(today, 'day')) {
            const days = today.diff(dl, 'day');
            reason = `⏰ 原定${dl.format('M/D')} → 已逾期${days}天`;
            icon = '🔴';
          }
        }

        // 阻塞
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

    // 按优先级排序，逾期优先
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

    let msg = `## 📅 本周回顾 ${weekStart}-${weekEnd}\n\n`;

    // 本周成果
    if (weekSnapshots && weekSnapshots.length >= 2) {
      const first = weekSnapshots[0];
      const last = weekSnapshots[weekSnapshots.length - 1];
      const newCompleted = (last.taskData?.summary?.completedTasks || 0) - (first.taskData?.summary?.completedTasks || 0);
      const newTasks = (last.taskData?.summary?.totalTasks || 0) - (first.taskData?.summary?.totalTasks || 0);
      msg += `✅ +${Math.max(0, newCompleted)}完成`;
      if (newTasks > 0) msg += ` · 🆕 +${newTasks}新增`;
      msg += `\n\n`;
    }

    // 图表
    if (chartUrls?.deptBarUrl) msg += `![部门任务分布](${chartUrls.deptBarUrl})\n\n`;
    if (chartUrls?.personLoadUrl) msg += `![个人任务负荷](${chartUrls.personLoadUrl})\n\n`;
    if (chartUrls?.statusPieUrl) msg += `![任务状态总览](${chartUrls.statusPieUrl})\n\n`;

    // 持续未动（最多5条）
    const stuckItems = [];
    for (const dept of taskData.departments) {
      for (const t of dept.tasks) {
        if (t.isCompleted) continue;
        if (t.statusKey === 'blocked' || t.statusKey === 'pending_response') {
          stuckItems.push({
            title: this._truncate(t.title, 25),
            owner: t.owner || dept.owner,
          });
        }
      }
    }

    if (stuckItems.length > 0) {
      msg += `**⚠️ 待推动 ${stuckItems.length}项**\n\n`;
      for (const item of stuckItems.slice(0, 5)) {
        msg += `· ${item.title} → ${item.owner}\n\n`;
      }
      if (stuckItems.length > 5) msg += `· ...还有${stuckItems.length - 5}项\n\n`;
    }

    msg += `---\n\n*🤖 周报自动生成 ${today.format('HH:mm')}*`;

    return { title: `本周回顾 ${weekStart}-${weekEnd}`, text: msg };
  }

  // ── 工具函数 ──

  _truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  _shortDept(name) {
    if (!name) return '未分类';
    // 去掉多余描述
    return name
      .replace(/\s+租车\/用车\/租机/, '')
      .replace(/\s+/, '')
      .slice(0, 6);
  }
}

module.exports = new MessageTemplates();
