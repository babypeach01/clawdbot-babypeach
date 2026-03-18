/**
 * 催办引擎
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
   * @param {Object} analysisResult - AI分析结果
   * @param {Object} taskData - 结构化任务数据
   */
  async sendDailyReminders(analysisResult, taskData) {
    // 1. 发送每日整体进度简报
    await this._sendDailySummary(analysisResult, taskData);

    // 2. 对各部门发送个性化催办
    if (analysisResult.reminders) {
      for (const reminder of analysisResult.reminders) {
        await this._sendDepartmentReminder(reminder);
      }
    }

    // 3. 记录催办历史
    this._saveReminderLog('daily', analysisResult);
  }

  /**
   * 发送每日整体进度简报
   */
  async _sendDailySummary(analysisResult, taskData) {
    const today = dayjs().format('YYYY-MM-DD');
    const summary = taskData.summary;

    let markdown = `### 📊 每日任务进度简报（${today}）\n\n`;
    markdown += `> **AI分析结论**: ${analysisResult.overallStatus || '暂无'}\n\n`;
    markdown += `| 指标 | 数值 |\n|------|------|\n`;
    markdown += `| 总任务数 | ${summary.totalTasks} |\n`;
    markdown += `| 已完成 | ${summary.completedTasks} |\n`;
    markdown += `| 逾期 | ${summary.overdueTasks} |\n`;
    markdown += `| 阻塞 | ${summary.blockedTasks} |\n\n`;

    // 风险摘要
    if (analysisResult.risks && analysisResult.risks.length > 0) {
      markdown += `### ⚠️ 风险事项\n\n`;
      for (const risk of analysisResult.risks) {
        const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[risk.riskLevel] || '⚪';
        markdown += `${icon} **${risk.department}** - ${risk.task}: ${risk.reason}\n\n`;
      }
    }

    // 各部门进度
    markdown += `### 📋 各部门进度\n\n`;
    for (const dept of taskData.departments) {
      const completedCount = dept.tasks.filter(t => t.progress >= 100).length;
      const totalCount = dept.tasks.length;
      markdown += `**${dept.department}**（${dept.owner}）: ${completedCount}/${totalCount} 完成\n\n`;
      for (const task of dept.tasks) {
        const bar = this._progressBar(task.progress);
        const flag = task.isOverdue ? ' ⏰逾期' : task.isBlocked ? ' 🚫阻塞' : '';
        markdown += `- ${task.name} ${bar} ${task.progress}%${flag}\n`;
      }
      markdown += '\n';
    }

    markdown += `\n---\n*🤖 AI助手自动生成 | ${dayjs().format('HH:mm')}*`;

    await dingtalk.sendRobotMessage('每日任务进度简报', markdown);
  }

  /**
   * 生成文本进度条
   */
  _progressBar(progress) {
    const filled = Math.round(progress / 10);
    return '▓'.repeat(filled) + '░'.repeat(10 - filled);
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
   * 这是关键功能：当AI判断某些情况需要管理者介入时触发
   */
  async sendManagerAlert(alertsForManager) {
    if (!alertsForManager || alertsForManager.length === 0) return;

    const levelPriority = { critical: 4, high: 3, medium: 2, low: 1 };
    const thresholdValue = levelPriority[config.alert.threshold] || 2;

    // 过滤出达到预警阈值的事项
    const filteredAlerts = alertsForManager.filter(
      a => (levelPriority[a.level] || 0) >= thresholdValue
    );

    if (filteredAlerts.length === 0) return;

    // 构建预警消息
    let markdown = `### 🚨 人工干预预警\n\n`;
    markdown += `> 以下事项经AI评估后，建议您进行人工了解和干预：\n\n`;

    for (const alert of filteredAlerts) {
      const icon = alert.level === 'critical' ? '🔴' : '🟠';
      markdown += `${icon} **${alert.title}**\n\n`;
      markdown += `- 详情: ${alert.detail}\n`;
      markdown += `- 建议: ${alert.suggestedAction}\n\n`;
    }

    markdown += `---\n*🤖 AI智能预警系统 | ${dayjs().format('YYYY-MM-DD HH:mm')}*\n`;
    markdown += `*系统已根据任务进度、截止时间和反馈内容自动评估风险等级*`;

    // 同时发送到群和单独通知管理者
    await dingtalk.sendActionCard(
      '⚠️ 需要您关注的任务预警',
      markdown,
      '查看详情',
      ''
    );

    // 通过工作通知单独提醒管理者
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
   * 发送未更新提醒
   * 检测哪些部门超过N天未更新文档
   */
  async sendStaleUpdateAlerts(taskData) {
    const threshold = config.reminder.overdueDaysThreshold;
    const staleNotices = [];

    for (const dept of taskData.departments) {
      if (dept.lastUpdated) {
        const daysSinceUpdate = dayjs().diff(dayjs(dept.lastUpdated), 'day');
        if (daysSinceUpdate >= threshold) {
          staleNotices.push({
            department: dept.department,
            owner: dept.owner,
            daysSinceUpdate,
          });
        }
      }
    }

    if (staleNotices.length === 0) return;

    let markdown = `### ⏰ 文档更新提醒\n\n`;
    markdown += `以下部门已超过 **${threshold}天** 未更新进度：\n\n`;

    for (const notice of staleNotices) {
      markdown += `- **${notice.department}**（@${notice.owner}）: 已${notice.daysSinceUpdate}天未更新\n`;
    }

    markdown += `\n> 请及时在文档中更新您负责事项的最新进展，谢谢！\n`;
    markdown += `\n---\n*🤖 AI助手自动提醒*`;

    await dingtalk.sendRobotMessage('文档更新提醒', markdown);
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
