/**
 * 发送催办消息到钉钉群机器人
 * 用法: node scripts/send-reminder.js [--dry-run] [--person 姓名] [--dept 部门名]
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WEBHOOK = process.env.DINGTALK_ROBOT_WEBHOOK;
const SECRET = process.env.DINGTALK_ROBOT_SECRET;

// 生成签名
function sign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
  return encodeURIComponent(hmac);
}

// 发送钉钉消息
async function sendDingTalk(title, markdown) {
  if (!WEBHOOK) {
    console.error('❌ 未配置 DINGTALK_ROBOT_WEBHOOK');
    return false;
  }

  const timestamp = Date.now();
  let url = WEBHOOK;
  if (SECRET) {
    const signature = sign(timestamp, SECRET);
    url += `&timestamp=${timestamp}&sign=${signature}`;
  }

  try {
    const res = await axios.post(url, {
      msgtype: 'markdown',
      markdown: { title, text: markdown },
    });
    if (res.data.errcode === 0) {
      console.log('✅ 消息发送成功');
      return true;
    } else {
      console.error('❌ 发送失败:', res.data.errmsg);
      return false;
    }
  } catch (e) {
    console.error('❌ 发送异常:', e.message);
    return false;
  }
}

// 加载解析后的任务
function loadTasks() {
  const tasksPath = path.join(__dirname, '..', 'data', 'parsed-tasks.json');
  if (!fs.existsSync(tasksPath)) {
    console.log('⚠️  未找到解析数据，先运行解析...');
    require('./parse-tasks');
  }
  return JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
}

// 生成部门催办消息
function genDeptMessage(tasks, deptName) {
  const deptTasks = tasks.filter(t => t.status === '待完成' && t.department.includes(deptName));
  if (deptTasks.length === 0) return null;

  let msg = `## 📋 ${deptName} - 待办任务催办\n\n`;
  msg += `**共 ${deptTasks.length} 项待完成**\n\n`;

  for (const task of deptTasks) {
    const assigneeStr = task.assignees.join('、') || '未指定';
    const deadlineStr = task.deadline ? ` | ⏰ ${task.deadline}` : '';
    const progressStr = task.progress ? `\n> 进度: ${task.progress}` : '';
    msg += `- **${assigneeStr}**${deadlineStr}\n`;
    msg += `  ${task.content.slice(0, 80)}${task.content.length > 80 ? '...' : ''}${progressStr}\n\n`;
  }
  return msg;
}

// 生成个人催办消息
function genPersonMessage(tasks, personName) {
  const personTasks = tasks.filter(t =>
    t.status === '待完成' && t.assignees.includes(personName)
  );
  if (personTasks.length === 0) return null;

  let msg = `## 📋 @${personName} 待办任务提醒\n\n`;
  msg += `**您有 ${personTasks.length} 项待完成任务：**\n\n`;

  for (const task of personTasks) {
    const deadlineStr = task.deadline ? ` ⏰${task.deadline}` : '';
    const deptStr = task.department !== '全体' ? `[${task.department}]` : '';
    const progressStr = task.progress ? `\n> ${task.progress}` : '';
    msg += `- ${deptStr} ${task.content.slice(0, 70)}${task.content.length > 70 ? '...' : ''}${deadlineStr}${progressStr}\n\n`;
  }
  return msg;
}

// 生成全局汇总消息
function genSummaryMessage(tasks) {
  const pending = tasks.filter(t => t.status === '待完成');
  const completed = tasks.filter(t => t.status === '已完成');

  // 按部门统计
  const byDept = {};
  for (const t of pending) {
    byDept[t.department] = (byDept[t.department] || 0) + 1;
  }

  // 按人统计
  const byPerson = {};
  for (const t of pending) {
    for (const p of t.assignees) {
      byPerson[p] = (byPerson[p] || 0) + 1;
    }
  }

  const today = new Date().toLocaleDateString('zh-CN');
  let msg = `## 📊 ${today} 工作任务催办汇总\n\n`;
  msg += `**待完成: ${pending.length} 项 | 已完成: ${completed.length} 项**\n\n`;

  msg += `### 各部门待办\n\n`;
  for (const [dept, count] of Object.entries(byDept).sort((a, b) => b[1] - a[1])) {
    msg += `- **${dept}**: ${count} 项\n`;
  }

  msg += `\n### 个人任务排行 (Top 10)\n\n`;
  const top10 = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [person, count] of top10) {
    const bar = '█'.repeat(Math.min(count, 20));
    msg += `- **${person}**: ${count} 项 ${bar}\n`;
  }

  // 有截止日期且即将到期的
  const urgent = pending.filter(t => t.deadline && t.deadline.match(/3\.1[6-9]|3\.2[0-2]/));
  if (urgent.length > 0) {
    msg += `\n### ⚠️ 近期截止任务\n\n`;
    for (const t of urgent.slice(0, 10)) {
      msg += `- ⏰**${t.deadline}** ${t.content.slice(0, 50)} → ${t.assignees.join('、')}\n`;
    }
  }

  return msg;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const personIdx = args.indexOf('--person');
  const deptIdx = args.indexOf('--dept');

  const tasks = loadTasks();
  console.log(`📄 加载 ${tasks.length} 个任务\n`);

  let message;
  let title;

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
    console.log('没有待办任务需要催办');
    return;
  }

  console.log(message);

  if (dryRun) {
    console.log('\n--- [dry-run] 消息未发送 ---');
  } else {
    await sendDingTalk(title, message);
  }
}

main().catch(e => console.error('错误:', e.message));
