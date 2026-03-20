/**
 * 消息模板引擎（v11 - 纯文字列表，支持手动编辑）
 *
 * 生成钉钉 Markdown 格式的文字报告，不用图片。
 * 支持两步流程：generate → 手动编辑 → send
 */
const dayjs = require('dayjs');

class MessageTemplates {

  /**
   * 生成当日小结的 Markdown 文本
   * 纯文字，钉钉里直接看，不需要点击/下载
   */
  generateDailyReport(taskData, extraNotes = '') {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    // 准备各部门数据
    const depts = departments
      .filter(d => ((d.pendingCount || 0) + (d.completedCount || 0)) > 0)
      .sort((a, b) => {
        // 有异常的排前面
        const aAlert = this._deptAlerts(a, today);
        const bAlert = this._deptAlerts(b, today);
        return bAlert - aAlert;
      });

    // 全局异常统计
    let totalDueToday = 0, totalOverdue = 0, totalBlocked = 0;
    for (const dept of departments) {
      for (const t of dept.tasks || []) {
        if (t.isCompleted) continue;
        if (t.deadline && dayjs(t.deadline).isSame(today, 'day')) totalDueToday++;
        if (t.deadline && dayjs(t.deadline).isBefore(today, 'day')) totalOverdue++;
        if (t.statusKey === 'blocked') totalBlocked++;
      }
    }

    let msg = '';

    // 标题
    msg += `## ${dateStr} ${weekday} · 当日工作总览\n\n`;

    // 全局概览
    msg += `> 共 **${summary.totalTasks}** 项 ┃ 完成 **${summary.completedTasks}** ┃ 待办 **${summary.totalTasks - summary.completedTasks}** ┃ 达成率 **${rate}%**\n\n`;

    // 异常汇总
    const alerts = [];
    if (totalDueToday > 0) alerts.push(`今日到期 **${totalDueToday}**`);
    if (totalOverdue > 0) alerts.push(`逾期 **${totalOverdue}**`);
    if (totalBlocked > 0) alerts.push(`阻塞 **${totalBlocked}**`);
    if (alerts.length > 0) {
      msg += `> ⚠ ${alerts.join(' ┃ ')}\n\n`;
    }

    msg += `---\n\n`;

    // 各部门明细
    for (const dept of depts) {
      const tasks = dept.tasks || [];
      const total = (dept.pendingCount || 0) + (dept.completedCount || 0);
      const done = dept.completedCount || 0;
      const pending = dept.pendingCount || 0;
      const dueToday = tasks.filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isSame(today, 'day')).length;
      const overdue = tasks.filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isBefore(today, 'day')).length;
      const blocked = tasks.filter(t => !t.isCompleted && t.statusKey === 'blocked').length;
      const deptRate = this._deptRate(dept);
      const deptName = this._shortDept(dept.department);

      // 部门标题行：部门名 + 核心数字
      let line = `### ${deptName}`;
      line += `　总${total} 待办${pending} 完成${done}`;
      if (deptRate > 0) line += ` 达成${deptRate}%`;
      msg += line + '\n\n';

      // 异常标记
      const deptAlerts = [];
      if (dueToday > 0) deptAlerts.push(`今日到期${dueToday}项`);
      if (overdue > 0) deptAlerts.push(`逾期${overdue}项`);
      if (blocked > 0) deptAlerts.push(`阻塞${blocked}项`);
      if (deptAlerts.length > 0) {
        msg += `> ⚠ ${deptAlerts.join(' / ')}\n\n`;
      }

      // 列出待办事项（截止日期、状态）
      const pendingTasks = tasks.filter(t => !t.isCompleted);
      if (pendingTasks.length > 0) {
        for (const t of pendingTasks) {
          let item = `- ${t.title}`;
          // 状态标记
          if (t.statusKey === 'blocked') item += '　**[阻塞]**';
          else if (t.status && t.status !== '推进中') item += `　[${t.status}]`;
          // 截止日期
          if (t.deadline) {
            const dl = dayjs(t.deadline);
            const dlStr = dl.format('M/D');
            if (dl.isBefore(today, 'day')) {
              item += `　⚠截止${dlStr}(已逾期)`;
            } else if (dl.isSame(today, 'day')) {
              item += `　⚠截止今日`;
            } else {
              item += `　截止${dlStr}`;
            }
          }
          msg += item + '\n';
        }
        msg += '\n';
      }
    }

    // 额外备注
    if (extraNotes) {
      msg += `---\n\n> **重点备注**：${extraNotes}\n\n`;
    }

    msg += `---\n\n*${today.format('HH:mm')} 自动生成*`;

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

    for (const d of depts) {
      msg += `- **${d.name}** ${d.rate}%（${d.done}/${d.total}）\n`;
    }

    msg += `\n*${today.format('HH:mm')} 自动生成*`;
    return { title: `本周回顾 ${weekStart}-${weekEnd}`, text: msg };
  }

  _deptAlerts(dept, today) {
    let count = 0;
    for (const t of dept.tasks || []) {
      if (t.isCompleted) continue;
      if (t.deadline && dayjs(t.deadline).isBefore(today, 'day')) count++;
      if (t.deadline && dayjs(t.deadline).isSame(today, 'day')) count++;
      if (t.statusKey === 'blocked') count++;
    }
    return count;
  }

  _deptRate(d) {
    const total = (d.pendingCount || 0) + (d.completedCount || 0);
    return total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
  }

  _shortDept(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8);
  }
}

module.exports = new MessageTemplates();
