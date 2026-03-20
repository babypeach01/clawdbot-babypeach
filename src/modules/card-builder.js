/**
 * 互动卡片数据构建器
 *
 * 从任务数据生成钉钉互动卡片的 cardParamMap
 * 生成的 JSON 可以手动编辑后再发送
 */
const dayjs = require('dayjs');

class CardBuilder {

  /**
   * 构建当日总览卡片数据
   * 返回的 cardParamMap 对应钉钉卡片模板中的变量
   */
  buildDailySummary(taskData) {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];
    const { summary, departments } = taskData;
    const rate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    // 各部门数据
    const deptRows = [];
    let totalDueToday = 0, totalOverdue = 0, totalBlocked = 0;

    for (const dept of departments) {
      const tasks = dept.tasks || [];
      const total = (dept.pendingCount || 0) + (dept.completedCount || 0);
      if (total === 0) continue;

      const done = dept.completedCount || 0;
      const pending = dept.pendingCount || 0;
      const dueToday = tasks.filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isSame(today, 'day')).length;
      const overdue = tasks.filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isBefore(today, 'day')).length;
      const blocked = tasks.filter(t => !t.isCompleted && t.statusKey === 'blocked').length;
      const deptRate = total > 0 ? Math.round((done / total) * 100) : 0;

      totalDueToday += dueToday;
      totalOverdue += overdue;
      totalBlocked += blocked;

      // 部门事项明细
      const taskDetails = tasks
        .filter(t => !t.isCompleted)
        .map(t => {
          let detail = t.title;
          if (t.statusKey === 'blocked') detail += ' [阻塞]';
          else if (t.status && t.status !== '推进中') detail += ` [${t.status}]`;
          if (t.deadline) {
            const dl = dayjs(t.deadline);
            if (dl.isBefore(today, 'day')) detail += ` ⚠截止${dl.format('M/D')}(逾期)`;
            else if (dl.isSame(today, 'day')) detail += ' ⚠截止今日';
            else detail += ` 截止${dl.format('M/D')}`;
          }
          return detail;
        });

      deptRows.push({
        name: this._shortDept(dept.department),
        total,
        pending,
        done,
        dueToday,
        overdue,
        blocked,
        rate: deptRate,
        tasks: taskDetails,
      });
    }

    // 按异常数量降序
    deptRows.sort((a, b) => (b.overdue + b.blocked + b.dueToday) - (a.overdue + a.blocked + a.dueToday));

    // 构建 cardParamMap — 模板变量
    const cardParamMap = {
      // 头部信息
      title: `${dateStr} ${weekday} · 当日工作总览`,
      date: dateStr,
      weekday,
      totalCount: String(summary.totalTasks),
      doneCount: String(summary.completedTasks),
      pendingCount: String(summary.totalTasks - summary.completedTasks),
      rate: `${rate}%`,

      // 异常汇总
      dueTodayCount: String(totalDueToday),
      overdueCount: String(totalOverdue),
      blockedCount: String(totalBlocked),
      hasAlert: (totalDueToday + totalOverdue + totalBlocked) > 0 ? 'true' : 'false',
      alertText: this._buildAlertText(totalDueToday, totalOverdue, totalBlocked),

      // 部门列表（JSON字符串，模板中循环渲染）
      deptList: JSON.stringify(deptRows),

      // Markdown格式的部门明细（用于模板中直接展示）
      deptMarkdown: this._buildDeptMarkdown(deptRows),

      // 时间戳
      updateTime: today.format('HH:mm'),
    };

    return cardParamMap;
  }

  /**
   * 构建Markdown格式的部门明细
   * 钉钉互动卡片支持在markdown字段中渲染
   */
  _buildDeptMarkdown(deptRows) {
    let md = '';
    for (const dept of deptRows) {
      // 部门标题
      md += `**${dept.name}**　总${dept.total} 待办${dept.pending} 完成${dept.done}`;
      if (dept.rate > 0) md += ` 达成${dept.rate}%`;
      md += '\n';

      // 异常标记
      const alerts = [];
      if (dept.dueToday > 0) alerts.push(`今日到期${dept.dueToday}`);
      if (dept.overdue > 0) alerts.push(`逾期${dept.overdue}`);
      if (dept.blocked > 0) alerts.push(`阻塞${dept.blocked}`);
      if (alerts.length > 0) {
        md += `⚠ ${alerts.join(' / ')}\n`;
      }

      // 事项列表
      for (const task of dept.tasks) {
        md += `- ${task}\n`;
      }
      md += '\n';
    }
    return md.trim();
  }

  _buildAlertText(dueToday, overdue, blocked) {
    const parts = [];
    if (dueToday > 0) parts.push(`今日到期${dueToday}项`);
    if (overdue > 0) parts.push(`逾期${overdue}项`);
    if (blocked > 0) parts.push(`阻塞${blocked}项`);
    return parts.join(' / ') || '无异常';
  }

  _shortDept(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8);
  }
}

module.exports = new CardBuilder();
