#!/usr/bin/env node
/**
 * ClawdBot 报送工具（v7 - 两步流程）
 *
 * 用法：
 *   --generate          从数据生成 data/daily-report.md，你可以手动编辑调整
 *   --send              读取 data/daily-report.md 发送到钉钉群
 *   --generate --send   生成后直接发送（不需要手动调整时用）
 *   --test              连通性测试
 *   --dry-run           搭配任何命令，只预览不发送
 *
 * 典型流程：
 *   1. node scripts/local-send.js --generate
 *   2. 打开 data/daily-report.md，手动修改内容
 *   3. node scripts/local-send.js --send
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const messageTemplates = require('../src/modules/message-templates');
const taskParser = require('../src/modules/task-parser');
const config = require('../src/config');

const WEBHOOK = process.env.DINGTALK_ROBOT_WEBHOOK;
const SECRET = process.env.DINGTALK_ROBOT_SECRET;
const REPORT_FILE = path.join(__dirname, '..', 'data', 'daily-report.md');

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
    if (res.data.errcode === 0) { console.log('  ✓ 发送成功'); return true; }
    console.error('  ✗ 失败:', res.data.errmsg);
    return false;
  } catch (e) {
    console.error('  ✗ 异常:', e.response?.data || e.message);
    return false;
  }
}

// ========== 数据加载 ==========

function loadTaskData() {
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

// ========== 步骤一：生成报告文件 ==========

function cmdGenerate(taskData, extraNotes) {
  console.log('\n📝 生成报告...');

  const { title, text } = messageTemplates.generateDailyReport(taskData, extraNotes);

  // 写入文件
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 文件头部加注释，方便用户知道怎么用
  const fileContent = [
    '<!-- ClawdBot 当日报告 -->',
    `<!-- 标题: ${title} -->`,
    '<!-- 你可以直接编辑下面的内容，调整后运行: node scripts/local-send.js --send -->',
    '',
    text,
  ].join('\n');

  fs.writeFileSync(REPORT_FILE, fileContent, 'utf-8');
  console.log(`  ✓ 已生成: data/daily-report.md`);
  console.log(`  → 你可以打开编辑，调整后运行: node scripts/local-send.js --send`);
  console.log('');
  console.log('─'.repeat(50));
  console.log(text);
  console.log('─'.repeat(50));

  return { title, text };
}

// ========== 步骤二：读取文件并发送 ==========

async function cmdSend(dryRun) {
  console.log('\n📤 发送报告...');

  if (!fs.existsSync(REPORT_FILE)) {
    console.error('  ✗ 文件不存在: data/daily-report.md');
    console.error('  → 请先运行: node scripts/local-send.js --generate');
    return false;
  }

  const raw = fs.readFileSync(REPORT_FILE, 'utf-8');

  // 解析标题（从注释中提取）
  const titleMatch = raw.match(/<!-- 标题: (.+?) -->/);
  const title = titleMatch ? titleMatch[1] : '当日小结';

  // 去掉HTML注释，只保留正文
  const text = raw
    .split('\n')
    .filter(line => !line.startsWith('<!--'))
    .join('\n')
    .trim();

  console.log('─'.repeat(50));
  console.log(text);
  console.log('─'.repeat(50));

  if (dryRun) {
    console.log('  (预览模式，未发送)');
    return true;
  }

  return sendToGroup(title, text);
}

// ========== 主逻辑 ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doGenerate = args.includes('--generate');
  const doSend = args.includes('--send');

  console.log('════════════════════════════════════════');
  console.log('  ClawdBot 报送工具 v7');
  console.log('════════════════════════════════════════');

  if (dryRun) console.log('  ⚡ 预览模式');

  // 连通测试
  if (args.includes('--test')) {
    console.log('\n发送测试消息...');
    const ok = await sendToGroup('连通测试', '## ✅ ClawdBot 连通测试成功');
    process.exit(ok ? 0 : 1);
  }

  // 没有指定操作时显示帮助
  if (!doGenerate && !doSend && !args.includes('--test')) {
    console.log(`
  用法:
    --generate          生成报告到 data/daily-report.md（可手动编辑）
    --send              读取 data/daily-report.md 发送到群
    --generate --send   生成后直接发送
    --dry-run           搭配使用，只预览不发送
    --test              连通性测试

  典型流程:
    1. node scripts/local-send.js --generate
    2. 打开 data/daily-report.md 手动调整
    3. node scripts/local-send.js --send
`);
    return;
  }

  // --generate
  if (doGenerate) {
    const taskData = loadTaskData();
    if (!taskData || !taskData.departments?.length) {
      console.log('\n没有任务数据。请先放数据到 data/latest-tasks.json');
      process.exit(1);
    }
    console.log(`已加载: ${taskData.summary.totalTasks}事项 ${taskData.departments.length}部门`);

    // 提取备注（--generate 后面的非flag参数）
    const genIdx = args.indexOf('--generate');
    const notes = args.slice(genIdx + 1).filter(a => !a.startsWith('--')).join(' ');
    cmdGenerate(taskData, notes);
  }

  // --send
  if (doSend) {
    await cmdSend(dryRun);
  }
}

main().catch(e => {
  console.error('运行错误:', e.message);
  process.exit(1);
});
