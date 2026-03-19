#!/usr/bin/env node
/**
 * ClawdBot 报送工具（v6 - 每天一次晚间推送）
 *
 * 用法：
 *   --send [备注]      发送当日小结到群（表格图片+文字）
 *   --test             连通性测试
 *   --dry-run          预览不发送
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const messageTemplates = require('../src/modules/message-templates');
const taskParser = require('../src/modules/task-parser');
const chartGenerator = require('../src/modules/chart-generator');
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

// ========== 核心：发送当日小结 ==========

async function cmdSend(taskData, extraNotes, dryRun) {
  console.log('\n📊 当日小结');
  console.log('═'.repeat(40));

  // 1. 生成表格图片
  console.log('  生成总览表格...');
  const tableBuf = await chartGenerator.dailySummaryTable(taskData);
  let chartUrl = '';
  if (tableBuf) {
    // 保存本地
    const chartsDir = path.join(__dirname, '..', 'data', 'charts');
    if (!fs.existsSync(chartsDir)) fs.mkdirSync(chartsDir, { recursive: true });
    fs.writeFileSync(path.join(chartsDir, 'daily-table.png'), tableBuf);
    console.log('  本地: data/charts/daily-table.png');

    // 上传OSS
    try {
      chartUrl = await chartGenerator.uploadToOss(tableBuf, 'daily-table');
      if (chartUrl) console.log(`  图片: ${chartUrl}`);
    } catch (e) { console.log(`  OSS上传失败: ${e.message}`); }
  }

  // 2. 构建消息（图片+文字，不含任何外部链接）
  const { title, text } = messageTemplates.generateDailyReport(taskData, chartUrl, extraNotes);

  console.log('─'.repeat(40));
  console.log(text);
  console.log('─'.repeat(40));

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

  console.log('════════════════════════════════════════');
  console.log('  ClawdBot 报送工具 v6');
  console.log('════════════════════════════════════════');

  if (dryRun) console.log('  ⚡ 预览模式\n');

  // 连通测试
  if (args.includes('--test')) {
    console.log('\n发送测试消息...');
    const ok = await sendToGroup('连通测试', '## ✅ ClawdBot 连通测试成功\n\n报送系统就绪');
    process.exit(ok ? 0 : 1);
  }

  // 加载数据
  const taskData = loadTaskData();
  if (!taskData || !taskData.departments?.length) {
    console.log('\n没有找到任务数据。请先把文档数据放到 data/latest-tasks.json');
    process.exit(1);
  }

  const { summary } = taskData;
  console.log(`已加载: ${summary.totalTasks}事项 ${taskData.departments.length}部门\n`);

  // --send [备注]
  if (args.includes('--send')) {
    const sendIdx = args.indexOf('--send');
    const notes = args.slice(sendIdx + 1).filter(a => !a.startsWith('--')).join(' ');
    await cmdSend(taskData, notes, dryRun);
  } else {
    // 默认就是发送
    await cmdSend(taskData, '', dryRun);
  }
}

main().catch(e => {
  console.error('运行错误:', e.message);
  process.exit(1);
});
