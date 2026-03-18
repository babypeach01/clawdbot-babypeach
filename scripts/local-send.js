#!/usr/bin/env node
/**
 * 本地快捷发送工具
 *
 * 用法：
 *   node scripts/local-send.js                    # 自动检测 data/ 下的文档并发送汇总
 *   node scripts/local-send.js --file 文件路径     # 指定文档文件
 *   node scripts/local-send.js --test             # 发送测试消息（验证连通性）
 *   node scripts/local-send.js --dry-run          # 预览消息，不实际发送
 *   node scripts/local-send.js --dept 综合部       # 按部门发送
 *   node scripts/local-send.js --person 张三       # 按个人发送
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WEBHOOK = process.env.DINGTALK_ROBOT_WEBHOOK;
const SECRET = process.env.DINGTALK_ROBOT_SECRET;

// ========== 签名 & 发送 ==========

function sign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  return encodeURIComponent(
    crypto.createHmac('sha256', secret).update(stringToSign).digest('base64')
  );
}

async function sendDingTalk(title, content, msgtype = 'markdown') {
  if (!WEBHOOK) {
    console.error('错误: 未配置 DINGTALK_ROBOT_WEBHOOK，请检查 .env 文件');
    return false;
  }

  const timestamp = Date.now();
  let url = WEBHOOK;
  if (SECRET) {
    url += `&timestamp=${timestamp}&sign=${sign(timestamp, SECRET)}`;
  }

  const body = msgtype === 'text'
    ? { msgtype: 'text', text: { content } }
    : { msgtype: 'markdown', markdown: { title, text: content } };

  try {
    const res = await axios.post(url, body);
    if (res.data.errcode === 0) {
      console.log('发送成功!');
      return true;
    } else {
      console.error('发送失败:', res.data.errmsg);
      return false;
    }
  } catch (e) {
    console.error('发送异常:', e.response?.data || e.message);
    return false;
  }
}

// ========== 文档检测 ==========

function findDocuments() {
  // 检查多个位置
  const searchDirs = [
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..'),
  ];

  const docs = [];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.match(/\.(md|txt|csv|json)$/) && f.includes('任务')) {
        docs.push(path.join(dir, f));
      }
    }
  }
  return docs;
}

// ========== 任务加载 ==========

function loadParsedTasks() {
  const tasksPath = path.join(__dirname, '..', 'data', 'parsed-tasks.json');
  if (!fs.existsSync(tasksPath)) {
    console.log('未找到解析数据，尝试先解析文档...');
    try {
      require('./parse-tasks');
    } catch (e) {
      console.error('解析失败:', e.message);
      return null;
    }
  }
  if (!fs.existsSync(tasksPath)) return null;
  return JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
}

// ========== 消息生成 ==========

function genSummaryMessage(tasks) {
  const pending = tasks.filter(t => t.status === '待完成');
  const completed = tasks.filter(t => t.status === '已完成');

  const byDept = {};
  for (const t of pending) {
    byDept[t.department] = (byDept[t.department] || 0) + 1;
  }

  const byPerson = {};
  for (const t of pending) {
    for (const p of t.assignees) {
      byPerson[p] = (byPerson[p] || 0) + 1;
    }
  }

  const today = new Date().toLocaleDateString('zh-CN');
  let msg = `## ${today} 工作任务催办汇总\n\n`;
  msg += `**待完成: ${pending.length} 项 | 已完成: ${completed.length} 项**\n\n`;

  msg += `### 各部门待办\n\n`;
  for (const [dept, count] of Object.entries(byDept).sort((a, b) => b[1] - a[1])) {
    msg += `- **${dept}**: ${count} 项\n`;
  }

  msg += `\n### 个人任务排行 (Top 10)\n\n`;
  const top10 = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [person, count] of top10) {
    msg += `- **${person}**: ${count} 项\n`;
  }

  return msg;
}

function genDeptMessage(tasks, deptName) {
  const deptTasks = tasks.filter(t => t.status === '待完成' && t.department.includes(deptName));
  if (deptTasks.length === 0) return null;

  let msg = `## ${deptName} - 待办任务催办\n\n`;
  msg += `**共 ${deptTasks.length} 项待完成**\n\n`;
  for (const task of deptTasks) {
    const assigneeStr = task.assignees.join('、') || '未指定';
    const deadlineStr = task.deadline ? ` | ${task.deadline}` : '';
    msg += `- **${assigneeStr}**${deadlineStr}\n`;
    msg += `  ${task.content.slice(0, 80)}${task.content.length > 80 ? '...' : ''}\n\n`;
  }
  return msg;
}

function genPersonMessage(tasks, personName) {
  const personTasks = tasks.filter(t =>
    t.status === '待完成' && t.assignees.includes(personName)
  );
  if (personTasks.length === 0) return null;

  let msg = `## @${personName} 待办任务提醒\n\n`;
  msg += `**您有 ${personTasks.length} 项待完成任务：**\n\n`;
  for (const task of personTasks) {
    const deadlineStr = task.deadline ? ` ${task.deadline}` : '';
    const deptStr = task.department !== '全体' ? `[${task.department}]` : '';
    msg += `- ${deptStr} ${task.content.slice(0, 70)}${task.content.length > 70 ? '...' : ''}${deadlineStr}\n\n`;
  }
  return msg;
}

// ========== 主逻辑 ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const testMode = args.includes('--test');
  const fileIdx = args.indexOf('--file');
  const personIdx = args.indexOf('--person');
  const deptIdx = args.indexOf('--dept');

  console.log('========================================');
  console.log('  ClawdBot 本地催办发送工具');
  console.log('========================================\n');

  // 测试模式 - 验证连通性
  if (testMode) {
    console.log('发送测试消息...\n');
    const ok = await sendDingTalk(
      '连通测试',
      'ClawdBot 催办系统连通测试成功！',
      'text'
    );
    process.exit(ok ? 0 : 1);
  }

  // 如果指定了文件，先复制到 data 目录
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const srcFile = args[fileIdx + 1];
    if (!fs.existsSync(srcFile)) {
      console.error(`文件不存在: ${srcFile}`);
      process.exit(1);
    }
    const destDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    // 如果是 markdown 文件，也复制到项目根目录作为源文档
    const basename = path.basename(srcFile);
    const destRoot = path.join(__dirname, '..', basename);
    fs.copyFileSync(srcFile, destRoot);
    console.log(`已导入文档: ${basename}\n`);

    // 重新解析
    console.log('解析文档中...');
    try {
      require('./parse-tasks');
    } catch (e) {
      console.error('解析失败:', e.message);
      process.exit(1);
    }
    console.log('');
  }

  // 加载任务
  const tasks = loadParsedTasks();
  if (!tasks || tasks.length === 0) {
    console.log('没有找到任务数据。');
    console.log('请先下载文档到项目目录，或使用 --file 指定文件路径。');
    console.log('\n示例: node scripts/local-send.js --file ~/Downloads/3月任务.md');
    process.exit(1);
  }

  console.log(`已加载 ${tasks.length} 个任务\n`);

  // 生成消息
  let message, title;
  if (personIdx >= 0 && args[personIdx + 1]) {
    const person = args[personIdx + 1];
    message = genPersonMessage(tasks, person);
    title = `${person} 待办提醒`;
  } else if (deptIdx >= 0 && args[deptIdx + 1]) {
    const dept = args[deptIdx + 1];
    message = genDeptMessage(tasks, dept);
    title = `${dept} 催办提醒`;
  } else {
    message = genSummaryMessage(tasks);
    title = '工作任务催办汇总';
  }

  if (!message) {
    console.log('没有待办任务需要催办。');
    process.exit(0);
  }

  // 预览
  console.log('--- 消息预览 ---\n');
  console.log(message);
  console.log('--- 预览结束 ---\n');

  if (dryRun) {
    console.log('[预览模式] 消息未发送。去掉 --dry-run 参数即可实际发送。');
    return;
  }

  // 发送
  console.log('正在发送到钉钉群...');
  const ok = await sendDingTalk(title, message);
  if (ok) {
    console.log('\n发送完成！请检查钉钉群是否收到消息。');
  } else {
    console.log('\n发送失败，请检查网络和 webhook 配置。');
  }
}

main().catch(e => {
  console.error('运行错误:', e.message);
  process.exit(1);
});
