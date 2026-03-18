/**
 * 任务解析器
 * 负责：将钉钉在线文档的内容解析为结构化的部门任务数据
 *
 * 支持两种输入模式：
 * 1. 直接读取钉钉在线文档API返回的内容
 * 2. 解析用户粘贴的文本内容（推荐初期使用）
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

class TaskParser {
  /**
   * 解析文档文本内容，提取各部门任务信息
   *
   * 期望的文档格式示例：
   * ===================================
   * 【市场部 - 张三】
   * 1. 品牌推广方案 | 截止:3/20 | 进度:60% | 已完成线上渠道对接，线下物料制作中
   * 2. Q2营销预算 | 截止:3/25 | 进度:30% | 等待财务部确认预算额度
   *
   * 【技术部 - 李四】
   * 1. 系统升级 | 截止:3/18 | 进度:80% | 核心模块已完成，测试中
   * 2. 数据迁移 | 截止:3/22 | 进度:10% | 阻塞：需要DBA支持，已申请但未排期
   * ===================================
   *
   * @param {string} rawText - 文档原始文本
   * @returns {Object} 结构化的任务数据
   */
  parseDocContent(rawText) {
    const result = {
      parsedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      departments: [],
      summary: { totalTasks: 0, overdueTasks: 0, blockedTasks: 0, completedTasks: 0 },
    };

    if (!rawText || typeof rawText !== 'string') {
      logger.warn('文档内容为空或格式不正确');
      return result;
    }

    // 按部门分块：匹配 【部门名 - 负责人】 格式
    const deptPattern = /【(.+?)\s*[-—]\s*(.+?)】/g;
    const deptBlocks = [];
    let match;

    while ((match = deptPattern.exec(rawText)) !== null) {
      deptBlocks.push({
        department: match[1].trim(),
        owner: match[2].trim(),
        contentStart: match.index + match[0].length,
        headerStart: match.index,
      });
    }

    // 为每个部门提取任务内容
    for (let i = 0; i < deptBlocks.length; i++) {
      const block = deptBlocks[i];
      const endIndex = i + 1 < deptBlocks.length ? deptBlocks[i + 1].headerStart : rawText.length;
      const blockText = rawText.substring(block.contentStart, endIndex);

      const tasks = this._parseTaskLines(blockText);
      result.departments.push({
        department: block.department,
        owner: block.owner,
        tasks,
        lastUpdated: this._detectUpdateTime(blockText),
      });

      // 统计
      for (const task of tasks) {
        result.summary.totalTasks++;
        if (task.isOverdue) result.summary.overdueTasks++;
        if (task.isBlocked) result.summary.blockedTasks++;
        if (task.progress >= 100) result.summary.completedTasks++;
      }
    }

    logger.info(`文档解析完成: ${result.departments.length}个部门, ${result.summary.totalTasks}个任务`);
    return result;
  }

  /**
   * 解析任务行
   * 支持格式: "序号. 任务名 | 截止:日期 | 进度:百分比 | 备注说明"
   */
  _parseTaskLines(blockText) {
    const tasks = [];
    // 按行分割，匹配以 "数字." 或 "数字、" 或 "- " 开头的行
    const lines = blockText.split('\n');
    for (const rawLine of lines) {
      const lineMatch = rawLine.match(/^\s*(?:(\d+)[.、]|[-•])\s+(.+)/);
      if (lineMatch) {
        const line = lineMatch[2].trim();
        // 跳过非任务行（如"更新时间"等元信息行）
        if (/^更新(?:时间|日期)/.test(line)) continue;
        const task = this._parseTaskLine(line);
        if (task && task.name) tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * 解析单行任务内容
   */
  _parseTaskLine(line) {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length === 0) return null;

    const task = {
      name: parts[0],
      deadline: null,
      progress: 0,
      notes: '',
      isOverdue: false,
      isBlocked: false,
      riskLevel: 'low',
      rawText: line,
    };

    for (const part of parts.slice(1)) {
      // 截止日期
      const deadlineMatch = part.match(/截止[:：]\s*(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?)/);
      if (deadlineMatch) {
        task.deadline = this._parseDate(deadlineMatch[1]);
        task.isOverdue = task.deadline && dayjs().isAfter(dayjs(task.deadline), 'day');
        continue;
      }

      // 进度百分比
      const progressMatch = part.match(/进度[:：]\s*(\d+)%?/);
      if (progressMatch) {
        task.progress = parseInt(progressMatch[1], 10);
        continue;
      }

      // 其余内容作为备注
      task.notes += (task.notes ? '; ' : '') + part;
    }

    // 检测是否被阻塞（"等待"需要后面跟明确的阻塞性描述才算）
    const blockKeywords = ['阻塞', '依赖', '卡住', '暂停', '无法'];
    task.isBlocked = blockKeywords.some(kw => task.notes.includes(kw) || task.name.includes(kw));

    return task;
  }

  /**
   * 解析日期字符串
   */
  _parseDate(dateStr) {
    const parts = dateStr.split(/[/\-.]/);
    if (parts.length === 2) {
      // 只有月/日，补全年份
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      return dayjs().year() + `-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    if (parts.length === 3) {
      let [a, b, c] = parts.map(Number);
      if (a > 31) return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
      return `${dayjs().year()}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    return null;
  }

  /**
   * 检测内容中的更新时间
   */
  _detectUpdateTime(text) {
    const timeMatch = text.match(/更新(?:时间|日期)?[:：]\s*(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,2})/);
    if (timeMatch) return this._parseDate(timeMatch[1]);
    return null;
  }

  /**
   * 将结构化数据与历史数据对比，检测变更
   */
  detectChanges(currentData, previousData) {
    const changes = [];

    if (!previousData || !previousData.departments) return changes;

    for (const dept of currentData.departments) {
      const prevDept = previousData.departments.find(d => d.department === dept.department);
      if (!prevDept) {
        changes.push({ type: 'new_department', department: dept.department });
        continue;
      }

      for (const task of dept.tasks) {
        const prevTask = prevDept.tasks.find(t => t.name === task.name);
        if (!prevTask) {
          changes.push({ type: 'new_task', department: dept.department, task: task.name });
        } else {
          if (task.progress !== prevTask.progress) {
            changes.push({
              type: 'progress_change',
              department: dept.department,
              task: task.name,
              from: prevTask.progress,
              to: task.progress,
            });
          }
          if (task.isBlocked && !prevTask.isBlocked) {
            changes.push({ type: 'new_block', department: dept.department, task: task.name, notes: task.notes });
          }
        }
      }
    }

    return changes;
  }
}

module.exports = new TaskParser();
