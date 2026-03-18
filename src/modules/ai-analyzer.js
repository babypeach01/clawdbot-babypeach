/**
 * AI智能分析引擎
 * 负责：风险评估、进度分析、智能催办话术生成、异常检测
 * 使用 Claude API 进行深度分析
 */
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');

class AIAnalyzer {
  constructor() {
    this.client = new Anthropic({ apiKey: config.ai.apiKey });
  }

  /**
   * 综合分析所有部门任务，返回风险评估和建议
   * @param {Object} taskData - 解析后的结构化任务数据
   * @returns {Object} 分析结果
   */
  async analyzeAll(taskData) {
    const prompt = this._buildAnalysisPrompt(taskData);

    try {
      const response = await this.client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        system: `你是一个企业任务管理AI助手，负责分析各部门工作进度并评估风险。
你需要：
1. 识别可能存在风险的任务（延期、阻塞、进度异常等）
2. 对每个风险给出风险等级：low/medium/high/critical
3. 生成催办建议和预警信息
4. 语气专业但友善，催办要给出具体的关注点

你必须以JSON格式返回分析结果。`,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].text;
      // 提取JSON块
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysisResult = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        logger.info('AI分析完成');
        return analysisResult;
      }

      logger.warn('AI返回内容无法解析为JSON，使用原始文本');
      return { rawAnalysis: text, risks: [], suggestions: [] };
    } catch (err) {
      logger.error(`AI分析失败: ${err.message}`);
      // 降级为规则引擎分析
      return this._fallbackAnalysis(taskData);
    }
  }

  /**
   * 构建分析提示词
   */
  _buildAnalysisPrompt(taskData) {
    const today = new Date().toISOString().split('T')[0];
    let prompt = `当前日期: ${today}\n\n以下是各部门的任务进度数据，请进行风险分析：\n\n`;

    for (const dept of taskData.departments) {
      prompt += `## ${dept.department}（负责人: ${dept.owner}）\n`;
      if (dept.lastUpdated) {
        prompt += `最近更新: ${dept.lastUpdated}\n`;
      }
      for (const task of dept.tasks) {
        prompt += `- ${task.name} | 截止:${task.deadline || '未设定'} | 进度:${task.progress}%`;
        if (task.notes) prompt += ` | 备注:${task.notes}`;
        if (task.isOverdue) prompt += ' | ⚠️已逾期';
        if (task.isBlocked) prompt += ' | 🚫被阻塞';
        prompt += '\n';
      }
      prompt += '\n';
    }

    prompt += `请以如下JSON格式返回分析结果：
\`\`\`json
{
  "overallStatus": "整体状态描述（一句话）",
  "overallRiskLevel": "low|medium|high|critical",
  "risks": [
    {
      "department": "部门名",
      "task": "任务名",
      "riskLevel": "low|medium|high|critical",
      "reason": "风险原因",
      "suggestion": "建议措施"
    }
  ],
  "reminders": [
    {
      "department": "部门名",
      "owner": "负责人",
      "message": "催办消息内容（友善专业的语气）"
    }
  ],
  "alertsForManager": [
    {
      "level": "high|critical",
      "title": "预警标题",
      "detail": "需要管理者关注的详细说明",
      "suggestedAction": "建议管理者采取的行动"
    }
  ],
  "dailySummary": "今日整体进度汇总（适合发到群里的简报）"
}
\`\`\``;

    return prompt;
  }

  /**
   * 降级规则分析（当AI API不可用时的备选方案）
   */
  _fallbackAnalysis(taskData) {
    const risks = [];
    const reminders = [];
    const alertsForManager = [];

    for (const dept of taskData.departments) {
      for (const task of dept.tasks) {
        // 逾期检测
        if (task.isOverdue) {
          risks.push({
            department: dept.department,
            task: task.name,
            riskLevel: 'high',
            reason: `任务已逾期（截止日期: ${task.deadline}）`,
            suggestion: '请尽快确认延期原因和新的完成时间',
          });
        }

        // 阻塞检测
        if (task.isBlocked) {
          risks.push({
            department: dept.department,
            task: task.name,
            riskLevel: 'high',
            reason: `任务被阻塞: ${task.notes}`,
            suggestion: '需要协调相关资源解除阻塞',
          });
          alertsForManager.push({
            level: 'high',
            title: `${dept.department}「${task.name}」被阻塞`,
            detail: `负责人${dept.owner}反馈任务被阻塞: ${task.notes}`,
            suggestedAction: '建议了解阻塞原因并协调资源',
          });
        }

        // 进度异常检测（截止日临近但进度过低）
        if (task.deadline) {
          const daysLeft = Math.ceil((new Date(task.deadline) - new Date()) / 86400000);
          if (daysLeft <= 3 && task.progress < 50) {
            risks.push({
              department: dept.department,
              task: task.name,
              riskLevel: 'critical',
              reason: `距截止仅剩${daysLeft}天，但进度仅${task.progress}%`,
              suggestion: '极高风险延期，建议立即关注',
            });
          }
        }

        // 关键词风险检测
        const hitKeywords = config.reminder.riskKeywords.filter(
          kw => task.notes.includes(kw) || task.name.includes(kw)
        );
        if (hitKeywords.length > 0 && !task.isBlocked && !task.isOverdue) {
          risks.push({
            department: dept.department,
            task: task.name,
            riskLevel: 'medium',
            reason: `检测到风险关键词: ${hitKeywords.join(', ')}`,
            suggestion: '建议关注该任务最新进展',
          });
        }
      }

      // 生成催办消息
      const pendingTasks = dept.tasks.filter(t => t.progress < 100);
      if (pendingTasks.length > 0) {
        reminders.push({
          department: dept.department,
          owner: dept.owner,
          message: `${dept.owner}，请更新以下任务的最新进度：${pendingTasks.map(t => t.name).join('、')}`,
        });
      }
    }

    return {
      overallStatus: `共${taskData.summary.totalTasks}个任务，${taskData.summary.overdueTasks}个逾期，${taskData.summary.blockedTasks}个阻塞`,
      overallRiskLevel: alertsForManager.length > 0 ? 'high' : risks.length > 0 ? 'medium' : 'low',
      risks,
      reminders,
      alertsForManager,
      dailySummary: `今日跟踪${taskData.departments.length}个部门、${taskData.summary.totalTasks}个任务，其中${taskData.summary.overdueTasks}个逾期、${taskData.summary.blockedTasks}个阻塞。`,
    };
  }

  /**
   * 单独分析某个任务的反馈内容，判断是否存在风险
   */
  async analyzeFeedback(department, taskName, feedbackText) {
    try {
      const response = await this.client.messages.create({
        model: config.ai.model,
        max_tokens: 1024,
        system: '你是一个项目风险评估专家。分析任务反馈内容，判断是否存在需要管理层介入的风险。返回JSON格式。',
        messages: [{
          role: 'user',
          content: `部门: ${department}\n任务: ${taskName}\n最新反馈: ${feedbackText}\n\n请返回JSON：{"hasRisk": true/false, "riskLevel": "low/medium/high/critical", "reason": "原因", "needsIntervention": true/false, "suggestion": "建议"}`,
        }],
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { hasRisk: false };
    } catch (err) {
      logger.error(`反馈分析失败: ${err.message}`);
      return { hasRisk: false, error: err.message };
    }
  }
}

module.exports = new AIAnalyzer();
