/**
 * 消息模板引擎（v3 - 图表为主，文字精简）
 *
 * 4种消息类型：
 * 1. morningBrief  - 晨报焦点（半屏，只看异常）
 * 2. dashboard     - 部门看板（一屏图表）
 * 3. urgentAlert   - 单项催办（独立消息，5行以内）
 * 4. weeklyReview  - 周五回顾
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
   *  部门看板 - 图表为主（一屏，5秒扫完）
   * ═══════════════════════════════════════
   */
  generateDashboard(taskData, changes) {
    const today = dayjs();
    const dateStr = today.format('M/D');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];

    let msg = `## 📊 ${dateStr} ${weekday} · 部门工作看板\n\n`;

    // 部门表格 - 图表化
    msg += `| 部门 | 待办 | 工作量 | 关注 |\n`;
    msg += `|:-----|:----:|:-------|:----:|\n`;

    const maxTasks = Math.max(...taskData.departments.map(d => d.pendingCount || 0), 1);

    for (const dept of taskData.departments) {
      if (dept.pendingCount === 0 && dept.completedCount === 0) continue;

      const name = this._shortDept(dept.department);
      const pending = dept.pendingCount || 0;
      const barLen = Math.max(1, Math.round(pending / maxTasks * 10));
      const bar = '▓'.repeat(barLen) + '░'.repeat(10 - barLen);

      // 统计异常
      const blockedCount = dept.tasks.filter(t => t.statusKey === 'blocked').length;
      const urgentCount = dept.tasks.filter(t => t.statusKey === 'pending_response').length;
      const overdueCount = dept.tasks.filter(t => {
        if (t.isCompleted || !t.deadline) return false;
        return dayjs(t.deadline).isBefore(today, 'day');
      }).length;

      let attention = '';
      if (blockedCount > 0 || overdueCount > 0) attention += `🔴${blockedCount + overdueCount}`;
      else if (urgentCount > 0) attention += `🟡${urgentCount}`;
      else attention = '✅';

      msg += `| ${name} | ${pending} | ${bar} | ${attention} |\n`;
    }

    msg += `\n`;

    // 图例
    msg += `> ✅正常 · 🟡催办中 · 🔴阻塞/逾期\n\n`;

    // 今日动态
    if (changes && changes.length > 0) {
      const completed = changes.filter(c => c.to === '已完成').length;
      const newTasks = changes.filter(c => c.type === 'new_task').length;
      const unblocked = changes.filter(c => c.from === '阻塞' && c.to !== '阻塞').length;
      msg += `**今日动态** +${completed}完成 · +${newTasks}新增 · ${unblocked}解除阻塞\n`;
    }

    msg += `\n---\n\n*🤖 ${today.format('HH:mm')} 自动生成*`;

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
  generateWeeklyReview(taskData, weekSnapshots) {
    const today = dayjs();
    const weekStart = today.subtract(4, 'day').format('M/D');
    const weekEnd = today.format('M/D');

    let msg = `## 📅 本周回顾 ${weekStart}-${weekEnd}\n\n`;

    // 本周成果（如果有快照对比）
    if (weekSnapshots && weekSnapshots.length >= 2) {
      const first = weekSnapshots[0];
      const last = weekSnapshots[weekSnapshots.length - 1];
      const firstTotal = first.taskData?.summary?.totalTasks || 0;
      const lastTotal = last.taskData?.summary?.totalTasks || 0;
      const firstCompleted = first.taskData?.summary?.completedTasks || 0;
      const lastCompleted = last.taskData?.summary?.completedTasks || 0;

      const newCompleted = lastCompleted - firstCompleted;
      const newTasks = lastTotal - firstTotal;

      msg += `**本周成果**\n\n`;
      msg += `✅ 新增完成 ${Math.max(0, newCompleted)}项`;
      if (newTasks > 0) msg += ` | 🆕 新增任务 ${newTasks}项`;
      msg += `\n\n`;
    }

    // 部门活跃度（用星星表示）
    msg += `**部门工作量**\n\n`;
    const sorted = [...taskData.departments]
      .filter(d => d.pendingCount > 0)
      .sort((a, b) => b.pendingCount - a.pendingCount);

    for (const dept of sorted) {
      const stars = '⭐'.repeat(Math.min(Math.ceil(dept.pendingCount / 10), 5));
      msg += `${this._shortDept(dept.department)} ${stars} ${dept.pendingCount}项\n\n`;
    }

    // 持续未动项（blocked / 催办中）
    const stuckItems = [];
    for (const dept of taskData.departments) {
      for (const t of dept.tasks) {
        if (t.isCompleted) continue;
        if (t.statusKey === 'blocked' || t.statusKey === 'pending_response') {
          stuckItems.push({
            title: this._truncate(t.title, 25),
            owner: t.owner || dept.owner,
            status: t.status,
          });
        }
      }
    }

    if (stuckItems.length > 0) {
      msg += `**⚠️ 待推动事项**\n\n`;
      for (const item of stuckItems.slice(0, 8)) {
        msg += `· ${item.title} → ${item.owner}（${item.status}）\n\n`;
      }
      if (stuckItems.length > 8) msg += `· ...还有${stuckItems.length - 8}项\n\n`;
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
