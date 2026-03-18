#!/usr/bin/env node
/**
 * 本地快捷发送工具（v2 - 支持4种消息模板）
 *
 * 用法：
 *   node scripts/local-send.js                    # 发送全部消息（晨报+看板+催办）
 *   node scripts/local-send.js --morning          # 只发晨报焦点
 *   node scripts/local-send.js --dashboard        # 只发部门看板（图表）
 *   node scripts/local-send.js --urgent           # 只发催办提醒（逐条）
 *   node scripts/local-send.js --weekly           # 只发周回顾
 *   node scripts/local-send.js --test             # 发送测试消息（验证连通性）
 *   node scripts/local-send.js --dry-run          # 预览所有消息，不实际发送
 *   node scripts/local-send.js --file 文件路径     # 指定文档文件后发送
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 引入消息模板、任务解析器、图表生成器
const messageTemplates = require('../src/modules/message-templates');
const taskParser = require('../src/modules/task-parser');
const chartGenerator = require('../src/modules/chart-generator');

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
      console.log('  ✓ 发送成功!');
      return true;
    } else {
      console.error('  ✗ 发送失败:', res.data.errmsg);
      return false;
    }
  } catch (e) {
    console.error('  ✗ 发送异常:', e.response?.data || e.message);
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== 任务数据加载 ==========

/**
 * 加载 latest-tasks.json（结构化数据，含 departments）
 */
function loadLatestTasks() {
  const filepath = path.join(__dirname, '..', 'data', 'latest-tasks.json');
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

/**
 * 如果 latest-tasks.json 不存在，从 parsed-tasks.json 重建
 * 或从源文档重新解析
 */
function loadOrParseTaskData() {
  // 优先加载结构化数据
  let taskData = loadLatestTasks();
  if (taskData && taskData.departments) return taskData;

  // 尝试从源文档重新解析
  const sourceFile = path.join(__dirname, '..', 'data', 'tasks-source.md');
  if (fs.existsSync(sourceFile)) {
    console.log('从源文档重新解析...');
    const rawText = fs.readFileSync(sourceFile, 'utf-8');
    taskData = taskParser.parseDocContent(rawText);
    // 保存为 latest-tasks.json
    const outPath = path.join(__dirname, '..', 'data', 'latest-tasks.json');
    fs.writeFileSync(outPath, JSON.stringify(taskData, null, 2));
    return taskData;
  }

  // 尝试运行解析脚本
  console.log('未找到结构化数据，尝试解析文档...');
  try {
    require('./parse-tasks');
    return loadLatestTasks();
  } catch (e) {
    console.error('解析失败:', e.message);
    return null;
  }
}

// ========== 消息发送函数 ==========

/**
 * 发送晨报焦点（半屏，只看异常）
 */
async function sendMorningBrief(taskData, dryRun) {
  console.log('\n📧 [1] 晨报焦点');
  console.log('─'.repeat(40));
  const { title, text } = messageTemplates.generateMorningBrief(taskData);
  console.log(text);
  console.log('─'.repeat(40));
  if (!dryRun) {
    return sendDingTalk(title, text);
  }
  return true;
}

/**
 * 发送部门看板（高清图表 + OSS）
 */
async function sendDashboard(taskData, dryRun) {
  console.log('\n📊 [2] 部门看板（生成高清图表中...）');
  console.log('─'.repeat(40));

  // 生成图表并上传 OSS
  let chartUrls = {};
  try {
    chartUrls = await chartGenerator.generateAll(taskData);
    const uploaded = Object.keys(chartUrls).filter(k => chartUrls[k]);
    console.log(`  图表生成: ${uploaded.length}张已上传 OSS`);
    if (chartUrls.deptBarUrl) console.log(`  条形图: ${chartUrls.deptBarUrl}`);
    if (chartUrls.healthChartUrl) console.log(`  异常图: ${chartUrls.healthChartUrl}`);
  } catch (e) {
    console.log(`  图表生成失败: ${e.message}（消息将不含图片）`);
  }

  const { title, text } = messageTemplates.generateDashboard(taskData, chartUrls);
  console.log(text);
  console.log('─'.repeat(40));
  if (!dryRun) {
    return sendDingTalk(title, text);
  }
  return true;
}

/**
 * 发送催办提醒（逐条独立发送，最多5条）
 */
async function sendUrgentAlerts(taskData, dryRun) {
  console.log('\n🔔 [3] 催办提醒（逐条）');
  console.log('─'.repeat(40));
  const alerts = messageTemplates.generateUrgentAlerts(taskData);

  if (alerts.length === 0) {
    console.log('  当前无逾期或阻塞事项，跳过催办。');
    return true;
  }

  console.log(`  共 ${alerts.length} 条催办，发送前 ${Math.min(alerts.length, 5)} 条：\n`);
  const toSend = alerts.slice(0, 5);

  for (let i = 0; i < toSend.length; i++) {
    const alert = toSend[i];
    console.log(`  [${i + 1}/${toSend.length}] ${alert.dept} · ${alert.owner}`);
    console.log(alert.text);
    console.log('');

    if (!dryRun) {
      await sendDingTalk(alert.title, alert.text);
      if (i < toSend.length - 1) {
        console.log('  (等待2秒避免频率限制...)');
        await sleep(2000);
      }
    }
  }

  if (alerts.length > 5) {
    console.log(`  ⚠️ 还有 ${alerts.length - 5} 条催办未发送（防止刷屏）`);
  }
  console.log('─'.repeat(40));
  return true;
}

/**
 * 发送周回顾（高清图表 + OSS）
 */
async function sendWeeklyReview(taskData, dryRun) {
  console.log('\n📅 [4] 周回顾（生成高清图表中...）');
  console.log('─'.repeat(40));

  let chartUrls = {};
  try {
    chartUrls = await chartGenerator.generateAll(taskData);
    console.log(`  图表已生成并上传`);
  } catch (e) {
    console.log(`  图表生成失败: ${e.message}`);
  }

  const { title, text } = messageTemplates.generateWeeklyReview(taskData, null, chartUrls);
  console.log(text);
  console.log('─'.repeat(40));
  if (!dryRun) {
    return sendDingTalk(title, text);
  }
  return true;
}

// ========== 主逻辑 ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const testMode = args.includes('--test');
  const fileIdx = args.indexOf('--file');

  // 消息类型选择
  const sendMorning = args.includes('--morning');
  const sendDash = args.includes('--dashboard');
  const sendUrg = args.includes('--urgent');
  const sendWeek = args.includes('--weekly');
  const sendAll = !sendMorning && !sendDash && !sendUrg && !sendWeek;

  console.log('========================================');
  console.log('  ClawdBot 催办发送工具 v2');
  console.log('  4种消息模板 · 图表+分条发送');
  console.log('========================================');

  if (dryRun) {
    console.log('\n  ⚡ 预览模式（不实际发送）\n');
  }

  // 测试模式 - 验证连通性
  if (testMode) {
    console.log('\n发送测试消息...');
    const ok = await sendDingTalk(
      '连通测试',
      '## ✅ ClawdBot 连通测试\n\n催办系统连通测试成功！\n\n4种消息模板已就绪：晨报 · 看板 · 催办 · 周报'
    );
    process.exit(ok ? 0 : 1);
  }

  // 如果指定了文件，先导入并解析
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const srcFile = args[fileIdx + 1];
    if (!fs.existsSync(srcFile)) {
      console.error(`文件不存在: ${srcFile}`);
      process.exit(1);
    }
    const destDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const basename = path.basename(srcFile);
    const destRoot = path.join(__dirname, '..', basename);
    fs.copyFileSync(srcFile, destRoot);
    console.log(`\n已导入文档: ${basename}`);

    // 重新解析
    console.log('解析文档中...');
    try {
      require('./parse-tasks');
    } catch (e) {
      console.error('解析失败:', e.message);
      process.exit(1);
    }
  }

  // 加载结构化任务数据
  const taskData = loadOrParseTaskData();
  if (!taskData || !taskData.departments || taskData.departments.length === 0) {
    console.log('\n没有找到任务数据。');
    console.log('请先运行 node scripts/parse-tasks.js 或使用 --file 指定文件路径。');
    console.log('\n示例: node scripts/local-send.js --file ~/Downloads/3月任务.md');
    process.exit(1);
  }

  const { summary } = taskData;
  console.log(`\n已加载: ${summary.totalTasks} 个任务 (${taskData.departments.length} 个部门)`);
  console.log(`  待完成: ${summary.totalTasks - summary.completedTasks} | 已完成: ${summary.completedTasks}`);
  console.log(`  推进中: ${summary.inProgressTasks} | 催办中: ${summary.pendingResponseTasks} | 阻塞: ${summary.blockedTasks}`);

  // 按选择发送消息
  let successCount = 0;
  let totalCount = 0;

  if (sendAll || sendMorning) {
    totalCount++;
    if (await sendMorningBrief(taskData, dryRun)) successCount++;
    if (!dryRun && sendAll) await sleep(2000);
  }

  if (sendAll || sendDash) {
    totalCount++;
    if (await sendDashboard(taskData, dryRun)) successCount++;
    if (!dryRun && sendAll) await sleep(2000);
  }

  if (sendAll || sendUrg) {
    totalCount++;
    if (await sendUrgentAlerts(taskData, dryRun)) successCount++;
    if (!dryRun && sendAll) await sleep(2000);
  }

  if (sendWeek) {
    totalCount++;
    if (await sendWeeklyReview(taskData, dryRun)) successCount++;
  }

  // 总结
  console.log('\n========================================');
  if (dryRun) {
    console.log(`  预览完成（${totalCount} 条消息）`);
    console.log('  去掉 --dry-run 参数即可实际发送');
  } else {
    console.log(`  发送完成: ${successCount}/${totalCount} 成功`);
    console.log('  请检查钉钉群是否收到消息');
  }
  console.log('========================================');
}

main().catch(e => {
  console.error('运行错误:', e.message);
  process.exit(1);
});
