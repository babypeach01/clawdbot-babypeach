/**
 * 消息模板引擎（v10 - 晚间一次推送）
 *
 * 每天就一次推送（晚上19:00），图片+简短文字，直接看完，不需要点击
 */
const dayjs = require('dayjs');

class MessageTemplates {

  /**
   * 晚间日报（唯一的每日推送）
   * 表格图片 + 简短文字摘要
   * chartUrl 是总览表格图片的OSS地址
   */
  generateDailyReport(taskData, chartUrl = '', extraNotes = '') {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    // 统计今日到期、逾期、阻塞
    let dueToday = 0, overdue = 0, blocked = 0;
    for (const dept of departments) {
      for (const t of dept.tasks || []) {
        if (t.isCompleted) continue;
        if (t.deadline && dayjs(t.deadline).isSame(today, 'day')) dueToday++;
        if (t.deadline && dayjs(t.deadline).isBefore(today, 'day')) overdue++;
        if (t.statusKey === 'blocked') blocked++;
      }
    }

    let msg = '';

    // 图片（表格图）
    if (chartUrl) {
      msg += `![${dateStr}总览](${chartUrl})\n\n`;
    }

    msg += `## ${dateStr} ${weekday} · 当日小结\n\n`;
    msg += `> 共 **${summary.totalTasks}** 项 ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${summary.totalTasks - summary.completedTasks}** ┃ 达成率 **${rate}%**\n\n`;

    // 异常提醒（只在有异常时展示）
    const alerts = [];
    if (dueToday > 0) alerts.push(`今日到期 **${dueToday}** 项`);
    if (overdue > 0) alerts.push(`逾期 **${overdue}** 项`);
    if (blocked > 0) alerts.push(`阻塞 **${blocked}** 项`);
    if (alerts.length > 0) {
      msg += `> ⚠️ ${alerts.join(' ┃ ')}\n\n`;
    }

    // 额外备注
    if (extraNotes) {
      msg += `---\n\n> 📝 **重点**：${extraNotes}\n\n`;
    }

    msg += `*${today.format('HH:mm')} 自动生成*`;

    return { title: `${dateStr} 当日小结`, text: msg };
  }

  /**
   * 周五回顾
   */
  generateWeeklyReview(taskData) {
    const today = dayjs();
    const weekStart = today.subtract(4, 'day').format('M/D');
    const weekEnd = today.format('M/D');
    const { summary, departments } = taskData;

    let msg = `## 本周回顾 ${weekStart}-${weekEnd}\n\n`;
    msg += `> 总 **${summary.totalTasks}** ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${summary.totalTasks - summary.completedTasks}**\n\n`;
    msg += `---\n\n`;

    const depts = departments
      .map(d => ({ name: this._shortDept(d.department), rate: this._deptRate(d), done: d.completedCount || 0, total: (d.pendingCount || 0) + (d.completedCount || 0) }))
      .filter(d => d.total > 0)
      .sort((a, b) => b.rate - a.rate);

    for (let i = 0; i < depts.length; i++) {
      const d = depts[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '　';
      msg += `> ${medal} **${d.name}** ${d.rate}%（${d.done}/${d.total}）\n\n`;
    }

    msg += `*${today.format('HH:mm')} 自动生成*`;
    return { title: `本周回顾 ${weekStart}-${weekEnd}`, text: msg };
  }

  // 兼容旧接口
  generateDailySummary(taskData, url) { return this.generateDailyReport(taskData, url); }
  generateEveningSummary(taskData, url, notes) { return this.generateDailyReport(taskData, url, notes); }
  generateMorningSummary(taskData, url) { return this.generateDailyReport(taskData, url); }

  _deptRate(d) {
    const total = (d.pendingCount || 0) + (d.completedCount || 0);
    return total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
  }
  _shortDept(name) { if (!name) return '未分类'; return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8); }
}

module.exports = new MessageTemplates();
