/**
 * 报告生成器（v2 - 适配状态词体系）
 * 负责：生成领导看板、周报、趋势分析
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
    const summary = taskData.summary;

    let report = `# 📊 部门工作进度看板\n`;
    report += `**${today} 星期${weekday}** | AI智能生成\n\n`;

    // 1. 整体概况
    report += `## 一、整体概况\n\n`;
    report += `| 📈 指标 | 数值 | 状态 |\n|--------|------|------|\n`;
    report += `| 跟踪部门 | ${taskData.departments.length} | ✅ |\n`;
    report += `| 总任务数 | ${summary.totalTasks} | - |\n`;
    report += `| 已完成 | ${summary.completedTasks} | 🟢 |\n`;
    report += `| 推进中 | ${summary.inProgressTasks || 0} | 🔵 |\n`;
    report += `| 催办中 | ${summary.pendingResponseTasks || 0} | 🟡 |\n`;
    report += `| 待启动 | ${summary.notStartedTasks || 0} | ⚪ |\n`;
    report += `| 暂缓 | ${summary.onHoldTasks || 0} | ⏸️ |\n`;
    report += `| 阻塞 | ${summary.blockedTasks} | ${summary.blockedTasks > 0 ? '🔴' : '🟢'} |\n\n`;

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
    const sectionNum = analysisResult.alertsForManager?.length > 0 ? '四' : '三';
    report += `## ${sectionNum}、各部门详情\n\n`;
    for (const dept of taskData.departments) {
      const pendingCount = dept.pendingCount || dept.tasks.filter(t => t.statusKey !== 'completed').length;
      const completedCount = dept.completedCount || dept.tasks.filter(t => t.statusKey === 'completed').length;
      report += `### ${dept.department}${dept.owner ? `（${dept.owner}）` : ''} 待办${pendingCount} / 已完成${completedCount}\n\n`;

      // 按子板块分组展示待办任务
      const pendingTasks = dept.tasks.filter(t => !t.isCompleted);
      const completedTasks = dept.tasks.filter(t => t.isCompleted);

      if (pendingTasks.length > 0) {
        let currentSubSection = '';
        for (const task of pendingTasks) {
          if (task.subSection && task.subSection !== currentSubSection) {
            currentSubSection = task.subSection;
            report += `**${currentSubSection}**\n\n`;
          }
          const statusIcon = this._statusIcon(task.statusKey);
          report += `${statusIcon} **${task.title}**\n`;
          report += `   - 状态: ${task.status}`;
          if (task.owner) report += ` | 负责人: ${task.owner}`;
          if (task.owners && task.owners.length > 1) report += `（协同: ${task.owners.slice(1).join(', ')}）`;
          report += '\n';
          if (task.deadline) report += `   - 截止: ${task.deadline}\n`;
          if (task.notes) report += `   - 备注: ${task.notes}\n`;
          report += '\n';
        }
      }

      if (completedTasks.length > 0) {
        report += `✅ **已完成** (${completedTasks.length}项): ${completedTasks.map(t => t.title).join('、')}\n\n`;
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
   * 生成去重报告（如果发现了重复任务）
   */
  generateDeduplicationReport(duplicates) {
    if (!duplicates || duplicates.length === 0) return null;

    let report = `### 🔄 重复任务检测报告\n\n`;
    report += `AI发现以下 **${duplicates.length}组** 疑似重复/同类任务：\n\n`;

    for (let i = 0; i < duplicates.length; i++) {
      const group = duplicates[i];
      report += `**第${i + 1}组**: ${group.reason}\n`;
      report += `- 涉及任务编号: ${group.tasks.join(', ')}\n`;
      report += `- 建议合并为: 「${group.suggestedTitle}」\n\n`;
    }

    report += `> 💡 以上为AI建议，请人工确认后在文档中合并\n`;
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
3. 本周新增/完成/阻塞任务统计
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

  _riskBadge(level) {
    const badges = { critical: '🔴严重', high: '🟠高', medium: '🟡中', low: '🟢低' };
    return badges[level] || '⚪未知';
  }

  /**
   * 保存每日快照
   */
  saveSnapshot(taskData, analysisResult) {
    const snapshotDir = path.join(this.dataDir, 'snapshots');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const filename = `snapshot-${dayjs().format('YYYY-MM-DD')}.json`;
    const snapshot = { date: dayjs().format('YYYY-MM-DD'), taskData, analysisResult };
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
