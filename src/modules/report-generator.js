/**
 * 报告生成器
 * 负责：生成领导看板、周报、趋势分析
 * 这个模块的输出是给领导看的，体现AI赋能工作效率
 */
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');

class ReportGenerator {
  constructor() {
    this.client = new Anthropic({ apiKey: config.ai.apiKey });
    this.dataDir = config.server.dataDir;
  }

  /**
   * 生成领导日报看板（Markdown格式，可直接发钉钉群）
   */
  async generateDailyDashboard(taskData, analysisResult) {
    const today = dayjs().format('YYYY年MM月DD日');
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][dayjs().day()];

    let report = `# 📊 部门工作进度看板\n`;
    report += `**${today} 星期${weekday}** | AI智能生成\n\n`;

    // 1. 整体概况
    report += `## 一、整体概况\n\n`;
    report += `| 📈 指标 | 数值 | 状态 |\n|--------|------|------|\n`;
    report += `| 跟踪部门 | ${taskData.departments.length} | ✅ |\n`;
    report += `| 总任务数 | ${taskData.summary.totalTasks} | - |\n`;
    report += `| 已完成 | ${taskData.summary.completedTasks} | 🟢 |\n`;
    report += `| 进行中 | ${taskData.summary.totalTasks - taskData.summary.completedTasks - taskData.summary.overdueTasks} | 🔵 |\n`;
    report += `| 逾期 | ${taskData.summary.overdueTasks} | ${taskData.summary.overdueTasks > 0 ? '🔴' : '🟢'} |\n`;
    report += `| 阻塞 | ${taskData.summary.blockedTasks} | ${taskData.summary.blockedTasks > 0 ? '🟠' : '🟢'} |\n`;
    const completionRate = taskData.summary.totalTasks > 0
      ? Math.round((taskData.summary.completedTasks / taskData.summary.totalTasks) * 100)
      : 0;
    report += `| **完成率** | **${completionRate}%** | ${completionRate >= 80 ? '🟢' : completionRate >= 50 ? '🟡' : '🔴'} |\n\n`;

    // 2. AI风险评估
    report += `## 二、AI风险评估\n\n`;
    report += `> 🤖 **AI总体判断**: ${analysisResult.overallStatus || '暂无分析'}\n`;
    report += `> **风险等级**: ${this._riskBadge(analysisResult.overallRiskLevel)}\n\n`;

    if (analysisResult.risks && analysisResult.risks.length > 0) {
      report += `| 风险等级 | 部门 | 事项 | 原因 | 建议 |\n|---------|------|------|------|------|\n`;
      for (const risk of analysisResult.risks) {
        report += `| ${this._riskBadge(risk.riskLevel)} | ${risk.department} | ${risk.task} | ${risk.reason} | ${risk.suggestion} |\n`;
      }
      report += '\n';
    } else {
      report += `✅ 当前无显著风险事项\n\n`;
    }

    // 3. 需要关注的预警
    if (analysisResult.alertsForManager && analysisResult.alertsForManager.length > 0) {
      report += `## 三、⚠️ 需要您关注\n\n`;
      for (const alert of analysisResult.alertsForManager) {
        report += `### ${alert.level === 'critical' ? '🔴' : '🟠'} ${alert.title}\n`;
        report += `- **详情**: ${alert.detail}\n`;
        report += `- **建议**: ${alert.suggestedAction}\n\n`;
      }
    }

    // 4. 各部门详情
    report += `## ${analysisResult.alertsForManager?.length > 0 ? '四' : '三'}、各部门详情\n\n`;
    for (const dept of taskData.departments) {
      const deptCompleted = dept.tasks.filter(t => t.progress >= 100).length;
      report += `### ${dept.department}（${dept.owner}）${deptCompleted}/${dept.tasks.length}完成\n\n`;

      for (const task of dept.tasks) {
        const statusIcon = task.progress >= 100 ? '✅' : task.isOverdue ? '⏰' : task.isBlocked ? '🚫' : '🔵';
        report += `${statusIcon} **${task.name}**\n`;
        report += `   - 进度: ${this._progressBar(task.progress)} ${task.progress}%\n`;
        if (task.deadline) report += `   - 截止: ${task.deadline}\n`;
        if (task.notes) report += `   - 备注: ${task.notes}\n`;
        report += '\n';
      }
    }

    // 5. AI效能标识
    report += `---\n\n`;
    report += `> 🤖 **本报告由AI智能任务跟踪系统自动生成**\n`;
    report += `> 系统通过自动抓取各部门在线文档更新，利用AI进行风险分析和进度评估\n`;
    report += `> 已实现: 自动催办 → 智能分析 → 风险预警 → 报告生成 全流程自动化\n`;
    report += `> 生成时间: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n`;

    return report;
  }

  /**
   * 生成周度趋势报告
   */
  async generateWeeklyReport(weekData) {
    try {
      const prompt = `以下是本周各天的任务跟踪数据，请生成一份周度趋势分析报告：

${JSON.stringify(weekData, null, 2)}

请生成Markdown格式的周报，包含：
1. 本周整体进展概述
2. 各部门表现排名
3. 本周新增/完成/逾期任务统计
4. 持续存在的风险事项
5. 下周需要关注的重点
6. 效率提升建议

在报告末尾标注"🤖 AI智能分析生成"`;

      const response = await this.client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      return response.content[0].text;
    } catch (err) {
      logger.error(`周报生成失败: ${err.message}`);
      return '周报生成失败，请检查AI服务配置';
    }
  }

  _riskBadge(level) {
    const badges = { critical: '🔴严重', high: '🟠高', medium: '🟡中', low: '🟢低' };
    return badges[level] || '⚪未知';
  }

  _progressBar(progress) {
    const filled = Math.round(progress / 10);
    return '▓'.repeat(filled) + '░'.repeat(10 - filled);
  }

  /**
   * 保存每日快照（用于趋势分析）
   */
  saveSnapshot(taskData, analysisResult) {
    const snapshotDir = path.join(this.dataDir, 'snapshots');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const filename = `snapshot-${dayjs().format('YYYY-MM-DD')}.json`;
    const snapshot = {
      date: dayjs().format('YYYY-MM-DD'),
      taskData,
      analysisResult,
    };

    fs.writeFileSync(path.join(snapshotDir, filename), JSON.stringify(snapshot, null, 2));
    logger.info(`快照已保存: ${filename}`);
  }

  /**
   * 读取近N天的快照数据
   */
  loadRecentSnapshots(days = 7) {
    const snapshotDir = path.join(this.dataDir, 'snapshots');
    if (!fs.existsSync(snapshotDir)) return [];

    const snapshots = [];
    for (let i = 0; i < days; i++) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const filepath = path.join(snapshotDir, `snapshot-${date}.json`);
      if (fs.existsSync(filepath)) {
        snapshots.push(JSON.parse(fs.readFileSync(filepath, 'utf8')));
      }
    }
    return snapshots.reverse();
  }
}

module.exports = new ReportGenerator();
