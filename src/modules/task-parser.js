/**
 * 任务解析器（v2 - 适配真实会议文档格式）
 *
 * 设计原则：
 * - 不要求标准化格式，容忍模糊输入
 * - 按部门分块，每行一条待办事项
 * - 每行格式：序号 + 任务梗概 + 负责人 + 任务进度（状态词，非百分比）
 * - 支持直接粘贴钉钉文档原始内容
 * - 复杂理解交给AI（去重、合并同类项、风险判断）
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

/**
 * 进度状态映射表
 * 将各种模糊的进度表述归类到标准状态
 */
const STATUS_MAP = {
  // 已完成
  completed: {
    label: '已完成',
    keywords: ['已完成', '完成', '已结束', '已交付', '已上线', '已落地', '已解决', '结案', '已办结', '办结'],
    progressValue: 100,
  },
  // 推进中（正常进行）
  in_progress: {
    label: '推进中',
    keywords: ['推进中', '进行中', '执行中', '处理中', '开展中', '落实中', '实施中', '对接中', '沟通中', '协调中', '跟进中'],
    progressValue: 50,
  },
  // 催办中（需要外部响应）
  pending_response: {
    label: '催办中',
    keywords: ['催办中', '催办', '等待回复', '等待反馈', '等待确认', '待确认', '待审批', '已催', '已提交等待'],
    progressValue: 40,
  },
  // 待启动
  not_started: {
    label: '待启动',
    keywords: ['待启动', '未开始', '待开展', '计划中', '筹备中', '准备中', '待安排', '待分配'],
    progressValue: 0,
  },
  // 暂缓/搁置
  on_hold: {
    label: '暂缓',
    keywords: ['暂缓', '搁置', '暂停', '挂起', '延后', '待定', '暂不处理'],
    progressValue: -1,
  },
  // 阻塞
  blocked: {
    label: '阻塞',
    keywords: ['阻塞', '卡住', '受阻', '无法推进', '依赖未解决', '等待前置'],
    progressValue: -2,
  },
};

class TaskParser {
  /**
   * 解析文档文本内容，提取各部门任务信息
   * 支持多种文档格式，容忍不规范输入
   *
   * @param {string} rawText - 文档原始文本（直接从钉钉文档粘贴）
   * @returns {Object} 结构化的任务数据
   */
  parseDocContent(rawText) {
    const result = {
      parsedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      departments: [],
      summary: {
        totalTasks: 0,
        completedTasks: 0,
        inProgressTasks: 0,
        pendingResponseTasks: 0,
        blockedTasks: 0,
        onHoldTasks: 0,
        notStartedTasks: 0,
      },
    };

    if (!rawText || typeof rawText !== 'string') {
      logger.warn('文档内容为空或格式不正确');
      return result;
    }

    // 尝试多种部门分块策略
    const departments = this._splitByDepartment(rawText);

    for (const dept of departments) {
      const tasks = this._extractTasks(dept.content);
      result.departments.push({
        department: dept.name,
        owner: dept.owner || '',
        tasks,
      });

      // 统计
      for (const task of tasks) {
        result.summary.totalTasks++;
        const statusKey = task.statusKey;
        if (statusKey === 'completed') result.summary.completedTasks++;
        else if (statusKey === 'in_progress') result.summary.inProgressTasks++;
        else if (statusKey === 'pending_response') result.summary.pendingResponseTasks++;
        else if (statusKey === 'blocked') result.summary.blockedTasks++;
        else if (statusKey === 'on_hold') result.summary.onHoldTasks++;
        else if (statusKey === 'not_started') result.summary.notStartedTasks++;
      }
    }

    logger.info(`文档解析完成: ${result.departments.length}个部门, ${result.summary.totalTasks}个任务`);
    return result;
  }

  /**
   * 按部门分块 — 支持多种常见格式
   */
  _splitByDepartment(rawText) {
    const departments = [];

    // 策略1: 【部门名】或【部门名 - 负责人】
    const pattern1 = /【(.+?)(?:\s*[-—]\s*(.+?))?】/g;
    // 策略2: ## 部门名 或 # 部门名（Markdown标题）
    const pattern2 = /^#{1,3}\s+(.+?)(?:\s*[-—]\s*(.+?))?$/gm;
    // 策略3: 部门名：或部门名:（行首冒号分隔）
    const pattern3 = /^([^\n\d#【][^\n:：]{1,15}(?:部|组|中心|科|室|处|办))[：:]\s*$/gm;

    let matches = [];
    let match;

    // 依次尝试各策略
    while ((match = pattern1.exec(rawText)) !== null) {
      matches.push({ name: match[1].trim(), owner: match[2]?.trim() || '', index: match.index, length: match[0].length });
    }

    if (matches.length === 0) {
      while ((match = pattern2.exec(rawText)) !== null) {
        matches.push({ name: match[1].trim(), owner: match[2]?.trim() || '', index: match.index, length: match[0].length });
      }
    }

    if (matches.length === 0) {
      while ((match = pattern3.exec(rawText)) !== null) {
        matches.push({ name: match[1].trim(), owner: '', index: match.index, length: match[0].length });
      }
    }

    // 如果仍然没有匹配，整体作为一个"未分类"部门
    if (matches.length === 0) {
      return [{ name: '未分类', owner: '', content: rawText }];
    }

    // 提取每个部门的内容块
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
      departments.push({
        name: matches[i].name,
        owner: matches[i].owner,
        content: rawText.substring(start, end),
      });
    }

    return departments;
  }

  /**
   * 从部门内容块中提取任务列表
   * 容忍多种格式：
   *   1. 任务名称 负责人 进度
   *   1、任务名称 负责人 进度
   *   - 任务名称 负责人 进度
   *   也支持用 | 或 空格/tab 分隔
   */
  _extractTasks(blockText) {
    const tasks = [];
    const lines = blockText.split('\n');

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      // 匹配任务行：以序号、短横线、或圆点开头
      const lineMatch = trimmed.match(/^(?:(\d+)\s*[.、)）]|[-•·▪])\s+(.+)/);
      if (!lineMatch) continue;

      const lineContent = lineMatch[2].trim();

      // 跳过明显的非任务行
      if (/^(?:更新(?:时间|日期)|备注|说明|合计|总计)/.test(lineContent)) continue;

      const task = this._parseTaskLine(lineContent, trimmed);
      if (task && task.title) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * 解析单行任务内容
   * 核心改动：不再要求严格的 | 分隔格式
   * 尝试从自由文本中提取：任务标题、负责人、进度状态
   */
  _parseTaskLine(line, rawLine) {
    const task = {
      title: '',
      owner: '',         // 负责人
      status: '推进中',  // 默认状态
      statusKey: 'in_progress',
      deadline: null,
      notes: '',
      isBlocked: false,
      rawText: rawLine,
    };

    // 如果有 | 分隔，按分隔符拆分
    if (line.includes('|')) {
      return this._parseDelimitedLine(line, task);
    }

    // 否则用AI友好的方式做模糊提取
    return this._parseFreeformLine(line, task);
  }

  /**
   * 解析用 | 分隔的任务行
   */
  _parseDelimitedLine(line, task) {
    const parts = line.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    // 第一段一般是任务标题（可能混合负责人）
    task.title = parts[0];

    for (const part of parts.slice(1)) {
      // 尝试提取负责人
      const ownerMatch = part.match(/(?:负责人?|责任人|对接人|经办)[：:\s]*(.+)/);
      if (ownerMatch) {
        task.owner = ownerMatch[1].trim();
        continue;
      }

      // 尝试提取截止日期
      const deadlineMatch = part.match(/(?:截止|deadline|期限)[：:\s]*(\d{1,4}[/\-.]\d{1,2}(?:[/\-.]\d{1,4})?)/i);
      if (deadlineMatch) {
        task.deadline = this._parseDate(deadlineMatch[1]);
        continue;
      }

      // 尝试提取进度百分比（兼容旧格式）
      const progressMatch = part.match(/(?:进度|完成度?)[：:\s]*(\d+)\s*%/);
      if (progressMatch) {
        const pct = parseInt(progressMatch[1], 10);
        if (pct >= 100) { task.status = '已完成'; task.statusKey = 'completed'; }
        else if (pct > 0) { task.status = '推进中'; task.statusKey = 'in_progress'; }
        else { task.status = '待启动'; task.statusKey = 'not_started'; }
        continue;
      }

      // 尝试匹配状态词
      const statusResult = this._matchStatus(part);
      if (statusResult) {
        task.status = statusResult.label;
        task.statusKey = statusResult.key;
        continue;
      }

      // 剩余内容归入备注
      task.notes += (task.notes ? '; ' : '') + part;
    }

    // 如果标题中混合了负责人，尝试拆分
    this._extractOwnerFromTitle(task);
    task.isBlocked = task.statusKey === 'blocked';

    return task;
  }

  /**
   * 解析自由格式的任务行（无 | 分隔）
   * 这是你们实际场景最常见的情况
   */
  _parseFreeformLine(line, task) {
    let remaining = line;

    // 1. 提取截止日期（如果有的话）
    const dateMatch = remaining.match(/(?:截止|deadline|期限)?[：:\s]*(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4})/i);
    if (dateMatch) {
      task.deadline = this._parseDate(dateMatch[1]);
      remaining = remaining.replace(dateMatch[0], ' ').trim();
    }

    // 2. 提取状态词（从末尾向前查找）
    const statusResult = this._matchStatus(remaining);
    if (statusResult) {
      task.status = statusResult.label;
      task.statusKey = statusResult.key;
      // 去掉匹配到的状态词
      remaining = remaining.replace(statusResult.matched, ' ').trim();
    }

    // 3. 提取负责人（常见模式：中文名字 2-4字）
    // 模式A: 明确标记 "负责人：张三"
    const explicitOwner = remaining.match(/(?:负责人?|责任人|对接人|经办)[：:\s]+([^\s,，;；]{2,4})/);
    if (explicitOwner) {
      task.owner = explicitOwner[1];
      remaining = remaining.replace(explicitOwner[0], ' ').trim();
    } else {
      // 模式B: 名字在末尾附近（状态词已被移除后）
      // 匹配形如 "任务描述 张三" 或 "任务描述（张三）"
      const trailingName = remaining.match(/[（(]([^\s)）]{2,4})[)）]\s*$/);
      if (trailingName) {
        task.owner = trailingName[1];
        remaining = remaining.replace(trailingName[0], '').trim();
      }
    }

    // 4. 剩余的就是任务标题
    task.title = remaining.replace(/\s+/g, ' ').trim();
    task.isBlocked = task.statusKey === 'blocked';

    return task;
  }

  /**
   * 匹配进度状态词
   * 返回 { key, label, matched } 或 null
   */
  _matchStatus(text) {
    for (const [key, config] of Object.entries(STATUS_MAP)) {
      for (const keyword of config.keywords) {
        if (text.includes(keyword)) {
          return { key, label: config.label, matched: keyword };
        }
      }
    }
    return null;
  }

  /**
   * 从标题中提取可能混在一起的负责人
   * 例如：「品牌推广方案 张三 推进中」
   */
  _extractOwnerFromTitle(task) {
    if (task.owner) return; // 已有负责人，不再提取

    // 尝试匹配标题末尾的人名（2-4字中文）
    const match = task.title.match(/\s+([^\s]{2,4})\s*$/);
    if (match) {
      // 简单排除明显不是人名的词
      const notNames = ['方案', '计划', '报告', '通知', '文件', '系统', '平台', '项目', '工作', '会议', '活动'];
      if (!notNames.includes(match[1])) {
        task.owner = match[1];
        task.title = task.title.replace(match[0], '').trim();
      }
    }
  }

  /**
   * 解析日期字符串
   */
  _parseDate(dateStr) {
    const parts = dateStr.split(/[/\-.]/);
    if (parts.length === 2) {
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      return `${dayjs().year()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    if (parts.length === 3) {
      let [a, b, c] = parts.map(Number);
      if (a > 31) return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
      return `${dayjs().year()}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    return null;
  }

  /**
   * 将结构化数据与历史数据对比，检测变更
   * 改用标题模糊匹配（而非完全相等），适应表述可能有细微差异的情况
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
        // 模糊匹配：标题包含关系即认为是同一任务
        const prevTask = prevDept.tasks.find(t =>
          t.title === task.title ||
          t.title?.includes(task.title) ||
          task.title?.includes(t.title)
        );

        if (!prevTask) {
          changes.push({ type: 'new_task', department: dept.department, task: task.title });
        } else {
          if (task.statusKey !== prevTask.statusKey) {
            changes.push({
              type: 'status_change',
              department: dept.department,
              task: task.title,
              from: prevTask.status,
              to: task.status,
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * 获取状态映射表（供外部模块使用）
   */
  getStatusMap() {
    return STATUS_MAP;
  }
}

module.exports = new TaskParser();
