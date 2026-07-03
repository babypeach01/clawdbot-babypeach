/**
 * 任务解析器（v3 - 适配实际钉钉文档格式）
 *
 * 实际文档格式特征：
 * - 部门标题：「一、后市场部 @负责人」「二、汽车销售部 @负责人」
 * - 人名标记：$\color{#0089FF}{@姓名-工号(显示名)}$ （钉钉Markdown彩色@语法）
 * - 分区标记：每个部门下有「待完成」和「已完成」两大段
 * - 子板块：（一）（二）（三）... 表示子业务线
 * - 任务行：数字序号开头，混合任务描述+负责人+状态
 * - 进度状态：行末 ：推进中、：催办中、：已完成 等
 * - 任务描述可能很长，包含背景、要求、子项等
 */
const dayjs = require('dayjs');
const logger = require('../utils/logger');

/**
 * 进度状态映射表
 */
const STATUS_MAP = {
  completed: {
    label: '已完成',
    keywords: ['已完成', '已结束', '已交付', '已上线', '已落地', '已解决', '结案', '已办结', '办结', '已处理', '已安排', '已到款', '已打款', '已过户', '已开庭', '已勘验', '已委托', '已收到', '已盘点', '已转移', '已安装完毕', '已购入保险'],
  },
  in_progress: {
    label: '推进中',
    keywords: ['推进中', '进行中', '执行中', '处理中', '开展中', '落实中', '实施中', '对接中', '沟通中', '协调中', '跟进中', '跟进', '收车中', '蹲守收车中', '排期中', '购买流程中', '变更中', '维修中', '招聘中', '更新中', '进行', '撰写脚本中', '制作中'],
  },
  pending_response: {
    label: '催办中',
    keywords: ['催办中', '催办', '等待回复', '等待反馈', '等待确认', '待确认', '待审批', '已催', '催缴', '等待', '等判决', '等裁决', '等保险公司消息', '等老板', '待老板', '待回复', '等财务', '待财务'],
  },
  not_started: {
    label: '待启动',
    keywords: ['待启动', '未开始', '待开展', '计划中', '筹备中', '准备中', '待安排', '待分配', '暂未确认', '暂未', '待买断', '待预约'],
  },
  on_hold: {
    label: '暂缓',
    keywords: ['暂缓', '搁置', '暂停', '挂起', '延后', '暂不处理', '暂不移交', '计划实时调整', '后续计划已调整'],
  },
  blocked: {
    label: '阻塞',
    keywords: ['阻塞', '卡住', '受阻', '无法推进', '暂时无人能解决', '不配合', '仍不配合', '客户不配合', '无法安排'],
  },
};

class TaskParser {
  /**
   * 解析文档文本内容
   */
  parseDocContent(rawText) {
    const result = {
      parsedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      departments: [],
      summary: {
        totalTasks: 0,
        completedTasks: 0,
        overdueTasks: 0,
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

    // 预处理：清除钉钉颜色标记，提取人名
    const cleanedText = rawText;

    // 按部门分块
    const departments = this._splitByDepartment(cleanedText);

    for (const dept of departments) {
      const { pendingTasks, completedTasks } = this._extractTasksBySection(dept.content);

      // 待完成任务
      for (const task of pendingTasks) {
        task.isCompleted = false;
      }
      // 已完成任务
      for (const task of completedTasks) {
        task.isCompleted = true;
        task.status = '已完成';
        task.statusKey = 'completed';
      }

      const allTasks = [...pendingTasks, ...completedTasks];

      result.departments.push({
        department: dept.name,
        owner: dept.owner,
        subSections: dept.subSections || [],
        pendingCount: pendingTasks.length,
        completedCount: completedTasks.length,
        tasks: allTasks,
      });

      // 统计
      for (const task of allTasks) {
        result.summary.totalTasks++;
        const key = task.statusKey;
        if (key === 'completed') result.summary.completedTasks++;
        else if (key === 'in_progress') result.summary.inProgressTasks++;
        else if (key === 'pending_response') result.summary.pendingResponseTasks++;
        else if (key === 'blocked') result.summary.blockedTasks++;
        else if (key === 'on_hold') result.summary.onHoldTasks++;
        else if (key === 'not_started') result.summary.notStartedTasks++;
        if (task.isOverdue) result.summary.overdueTasks++;
      }
    }

    logger.info(`文档解析完成: ${result.departments.length}个部门, ${result.summary.totalTasks}个任务`);
    return result;
  }

  /**
   * 按部门分块
   * 匹配格式：
   *   全体：
   *   一、后市场部 @负责人
   *   二、汽车销售部 @负责人
   *   十二、总助版块 @负责人
   */
  _splitByDepartment(rawText) {
    const departments = [];

    // 匹配中文数字部门标题：一、二、...十二、或"全体："
    // Pattern: 行首（可能有 # 号前缀），中文数字+顿号+部门名 或 全体：
    const deptPattern = /^(?:#\s*)?(?:([一二三四五六七八九十百]+、)(.+?)|(全体)[：:]\s*(.*)?)$/gm;

    const matches = [];
    let match;
    while ((match = deptPattern.exec(rawText)) !== null) {
      let prefix, rest;
      if (match[3]) {
        // 「全体：」格式
        prefix = match[3] + '：';
        rest = match[4] || '';
      } else {
        prefix = match[1];
        rest = match[2].trim();
      }

      const nameAndOwner = this._extractDeptNameAndOwner(prefix, rest);
      matches.push({
        ...nameAndOwner,
        index: match.index,
        length: match[0].length,
      });
    }

    if (matches.length === 0) {
      // 尝试备用策略：【部门名】或 ## 部门名
      return this._splitByDepartmentFallback(rawText);
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
   * 从部门标题行提取部门名和负责人
   */
  _extractDeptNameAndOwner(prefix, rest) {
    // 清除钉钉@标记，提取人名
    const owners = this._extractMentions(rest);
    const cleanName = prefix === '全体：' || prefix === '全体:'
      ? '全体'
      : this._cleanDingtalkMarks(rest).trim();

    return {
      name: cleanName,
      owner: owners.join('、'),
    };
  }

  /**
   * 提取钉钉@标记中的人名
   * 格式：$\color{#0089FF}{@姓名-工号(显示名)}$ 或 $\color{#0089FF}{@姓名}$
   */
  _extractMentions(text) {
    const mentions = [];
    // 匹配 $\color{#0089FF}{@...}$ 格式
    const pattern = /\$\\color\{#[0-9A-Fa-f]+\}\{@([^}]+)\}\$/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1];
      // 提取显示名：优先取括号内的名字
      const displayMatch = raw.match(/\(([^)]+)\)/);
      if (displayMatch) {
        mentions.push(displayMatch[1]);
      } else {
        // 取@后的名字部分（去掉工号）
        const nameMatch = raw.match(/^([^-]+)/);
        mentions.push(nameMatch ? nameMatch[1] : raw);
      }
    }
    return mentions;
  }

  /**
   * 清除钉钉颜色标记，保留纯文本
   */
  _cleanDingtalkMarks(text) {
    // 移除 $\color{#0089FF}{@...}$ 但保留人名信息
    return text.replace(/\$\\color\{#[0-9A-Fa-f]+\}\{@[^}]+\}\$/g, '').trim();
  }

  /**
   * 备用部门分块策略
   */
  _splitByDepartmentFallback(rawText) {
    const departments = [];

    // 策略1: 【部门名】
    const pattern1 = /【(.+?)(?:\s*[-—]\s*(.+?))?】/g;
    // 策略2: ## 部门名
    const pattern2 = /^#{1,3}\s+(.+?)$/gm;

    let matches = [];
    let match;

    while ((match = pattern1.exec(rawText)) !== null) {
      matches.push({ name: match[1].trim(), owner: match[2]?.trim() || '', index: match.index, length: match[0].length });
    }

    if (matches.length === 0) {
      while ((match = pattern2.exec(rawText)) !== null) {
        matches.push({ name: match[1].trim(), owner: '', index: match.index, length: match[0].length });
      }
    }

    if (matches.length === 0) {
      return [{ name: '未分类', owner: '', content: rawText }];
    }

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
   * 按「待完成」和「已完成」分区提取任务
   */
  _extractTasksBySection(blockText) {
    let pendingText = '';
    let completedText = '';

    // 查找「待完成」和「已完成」分区
    const pendingMatch = blockText.match(/待完成[：:]?\s*\n/);
    const completedMatch = blockText.match(/已完成[：:]?\s*\n/);

    if (pendingMatch && completedMatch) {
      const pendingIdx = pendingMatch.index + pendingMatch[0].length;
      const completedIdx = completedMatch.index;

      if (pendingIdx < completedIdx) {
        // 待完成在前，已完成在后
        pendingText = blockText.substring(pendingIdx, completedIdx);
        completedText = blockText.substring(completedIdx + completedMatch[0].length);
      } else {
        // 已完成在前，待完成在后（少见但处理）
        completedText = blockText.substring(completedIdx + completedMatch[0].length, pendingMatch.index);
        pendingText = blockText.substring(pendingIdx);
      }
    } else if (pendingMatch) {
      pendingText = blockText.substring(pendingMatch.index + pendingMatch[0].length);
    } else if (completedMatch) {
      // 完成标记前面的都算待完成
      pendingText = blockText.substring(0, completedMatch.index);
      completedText = blockText.substring(completedMatch.index + completedMatch[0].length);
    } else {
      // 没有分区标记，全部当作待完成
      pendingText = blockText;
    }

    // 但如果有多个「已完成」段（某些部门在中间夹了已完成），需要处理
    // 重新用更精确的方式拆分：找到所有「待完成」和「已完成」标记的位置
    const allSections = this._splitIntoSections(blockText);

    const pendingTasks = [];
    const completedTasks = [];

    for (const section of allSections) {
      const tasks = this._extractTasks(section.content);
      if (section.type === 'completed') {
        completedTasks.push(...tasks);
      } else {
        pendingTasks.push(...tasks);
      }
    }

    return { pendingTasks, completedTasks };
  }

  /**
   * 将部门内容按「待完成」「已完成」标记拆分为多个段
   */
  _splitIntoSections(blockText) {
    const sections = [];
    // 找到所有「待完成」和「已完成」的位置
    const sectionPattern = /^(待完成|已完成)[：:]?\s*$/gm;
    const markers = [];
    let match;

    while ((match = sectionPattern.exec(blockText)) !== null) {
      markers.push({
        type: match[1] === '已完成' ? 'completed' : 'pending',
        index: match.index,
        endIndex: match.index + match[0].length,
      });
    }

    if (markers.length === 0) {
      // 没有分区标记
      return [{ type: 'pending', content: blockText }];
    }

    // 标记之前的内容（如果有的话，比如阶段目标之类的）
    if (markers[0].index > 0) {
      const beforeContent = blockText.substring(0, markers[0].index);
      if (beforeContent.trim()) {
        sections.push({ type: 'pending', content: beforeContent });
      }
    }

    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].endIndex;
      const end = i + 1 < markers.length ? markers[i + 1].index : blockText.length;
      const content = blockText.substring(start, end);
      if (content.trim()) {
        sections.push({ type: markers[i].type, content });
      }
    }

    return sections;
  }

  /**
   * 从内容块中提取任务列表
   */
  _extractTasks(blockText) {
    const tasks = [];
    const lines = blockText.split('\n');

    let currentSubSection = '';
    let currentTask = null;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;

      // 检测子板块标题：（一）（二）等
      const subSectionMatch = trimmed.match(/^[（(]([一二三四五六七八九十百]+)[)）](.+)/);
      if (subSectionMatch) {
        // 保存之前的任务
        if (currentTask) {
          tasks.push(currentTask);
          currentTask = null;
        }
        currentSubSection = this._cleanDingtalkMarks(subSectionMatch[2]).replace(/[：:]\s*$/, '').trim();
        continue;
      }

      // 检测数字编号的任务行
      const taskLineMatch = trimmed.match(/^(\d+)[.、)）]\s*(.+)/);
      if (taskLineMatch) {
        // 保存之前的任务
        if (currentTask) {
          tasks.push(currentTask);
        }

        const lineContent = taskLineMatch[2];
        currentTask = this._parseTaskLine(lineContent, trimmed, currentSubSection);
        continue;
      }

      // 检测 - 或 * 开头的子项（附加到当前任务的备注）
      const subItemMatch = trimmed.match(/^[-•·*]\s+(.+)/);
      if (subItemMatch && currentTask) {
        const subContent = this._cleanDingtalkMarks(subItemMatch[1]).trim();
        currentTask.notes += (currentTask.notes ? '\n' : '') + subContent;
        continue;
      }

      // 其他行如果跟在任务后面，可能是补充说明
      if (currentTask && !trimmed.match(/^(?:待完成|已完成|阶段目标)/)) {
        // 如果不是新的结构标记，追加到当前任务的备注
        const cleaned = this._cleanDingtalkMarks(trimmed);
        if (cleaned && cleaned.length > 2) {
          currentTask.notes += (currentTask.notes ? '\n' : '') + cleaned;
        }
      }
    }

    // 保存最后一个任务
    if (currentTask) {
      tasks.push(currentTask);
    }

    return tasks;
  }

  /**
   * 解析单行任务内容
   */
  _parseTaskLine(line, rawLine, subSection) {
    // 提取所有@人
    const mentions = this._extractMentions(line);
    // 清除钉钉标记
    const cleanLine = this._cleanDingtalkMarks(line);
    const legacyTask = this._parseLegacyPipeTaskLine(cleanLine, rawLine, mentions, subSection);
    if (legacyTask) return legacyTask;

    const task = {
      title: '',
      name: '',
      owners: mentions,              // 所有相关负责人
      owner: mentions[0] || '',      // 主要负责人
      status: '推进中',
      statusKey: 'in_progress',
      subSection: subSection,        // 所属子板块
      deadline: null,
      progress: undefined,
      notes: '',
      isBlocked: false,
      isCompleted: false,
      isOverdue: false,
      rawText: rawLine,
    };

    // 尝试从行末提取状态（常见格式：「：推进中」「：已完成，xxx」）
    // 找最后一个 ： 后面的内容作为状态/备注
    const lastColonIdx = cleanLine.lastIndexOf('：');
    const lastColonIdx2 = cleanLine.lastIndexOf(':');
    const colonIdx = Math.max(lastColonIdx, lastColonIdx2);

    if (colonIdx > 0 && colonIdx > cleanLine.length * 0.3) {
      // 冒号在行的后半段，可能是状态标注
      const afterColon = cleanLine.substring(colonIdx + 1).trim();
      const beforeColon = cleanLine.substring(0, colonIdx).trim();

      if (afterColon.length > 0 && afterColon.length <= 80) {
        const matched = this._matchStatus(afterColon);
        if (matched) {
          task.status = matched.label;
          task.statusKey = matched.key;
          task.title = beforeColon;
          // 冒号后面除了状态词之外的内容放入备注
          const noteContent = afterColon.replace(matched.matched, '').replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim();
          if (noteContent) task.notes = noteContent;
        } else {
          // 冒号后面不是标准状态词，全部作为备注/进度说明
          task.title = beforeColon;
          task.notes = afterColon;
        }
      } else {
        task.title = cleanLine.trim();
      }
    } else {
      task.title = cleanLine.trim();
    }

    // 去掉标题末尾的冒号
    task.title = task.title.replace(/[：:]\s*$/, '').trim();

    // 如果标题为空，用清理后的整行
    if (!task.title) {
      task.title = cleanLine.replace(/[：:]\s*$/, '').trim();
    }

    // 尝试提取截止日期
    const dateMatch = task.title.match(/[（(](\d{1,2}\.\d{1,2})[^)）]*[)）]/);
    if (dateMatch) {
      const parts = dateMatch[1].split('.');
      task.deadline = `${dayjs().year()}-${String(parseInt(parts[0])).padStart(2, '0')}-${String(parseInt(parts[1])).padStart(2, '0')}`;
    }

    task.isBlocked = task.statusKey === 'blocked';
    task.isCompleted = task.statusKey === 'completed';
    task.isOverdue = this._isDeadlineOverdue(task.deadline) && !task.isCompleted;
    task.name = task.title;

    return task;
  }

  /**
   * 兼容 README 和早期测试中的管道分隔格式：
   * 任务名 | 截止:3/25 | 进度:60% | 备注
   */
  _parseLegacyPipeTaskLine(cleanLine, rawLine, mentions, subSection) {
    if (!cleanLine.includes('|')) return null;

    const parts = cleanLine.split('|').map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    const title = parts[0].replace(/[：:]\s*$/, '').trim();
    const task = {
      title,
      name: title,
      owners: mentions,
      owner: mentions[0] || '',
      status: '推进中',
      statusKey: 'in_progress',
      subSection,
      deadline: null,
      progress: undefined,
      notes: '',
      isBlocked: false,
      isCompleted: false,
      isOverdue: false,
      rawText: rawLine,
    };

    const noteParts = [];
    for (const part of parts.slice(1)) {
      const deadlineMatch = part.match(/截止[：:]\s*(\d{1,2}[/.]\d{1,2})/);
      if (deadlineMatch) {
        task.deadline = deadlineMatch[1];
        continue;
      }

      const progressMatch = part.match(/进度[：:]\s*(\d{1,3})\s*%?/);
      if (progressMatch) {
        task.progress = Math.min(100, Math.max(0, Number(progressMatch[1])));
        continue;
      }

      noteParts.push(part);
    }

    task.notes = noteParts.join(' | ');

    const statusSource = `${task.notes} ${task.progress === 100 ? '已完成' : ''}`;
    const matched = this._matchStatus(statusSource);
    if (matched && matched.key !== 'completed') {
      task.status = matched.label;
      task.statusKey = matched.key;
    }

    task.isBlocked = task.statusKey === 'blocked';
    task.isCompleted = task.statusKey === 'completed' || task.progress === 100;
    if (task.isCompleted) {
      task.status = '已完成';
      task.statusKey = 'completed';
    }
    task.isOverdue = this._isDeadlineOverdue(task.deadline) && !task.isCompleted;

    return task;
  }

  _isDeadlineOverdue(deadline) {
    if (!deadline) return false;

    const match = String(deadline).match(/^(\d{1,2})[/.](\d{1,2})$/);
    if (!match) return false;

    const dueDate = dayjs(`${dayjs().year()}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`);
    return dueDate.isValid() && dueDate.isBefore(dayjs(), 'day');
  }

  /**
   * 匹配进度状态词
   */
  _matchStatus(text) {
    // 优先匹配更具体的状态（先检查阻塞/暂缓/催办，再检查一般状态）
    const checkOrder = ['blocked', 'on_hold', 'completed', 'pending_response', 'not_started', 'in_progress'];

    for (const key of checkOrder) {
      const config = STATUS_MAP[key];
      for (const keyword of config.keywords) {
        if (text.includes(keyword)) {
          return { key, label: config.label, matched: keyword };
        }
      }
    }
    return null;
  }

  /**
   * 对比检测变更
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
        const prevTask = prevDept.tasks.find(t =>
          t.title === task.title ||
          (t.title && task.title && (t.title.includes(task.title) || task.title.includes(t.title)))
        );

        if (!prevTask) {
          changes.push({ type: 'new_task', department: dept.department, task: task.title });
        } else if (task.progress !== undefined && prevTask.progress !== undefined && task.progress !== prevTask.progress) {
          changes.push({
            type: 'progress_change',
            department: dept.department,
            task: task.title,
            from: prevTask.progress,
            to: task.progress,
          });
        } else if (task.statusKey !== prevTask.statusKey) {
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

    return changes;
  }

  /**
   * 获取状态映射表
   */
  getStatusMap() {
    return STATUS_MAP;
  }
}

module.exports = new TaskParser();
