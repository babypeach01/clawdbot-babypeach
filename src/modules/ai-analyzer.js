/**
 * AI智能分析引擎（v2）
 *
 * 新增能力：
 * 1. 从原始文档文本中智能提取任务（当正则解析不够准确时的兜底方案）
 * 2. 去重和合并同类项（跨部门/同部门的重复任务识别）
 * 3. 风险评估、进度分析、智能催办话术生成
 */
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');

class AIAnalyzer {
  constructor() {
    this.client = new Anthropic({ apiKey: config.ai.apiKey });
  }

  /**
   * AI智能提取任务（当正则解析效果不佳时使用）
   * 直接把原始文档丢给AI，让AI理解并结构化
   *
   * @param {string} rawText - 原始文档文本
   * @returns {Object} 结构化的任务数据（与 taskParser.parseDocContent 输出格式一致）
   */
  async extractTasksFromRawText(rawText) {
    try {
      const response = await this.client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        system: `你是一个任务提取专家。你的工作是从会议纪要或待办文档中提取结构化的任务信息。

文档通常按部门分类，每行是一条待办事项，格式不固定，可能包含：
- 序号
- 任务梗概/标题
- 负责人（中文名字，2-4个字）
- 任务进度/状态（如：推进中、催办中、已完成、待启动等）

注意事项：
- 状态描述可能很模糊，如"在推""已催""跟进中"，请归类到最接近的标准状态
- 不要编造信息，如果无法确定某个字段就留空
- 如果没有明确的截止日期，deadline设为null

标准状态枚举: completed(已完成), in_progress(推进中), pending_response(催办中), not_started(待启动), on_hold(暂缓), blocked(阻塞)

你必须以JSON格式返回。`,
        messages: [{
          role: 'user',
          content: `请从以下文档中提取所有部门的待办任务：

${rawText}

返回格式：
\`\`\`json
{
  "departments": [
    {
      "department": "部门名",
      "owner": "部门负责人（如果能识别）",
      "tasks": [
        {
          "title": "任务标题/梗概",
          "owner": "任务负责人",
          "status": "推进中",
          "statusKey": "in_progress",
          "deadline": null,
          "notes": "补充说明",
          "isBlocked": false
        }
      ]
    }
  ]
}
\`\`\``,
        }],
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        logger.info(`AI提取完成: ${extracted.departments?.length || 0}个部门`);

        // 补充 summary 统计
        extracted.parsedAt = new Date().toISOString();
        extracted.summary = this._computeSummary(extracted.departments || []);
        return extracted;
      }

      logger.warn('AI提取返回内容无法解析');
      return null;
    } catch (err) {
      logger.error(`AI提取任务失败: ${err.message}`);
      return null;
    }
  }

  /**
   * AI去重与合并同类项
   * 识别不同表述但实质相同的任务，合并重复项
   *
   * @param {Object} taskData - 解析后的任务数据
   * @returns {Object} 去重后的任务数据 + 合并报告
   */
  async deduplicateTasks(taskData) {
    // 收集所有任务，附带部门信息
    const allTasks = [];
    for (const dept of taskData.departments) {
      for (const task of dept.tasks) {
        allTasks.push({
          department: dept.department,
          title: task.title,
          owner: task.owner,
          status: task.status,
        });
      }
    }

    if (allTasks.length <= 1) {
      return { taskData, duplicates: [] };
    }

    try {
      const response = await this.client.messages.create({
        model: config.ai.model,
        max_tokens: 2048,
        system: `你是一个任务去重专家。分析一组任务列表，找出表述不同但实质是同一件事的任务。
比如"推进品牌合作"和"品牌合作方案落地"可能是同一件事。
只标记你有较高把握确实是重复的任务，不确定的不要标记。`,
        messages: [{
          role: 'user',
          content: `请分析以下任务列表，找出重复/同类项：

${allTasks.map((t, i) => `${i + 1}. [${t.department}] ${t.title} (${t.owner || '未指定'}) - ${t.status}`).join('\n')}

返回JSON：
\`\`\`json
{
  "duplicateGroups": [
    {
      "reason": "为什么判断这些是同一件事",
      "tasks": [1, 3],
      "suggestedTitle": "建议合并后的标题"
    }
  ]
}
\`\`\`
如果没有重复项，返回 {"duplicateGroups": []}`,
        }],
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        const duplicates = result.duplicateGroups || [];

        if (duplicates.length > 0) {
          logger.info(`发现 ${duplicates.length} 组重复任务`);
        }

        return { taskData, duplicates };
      }

      return { taskData, duplicates: [] };
    } catch (err) {
      logger.error(`去重分析失败: ${err.message}`);
      return { taskData, duplicates: [] };
    }
  }

  /**
   * 综合分析所有部门任务，返回风险评估和建议
   * （适配v2的状态体系，不再依赖百分比）
   */
  async analyzeAll(taskData) {
    const prompt = this._buildAnalysisPrompt(taskData);

    try {
      const response = await this.client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        system: `你是一个企业任务管理AI助手，负责分析各部门工作进度并评估风险。

任务状态说明：
- 已完成: 任务已结束
- 推进中: 正常进行中
- 催办中: 已催办等待外部响应，注意这类任务时间周期可能很长，不一定是风险
- 待启动: 还未开始
- 暂缓: 主动搁置
- 阻塞: 被动卡住，无法推进

你需要：
1. 识别真正存在风险的任务（注意区分"催办中"的正常等待 vs 真正的异常）
2. 对每个风险给出风险等级：low/medium/high/critical
3. 生成催办建议和预警信息
4. 语气专业但友善

你必须以JSON格式返回分析结果。`,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].text;
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
      return this._fallbackAnalysis(taskData);
    }
  }

  /**
   * 构建分析提示词（v2 适配状态词体系）
   */
  _buildAnalysisPrompt(taskData) {
    const today = new Date().toISOString().split('T')[0];
    let prompt = `当前日期: ${today}\n\n以下是各部门的任务进度数据，请进行风险分析：\n\n`;

    for (const dept of taskData.departments) {
      prompt += `## ${dept.department}${dept.owner ? `（负责人: ${dept.owner}）` : ''}\n`;
      for (const task of dept.tasks) {
        prompt += `- ${task.title}`;
        if (task.owner) prompt += ` | 负责人:${task.owner}`;
        prompt += ` | 状态:${task.status}`;
        if (task.deadline) prompt += ` | 截止:${task.deadline}`;
        if (task.notes) prompt += ` | 备注:${task.notes}`;
        if (task.isBlocked) prompt += ' | 🚫阻塞';
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
   * 适配v2状态词体系
   */
  _fallbackAnalysis(taskData) {
    const risks = [];
    const reminders = [];
    const alertsForManager = [];

    for (const dept of taskData.departments) {
      for (const task of dept.tasks) {
        // 阻塞检测
        if (task.isBlocked || task.statusKey === 'blocked') {
          risks.push({
            department: dept.department,
            task: task.title,
            riskLevel: 'high',
            reason: '任务处于阻塞状态',
            suggestion: '需要协调相关资源解除阻塞',
          });
          alertsForManager.push({
            level: 'high',
            title: `${dept.department}「${task.title}」被阻塞`,
            detail: `负责人${task.owner || dept.owner}反馈任务被阻塞${task.notes ? ': ' + task.notes : ''}`,
            suggestedAction: '建议了解阻塞原因并协调资源',
          });
        }

        // 截止日期逾期检测
        if (task.deadline && task.statusKey !== 'completed') {
          const daysLeft = Math.ceil((new Date(task.deadline) - new Date()) / 86400000);
          if (daysLeft < 0) {
            risks.push({
              department: dept.department,
              task: task.title,
              riskLevel: 'high',
              reason: `任务已逾期${Math.abs(daysLeft)}天（截止: ${task.deadline}），当前状态: ${task.status}`,
              suggestion: '请尽快确认延期原因和新的完成时间',
            });
          } else if (daysLeft <= 3 && task.statusKey === 'not_started') {
            risks.push({
              department: dept.department,
              task: task.title,
              riskLevel: 'critical',
              reason: `距截止仅剩${daysLeft}天，但任务尚未启动`,
              suggestion: '极高风险延期，建议立即关注',
            });
          }
        }

        // 关键词风险检测
        const fullText = `${task.title} ${task.notes}`;
        const hitKeywords = config.reminder.riskKeywords.filter(kw => fullText.includes(kw));
        if (hitKeywords.length > 0 && !task.isBlocked) {
          risks.push({
            department: dept.department,
            task: task.title,
            riskLevel: 'medium',
            reason: `检测到风险关键词: ${hitKeywords.join(', ')}`,
            suggestion: '建议关注该任务最新进展',
          });
        }
      }

      // 生成催办消息
      const pendingTasks = dept.tasks.filter(t => t.statusKey !== 'completed');
      if (pendingTasks.length > 0) {
        const owner = dept.owner || pendingTasks[0]?.owner || '负责人';
        reminders.push({
          department: dept.department,
          owner,
          message: `${owner}，请更新以下任务的最新进度：${pendingTasks.map(t => t.title).join('、')}`,
        });
      }
    }

    const summary = taskData.summary;
    return {
      overallStatus: `共${summary.totalTasks}个任务，${summary.completedTasks}个已完成，${summary.blockedTasks}个阻塞`,
      overallRiskLevel: alertsForManager.length > 0 ? 'high' : risks.length > 0 ? 'medium' : 'low',
      risks,
      reminders,
      alertsForManager,
      dailySummary: `今日跟踪${taskData.departments.length}个部门、${summary.totalTasks}个任务，其中${summary.completedTasks}个已完成、${summary.inProgressTasks || 0}个推进中、${summary.blockedTasks}个阻塞。`,
    };
  }

  /**
   * 单独分析某个任务的反馈内容
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

  /**
   * 计算摘要统计
   */
  _computeSummary(departments) {
    const summary = {
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      pendingResponseTasks: 0,
      blockedTasks: 0,
      onHoldTasks: 0,
      notStartedTasks: 0,
    };

    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        summary.totalTasks++;
        const key = task.statusKey;
        if (key === 'completed') summary.completedTasks++;
        else if (key === 'in_progress') summary.inProgressTasks++;
        else if (key === 'pending_response') summary.pendingResponseTasks++;
        else if (key === 'blocked') summary.blockedTasks++;
        else if (key === 'on_hold') summary.onHoldTasks++;
        else if (key === 'not_started') summary.notStartedTasks++;
      }
    }

    return summary;
  }
}

module.exports = new AIAnalyzer();
