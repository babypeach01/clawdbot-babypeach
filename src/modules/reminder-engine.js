/**
 * 催办引擎（v2 - 适配状态词体系）
 * 负责：定时催办、智能升级催办、催办记录追踪
 */
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const dingtalk = require('./dingtalk-client');
const logger = require('../utils/logger');

class ReminderEngine {
  constructor() {
    this.dataDir = config.server.dataDir;
    this._ensureDataDir();
  }

  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 发送每日催办消息到钉钉群
   */
  async sendDailyReminders(analysisResult, taskData) {
    await this._sendDailySummary(analysisResult, taskData);

    if (analysisResult.reminders) {
      for (const reminder of analysisResult.reminders) {
        await this._sendDepartmentReminder(reminder);
      }
    }

    this._saveReminderLog('daily', analysisResult);
  }

  /**
   * 发送每日整体进度简报（适配v2状态体系）
   */
  async _sendDailySummary(analysisResult, taskData) {
    const today = dayjs().format('YYYY-MM-DD');
    const summary = taskData.summary;

    let markdown = `### 📊 每日任务进度简报（${today}）\n\n`;
    markdown += `> **AI分析结论**: ${analysisResult.overallStatus || '暂无'}\n\n`;
    markdown += `| 指标 | 数值 |\n|------|------|\n`;
    markdown += `| 总任务数 | ${summary.totalTasks} |\n`;
    markdown += `| ✅ 已完成 | ${summary.completedTasks} |\n`;
    markdown += `| 🔵 推进中 | ${summary.inProgressTasks || 0} |\n`;
    markdown += `| 🟡 催办中 | ${summary.pendingResponseTasks || 0} |\n`;
    markdown += `| 🚫 阻塞 | ${summary.blockedTasks} |\n\n`;

    // 风险摘要
    if (analysisResult.risks && analysisResult.risks.length > 0) {
      markdown += `### ⚠️ 风险事项\n\n`;
      for (const risk of analysisResult.risks) {
        const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[risk.riskLevel] || '⚪';
        markdown += `${icon} **${risk.department}** - ${risk.task}: ${risk.reason}\n\n`;
      }
    }

    // 各部门进度（只展示待办任务）
    markdown += `### 📋 各部门进度\n\n`;
    for (const dept of taskData.departments) {
      const pendingCount = dept.pendingCount || dept.tasks.filter(t => !t.isCompleted).length;
      const completedCount = dept.completedCount || dept.tasks.filter(t => t.isCompleted).length;
      markdown += `**${dept.department}**${dept.owner ? `（${dept.owner}）` : ''}: 待办${pendingCount} / 已完成${completedCount}\n\n`;
      const pendingTasks = dept.tasks.filter(t => !t.isCompleted);
      for (const task of pendingTasks) {
        const icon = this._statusIcon(task.statusKey);
        const sub = task.subSection ? `[${task.subSection}] ` : '';
        markdown += `- ${icon} ${sub}${task.title} — ${task.status}`;
        if (task.owner) markdown += `（${task.owner}）`;
        markdown += '\n';
      }
      markdown += '\n';
    }

    markdown += `\n---\n*🤖 AI助手自动生成 | ${dayjs().format('HH:mm')}*`;

    await dingtalk.sendRobotMessage('每日任务进度简报', markdown);
  }

  _statusIcon(statusKey) {
    const icons = {
      completed: '✅',
      in_progress: '🔵',
      pending_response: '🟡',
      not_started: '⚪',
      on_hold: '⏸️',
      blocked: '🚫',
    };
    return icons[statusKey] || '🔵';
  }

  /**
   * 发送部门催办消息
   */
  async _sendDepartmentReminder(reminder) {
    const markdown = `### 📌 任务催办提醒\n\n`
      + `@${reminder.owner}\n\n`
      + `${reminder.message}\n\n`
      + `---\n*请在钉钉文档中更新最新进度，谢谢配合 🙏*`;

    await dingtalk.sendRobotMessage(`催办-${reminder.department}`, markdown);
  }

  /**
   * 发送人工预警通知给管理者
   */
  async sendManagerAlert(alertsForManager) {
    if (!alertsForManager || alertsForManager.length === 0) return;

    const levelPriority = { critical: 4, high: 3, medium: 2, low: 1 };
    const thresholdValue = levelPriority[config.alert.threshold] || 2;

    const filteredAlerts = alertsForManager.filter(
      a => (levelPriority[a.level] || 0) >= thresholdValue
    );

    if (filteredAlerts.length === 0) return;

    let markdown = `### 🚨 人工干预预警\n\n`;
    markdown += `> 以下事项经AI评估后，建议您进行人工了解和干预：\n\n`;

    for (const alert of filteredAlerts) {
      const icon = alert.level === 'critical' ? '🔴' : '🟠';
      markdown += `${icon} **${alert.title}**\n\n`;
      markdown += `- 详情: ${alert.detail}\n`;
      markdown += `- 建议: ${alert.suggestedAction}\n\n`;
    }

    markdown += `---\n*🤖 AI智能预警系统 | ${dayjs().format('YYYY-MM-DD HH:mm')}*\n`;
    markdown += `*系统已根据任务状态和反馈内容自动评估风险等级*`;

    await dingtalk.sendActionCard(
      '⚠️ 需要您关注的任务预警',
      markdown,
      '查看详情',
      ''
    );

    if (config.alert.adminUserId) {
      await dingtalk.sendWorkNotification(
        config.alert.adminUserId,
        '任务预警通知',
        markdown
      );
    }

    logger.info(`已发送${filteredAlerts.length}条预警通知给管理者`);
  }

  /**
   * 发送未更新提醒（基于数据快照对比）
   */
  async sendStaleUpdateAlerts(taskData) {
    // v2中不再依赖 lastUpdated 字段，改为通过快照对比判断
    // 这里保留接口兼容，实际对比逻辑在调度器中完成
  }

  /**
   * 保存催办日志
   */
  _saveReminderLog(type, data) {
    const logFile = path.join(this.dataDir, `reminder-${dayjs().format('YYYY-MM-DD')}.json`);
    const logEntry = {
      timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      type,
      data,
    };

    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    logs.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  }
}

module.exports = new ReminderEngine();
