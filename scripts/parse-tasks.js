/**
 * 解析钉钉文档中的工作任务
 * 输入：Markdown 格式的任务文档
 * 输出：结构化的任务 JSON
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// 从 Markdown 解析所有任务
function parseTasks(markdown) {
  const lines = markdown.split('\n');
  const tasks = [];

  let currentDept = '';
  let currentSection = '';  // 待完成 / 已完成
  let currentSubSection = '';
  let currentAssignees = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 先匹配状态区（优先级最高）: ## 待完成 / ## 已完成 / ### 待完成 / ### 已完成
    if (line.match(/^#{2,4}\s*待完成/)) {
      currentSection = '待完成';
      continue;
    }
    if (line.match(/^#{2,4}\s*已完成/)) {
      currentSection = '已完成';
      continue;
    }

    // 匹配部门标题: # 一、后市场部 / # 全体：（仅 # 开头，不含 ## ###）
    const deptMatch = line.match(/^#\s+(?:[一二三四五六七八九十]+、)?(.+?)(?:\s*\$|$)/);
    if (deptMatch && line.startsWith('# ')) {
      const deptName = deptMatch[1].replace(/\$\\color\{[^}]+\}\{[^}]*\}\$/g, '').trim();
      if (deptName && deptName.length > 1) {
        currentDept = deptName.replace(/[:：]$/, '');
        currentAssignees = extractAssignees(line);
        currentSection = '';
        currentSubSection = '';
      }
    }

    // 匹配子版块: ### （一）xxx / ### （二）xxx / #### x.x xxx
    const subMatch = line.match(/^#{3,4}\s*[（(]?[一二三四五六七八九十\d.]+[）)]?\s*(.+?)(?:\s*\$|$)/);
    if (subMatch) {
      currentSubSection = subMatch[1].replace(/\$\\color\{[^}]+\}\{[^}]*\}\$/g, '').replace(/[:：]$/, '').trim();
      continue;
    }

    // 跳过开庭记录（格式: 数字、起诉/应诉-xxx-律师-日期）
    if (line.match(/^\d+、\s*(起诉|应诉|上诉)-/)) continue;

    // 匹配任务项: 数字. 内容 @xxx
    const taskMatch = line.match(/^\d+[.)．、]\s*(.+)/);
    if (taskMatch && currentDept) {
      const rawContent = taskMatch[1];
      const assignees = extractAssignees(rawContent);
      const cleanContent = cleanTaskContent(rawContent);
      const deadline = extractDeadline(rawContent);
      const progress = extractProgress(rawContent);

      // 跳过空内容
      if (!cleanContent || cleanContent.length < 3) continue;

      // 判断状态
      let status = currentSection || '待完成';
      if (progress && progress.match(/已完成|已处理|已解决|已到款/)) {
        status = '已完成';
      }

      tasks.push({
        department: currentDept,
        section: currentSubSection || '',
        content: cleanContent,
        assignees: assignees.length > 0 ? assignees : currentAssignees,
        status,
        deadline,
        progress: progress || '',
        rawLine: i + 1,
      });
    }

    // 匹配 * 开头的补充说明（有些任务用 * 而非数字）
    const bulletMatch = line.match(/^\*\s+(.+)/);
    if (bulletMatch && tasks.length > 0 && currentSection === '待完成') {
      // 附加到上一个任务的补充信息
      const lastTask = tasks[tasks.length - 1];
      const extra = cleanTaskContent(bulletMatch[1]);
      if (extra.length > 10) {
        lastTask.content += '；' + extra;
      }
    }
  }

  return tasks;
}

// 提取 @负责人
function extractAssignees(text) {
  const matches = [];
  // 匹配 $\color{#xxx}{@名字}$ 格式
  const regex = /\$\\color\{[^}]+\}\{@([^}]+)\}\$/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    let name = match[1];
    // 提取括号中的实际姓名: "吕鹏飞-PM8C(吕鹏飞)" → "吕鹏飞"
    const nameMatch = name.match(/\(([^)]+)\)/);
    if (nameMatch) {
      name = nameMatch[1];
    }
    // 修正常见昵称
    const nicknames = {
      '詹Gollum': '詹惠如', '陈财务': '陈碧霞', 'Edward': 'Edward',
      '郭倩-噗噗': '郭倩', '危机公关': '许高鸿',
    };
    if (nicknames[name]) name = nicknames[name];
    if (!matches.includes(name)) {
      matches.push(name);
    }
  }
  return matches;
}

// 清理任务内容（去除颜色标记、@标记等）
function cleanTaskContent(text) {
  return text
    .replace(/\$\\color\{[^}]+\}\{@[^}]*\}\$/g, '')  // 去除 @标记
    .replace(/\$\\color\{[^}]+\}\{[^}]*\}\$/g, '')     // 去除其他颜色标记
    .replace(/\s{2,}/g, ' ')                              // 合并空格
    .replace(/[：:]\s*$/, '')                              // 去除末尾冒号
    .trim();
}

// 提取截止日期
function extractDeadline(text) {
  // 匹配各种日期格式
  const patterns = [
    /(\d{1,2}\.\d{1,2})(?:前|之前|完成|交付|内)/,
    /截止(?:时间)?(?:为)?(\d{1,2}\.\d{1,2}|\d{1,2}月\d{1,2}日?)/,
    /(\d{1,2}\.\d{1,2})(?:上交|递交|需要)/,
    /(\d{4}[./]\d{1,2}[./]\d{1,2})/,
    /(\d{1,2})天内/,
    /本周(?:内|五|四)?(?:\()?(\d{1,2}\.\d{1,2})?/,
    /(\d{1,2}\.\d{1,2})\s*(?:完成|处理完|解决)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  return '';
}

// 提取进度信息（冒号后的状态描述）
function extractProgress(text) {
  // 匹配最后一个冒号后的进度描述
  const colonMatch = text.match(/[：:]\s*([^：:$]{2,})$/);
  if (colonMatch) {
    return colonMatch[1]
      .replace(/\$\\color\{[^}]+\}\{@[^}]*\}\$/g, '')
      .trim();
  }
  return '';
}

// 生成催办摘要
function generateReminders(tasks) {
  const today = new Date();
  const pending = tasks.filter(t => t.status === '待完成');

  // 按部门分组
  const byDept = {};
  for (const task of pending) {
    if (!byDept[task.department]) byDept[task.department] = [];
    byDept[task.department].push(task);
  }

  // 按负责人分组
  const byPerson = {};
  for (const task of pending) {
    for (const person of task.assignees) {
      if (!byPerson[person]) byPerson[person] = [];
      byPerson[person].push(task);
    }
  }

  return { byDept, byPerson, totalPending: pending.length, totalCompleted: tasks.length - pending.length };
}

// 格式化为钉钉消息
function formatDingTalkMessage(reminders) {
  let msg = `## 📋 工作任务催办提醒\n\n`;
  msg += `**待完成: ${reminders.totalPending} 项 | 已完成: ${reminders.totalCompleted} 项**\n\n`;

  // 按部门显示
  for (const [dept, tasks] of Object.entries(reminders.byDept)) {
    msg += `### ${dept} (${tasks.length}项待完成)\n\n`;
    for (const task of tasks.slice(0, 5)) {  // 每部门最多显示5项
      const assigneeStr = task.assignees.join('、') || '未指定';
      const deadlineStr = task.deadline ? ` ⏰${task.deadline}` : '';
      const progressStr = task.progress ? ` → ${task.progress}` : '';
      msg += `- ${task.content.slice(0, 60)}${task.content.length > 60 ? '...' : ''}\n`;
      msg += `  **负责人:** ${assigneeStr}${deadlineStr}${progressStr}\n\n`;
    }
    if (tasks.length > 5) {
      msg += `  _...还有 ${tasks.length - 5} 项_\n\n`;
    }
  }

  // 个人任务统计
  msg += `---\n### 📊 个人任务统计 (Top 10)\n\n`;
  const sortedPersons = Object.entries(reminders.byPerson)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  for (const [person, tasks] of sortedPersons) {
    msg += `- **${person}**: ${tasks.length} 项待完成\n`;
  }

  return msg;
}

// 主函数
async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '..', '3月各部门工作任务副本.md');

  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(filePath, 'utf-8');
  console.log(`📄 读取文件: ${filePath} (${markdown.length} 字)\n`);

  // 解析任务
  const tasks = parseTasks(markdown);
  console.log(`✅ 解析完成: ${tasks.length} 个任务\n`);

  // 生成摘要
  const reminders = generateReminders(tasks);

  // 输出统计
  console.log(`📊 统计:`);
  console.log(`   待完成: ${reminders.totalPending} 项`);
  console.log(`   已完成: ${reminders.totalCompleted} 项\n`);

  console.log(`📋 部门任务数:`);
  for (const [dept, tasks] of Object.entries(reminders.byDept)) {
    console.log(`   ${dept}: ${tasks.length} 项`);
  }

  console.log(`\n👤 个人任务数 (Top 15):`);
  const sortedPersons = Object.entries(reminders.byPerson)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15);
  for (const [person, tasks] of sortedPersons) {
    console.log(`   ${person}: ${tasks.length} 项`);
  }

  // 保存结构化数据
  const outputDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'parsed-tasks.json');
  fs.writeFileSync(outputPath, JSON.stringify(tasks, null, 2), 'utf-8');
  console.log(`\n💾 结构化数据已保存: ${outputPath}`);

  // 生成钉钉消息
  const message = formatDingTalkMessage(reminders);
  const msgPath = path.join(outputDir, 'reminder-message.md');
  fs.writeFileSync(msgPath, message, 'utf-8');
  console.log(`📨 催办消息已生成: ${msgPath}`);

  // 输出消息预览
  console.log(`\n${'='.repeat(60)}`);
  console.log(message);
}

main().catch(e => console.error('错误:', e.message));
