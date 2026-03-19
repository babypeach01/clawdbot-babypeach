#!/usr/bin/env node
/**
 * ClawdBot 报送工具（v4 - 总结汇报导向）
 *
 * 核心工作流：
 *   --card             ⭐ 发送宏观总结卡片到群（原生图表）
 *   --alert            ⭐ 发送重点事项预警到你私信
 *   --push [备注]      ⭐ 手动推送正式报告到群（经你审核后）
 *   --remind 部门名    催办指定部门（@负责人）
 *
 * 辅助命令：
 *   --weekly           周五回顾
 *   --test             连通性测试
 *   --dry-run          预览不发送
 *   --file 文件路径    指定文档源
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const messageTemplates = require('../src/modules/message-templates');
const taskParser = require('../src/modules/task-parser');
const dashboardHtml = require('../src/modules/dashboard-html');
const ossUploader = require('../src/modules/oss-uploader');
const dingtalkClient = require('../src/modules/dingtalk-client');
const config = require('../src/config');

const WEBHOOK = process.env.DINGTALK_ROBOT_WEBHOOK;
const SECRET = process.env.DINGTALK_ROBOT_SECRET;

// ========== 签名 & 发送 ==========

function sign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  return encodeURIComponent(
    crypto.createHmac('sha256', secret).update(stringToSign).digest('base64')
  );
}

async function sendToGroup(title, content) {
  if (!WEBHOOK) {
    console.error('  ✗ 未配置 DINGTALK_ROBOT_WEBHOOK');
    return false;
  }
  const timestamp = Date.now();
  let url = WEBHOOK;
  if (SECRET) url += `&timestamp=${timestamp}&sign=${sign(timestamp, SECRET)}`;

  try {
    const res = await axios.post(url, {
      msgtype: 'markdown',
      markdown: { title, text: content },
      at: { isAtAll: false },
    });
    if (res.data.errcode === 0) { console.log('  ✓ 群消息发送成功'); return true; }
    console.error('  ✗ 失败:', res.data.errmsg);
    return false;
  } catch (e) {
    console.error('  ✗ 异常:', e.response?.data || e.message);
    return false;
  }
}

async function sendPrivate(userId, title, content) {
  const result = await dingtalkClient.sendWorkNotification(userId, title, content);
  if (result) console.log('  ✓ 私信发送成功');
  else console.error('  ✗ 私信发送失败');
  return result;
}

async function sendActionCard(title, content, btnTitle, btnUrl) {
  if (!WEBHOOK) { console.error('  ✗ 未配置 WEBHOOK'); return false; }
  const timestamp = Date.now();
  let url = WEBHOOK;
  if (SECRET) url += `&timestamp=${timestamp}&sign=${sign(timestamp, SECRET)}`;
  try {
    const res = await axios.post(url, {
      msgtype: 'actionCard',
      actionCard: { title, text: content, singleTitle: btnTitle, singleURL: btnUrl, btnOrientation: '0' },
    });
    if (res.data.errcode === 0) { console.log('  ✓ ActionCard发送成功'); return true; }
    console.error('  ✗ 失败:', res.data.errmsg);
    return false;
  } catch (e) {
    console.error('  ✗ 异常:', e.response?.data || e.message);
    return false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 数据加载 ==========

function loadOrParseTaskData() {
  const filepath = path.join(__dirname, '..', 'data', 'latest-tasks.json');
  if (fs.existsSync(filepath)) {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (data && data.departments) return data;
  }
  const sourceFile = path.join(__dirname, '..', 'data', 'tasks-source.md');
  if (fs.existsSync(sourceFile)) {
    const rawText = fs.readFileSync(sourceFile, 'utf-8');
    const data = taskParser.parseDocContent(rawText);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return data;
  }
  return null;
}

// ========== 核心命令 ==========

/**
 * 生成看板HTML并上传OSS，返回URL
 */
async function uploadDashboard(taskData) {
  const dayjs = require('dayjs');
  const html = dashboardHtml.generate(taskData);

  // 保存本地副本
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'dashboard.html'), html);
  console.log('  本地副本: data/dashboard.html');

  // 上传OSS
  try {
    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const key = `dashboard/${date}/board-${time}.html`;
    const url = await ossUploader.uploadFile(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    console.log(`  看板已上传: ${url}`);
    return url;
  } catch (e) {
    console.log(`  OSS上传失败: ${e.message}（可用本地文件查看）`);
    return '';
  }
}

/**
 * --card: 每日总览 → 群
 * 一条ActionCard消息：紧凑总览 + "查看明细"按钮
 */
async function cmdCard(taskData, dryRun) {
  console.log('\n📊 每日总览 → 群');
  console.log('─'.repeat(40));

  // 生成看板并上传
  console.log('  生成看板...');
  const dashUrl = await uploadDashboard(taskData);

  // 生成紧凑总览消息
  const { title, text } = messageTemplates.generateDailySummary(taskData, dashUrl);
  console.log(text);
  console.log('─'.repeat(40));

  if (dryRun) return true;

  // 有看板链接 → ActionCard（带按钮）；无链接 → 普通Markdown
  if (dashUrl) {
    return sendActionCard(title, text, '📋 查看明细看板', dashUrl);
  }
  return sendToGroup(title, text);
}

/**
 * --alert: 重点事项预警 → 管理者私信
 */
async function cmdAlert(taskData, dryRun) {
  console.log('\n⚠️ 重点事项预警 → 你的私信');
  console.log('─'.repeat(40));

  const alertMsg = messageTemplates.generatePrivateAlert(taskData);
  if (!alertMsg) {
    console.log('  ✅ 当前无异常，不需要预警');
    return true;
  }

  console.log(alertMsg.text);
  console.log('─'.repeat(40));

  if (dryRun) {
    console.log('  (预览模式)');
    return true;
  }

  const adminUserId = config.alert.adminUserId;
  if (!adminUserId || adminUserId === 'your_admin_user_id') {
    console.error('  ✗ 未配置 ADMIN_USER_ID，无法发私信');
    console.log('  降级：发送到群');
    return sendToGroup(alertMsg.title, alertMsg.text);
  }

  return sendPrivate(adminUserId, alertMsg.title, alertMsg.text);
}

/**
 * --push [备注]: 正式闭环报送 → 群（管理者手动触发）
 */
async function cmdPush(taskData, notes, dryRun) {
  console.log('\n📋 正式报告 → 群（手动推送）');
  console.log('─'.repeat(40));

  const report = messageTemplates.generateFormalReport(taskData, notes);
  console.log(report.text);
  console.log('─'.repeat(40));

  if (dryRun) {
    console.log('  (预览模式)');
    return true;
  }

  return sendToGroup(report.title, report.text);
}

/**
 * --remind 部门名: 催办指定部门
 */
async function cmdRemind(taskData, deptName, dryRun) {
  console.log(`\n📌 催办 → ${deptName}`);
  console.log('─'.repeat(40));

  const reminder = messageTemplates.generateReminder(taskData, deptName);
  if (!reminder) {
    console.log(`  未找到部门「${deptName}」或该部门无异常事项`);
    return false;
  }

  console.log(reminder.text);
  console.log('─'.repeat(40));

  if (dryRun) {
    console.log('  (预览模式)');
    return true;
  }

  return sendToGroup(reminder.title, reminder.text);
}

/**
 * --weekly: 周五回顾
 */
async function cmdWeekly(taskData, dryRun) {
  console.log('\n📅 周五回顾');
  console.log('─'.repeat(40));

  const { title, text } = messageTemplates.generateWeeklyReview(taskData);
  console.log(text);

  if (dryRun) return true;
  return sendToGroup(title, text);
}

// ========== 主逻辑 ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('════════════════════════════════════════');
  console.log('  ClawdBot 报送工具 v4（总结汇报导向）');
  console.log('════════════════════════════════════════');

  if (dryRun) console.log('  ⚡ 预览模式\n');

  // 连通测试
  if (args.includes('--test')) {
    console.log('\n发送测试消息...');
    const ok = await sendToGroup('连通测试', '## ✅ ClawdBot 连通测试成功\n\n报送系统就绪');
    process.exit(ok ? 0 : 1);
  }

  // 文件导入
  const fileIdx = args.indexOf('--file');
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const srcFile = args[fileIdx + 1];
    if (!fs.existsSync(srcFile)) { console.error(`文件不存在: ${srcFile}`); process.exit(1); }
    const destDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcFile, path.join(__dirname, '..', path.basename(srcFile)));
    console.log(`已导入: ${path.basename(srcFile)}`);
    try { require('./parse-tasks'); } catch (e) { console.error('解析失败:', e.message); process.exit(1); }
  }

  // 加载数据
  const taskData = loadOrParseTaskData();
  if (!taskData || !taskData.departments?.length) {
    console.log('\n没有找到任务数据。用法: --file 文件路径');
    process.exit(1);
  }

  const { summary } = taskData;
  console.log(`已加载: ${summary.totalTasks}事项 ${taskData.departments.length}部门 | 待办${summary.totalTasks - summary.completedTasks} 完成${summary.completedTasks}\n`);

  // 执行命令
  if (args.includes('--dashboard')) {
    // 只生成看板，不发消息
    console.log('\n📊 生成交互式看板...');
    const url = await uploadDashboard(taskData);
    console.log('\n看板已生成:');
    if (url) console.log(`  OSS: ${url}`);
    console.log(`  本地: data/dashboard.html`);
    console.log('\n用浏览器打开查看，点击部门可展开任务明细');
    return;
  } else if (args.includes('--card')) {
    await cmdCard(taskData, dryRun);
  } else if (args.includes('--alert')) {
    await cmdAlert(taskData, dryRun);
  } else if (args.includes('--push')) {
    const pushIdx = args.indexOf('--push');
    const notes = args.slice(pushIdx + 1).filter(a => !a.startsWith('--')).join(' ');
    await cmdPush(taskData, notes, dryRun);
  } else if (args.includes('--remind')) {
    const remindIdx = args.indexOf('--remind');
    const deptName = args[remindIdx + 1];
    if (!deptName || deptName.startsWith('--')) {
      console.error('用法: --remind 部门名');
      process.exit(1);
    }
    await cmdRemind(taskData, deptName, dryRun);
  } else if (args.includes('--weekly')) {
    await cmdWeekly(taskData, dryRun);
  } else {
    // 无参数：显示帮助
    console.log('用法：');
    console.log('  --card             ⭐ 发送总结卡片+看板链接到群');
    console.log('  --dashboard        生成交互式看板（不发消息，本地查看）');
    console.log('  --alert            发送重点事项预警到你私信');
    console.log('  --push [备注]      手动推送正式报告到群');
    console.log('  --remind 部门名    催办指定部门（@负责人）');
    console.log('  --weekly           周五回顾');
    console.log('  --test             连通性测试');
    console.log('  --dry-run          预览不发送');
    console.log('\n看板功能：');
    console.log('  点击部门 → 展开任务明细');
    console.log('  ✓ 按钮 → 标记完成/未完成');
    console.log('  — 按钮 → 排除/纳入统计');
    console.log('  实时重算达成率');
  }
}

main().catch(e => {
  console.error('运行错误:', e.message);
  process.exit(1);
});
