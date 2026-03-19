#!/usr/bin/env node
/**
 * 本地快捷发送工具（v3 - 支持5种消息模板）
 *
 * 用法：
 *   node scripts/local-send.js --preview-all      # ⭐ 一次发全部5种消息到群，方便对比样式
 *   node scripts/local-send.js                    # 发送日常消息（晨报+看板+明细+催办）
 *   node scripts/local-send.js --morning          # 只发 [1/5] 晨报焦点
 *   node scripts/local-send.js --dashboard        # 只发 [2/5] 部门看板 ActionCard
 *   node scripts/local-send.js --detail           # 只发 [3/5] 事项明细表
 *   node scripts/local-send.js --urgent           # 只发 [4/5] 催办提醒（逐条）
 *   node scripts/local-send.js --weekly           # 只发 [5/5] 周五回顾
 *   node scripts/local-send.js --card              # 发送钉钉互动卡片（原生嵌入式）
 *   node scripts/local-send.js --card morning      # 互动卡片-晨报焦点
 *   node scripts/local-send.js --card weekly        # 互动卡片-周回顾
 *   node scripts/local-send.js --test             # 发送测试消息（验证连通性）
 *   node scripts/local-send.js --dry-run          # 预览所有消息，不实际发送
 *   node scripts/local-send.js --file 文件路径     # 指定文档文件后发送
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 引入消息模板、任务解析器、图表生成器、HTML看板
const messageTemplates = require('../src/modules/message-templates');
const taskParser = require('../src/modules/task-parser');
const chartGenerator = require('../src/modules/chart-generator');
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

async function sendDingTalk(title, content, msgtype = 'markdown', options = {}) {
  if (!WEBHOOK) {
    console.error('错误: 未配置 DINGTALK_ROBOT_WEBHOOK，请检查 .env 文件');
    return false;
  }

  const timestamp = Date.now();
  let url = WEBHOOK;
  if (SECRET) {
    url += `&timestamp=${timestamp}&sign=${sign(timestamp, SECRET)}`;
  }

  let body;
  if (msgtype === 'actionCard') {
    body = {
      msgtype: 'actionCard',
      actionCard: {
        title,
        text: content,
        singleTitle: options.btnTitle || '📊 查看完整看板',
        singleURL: options.btnUrl || '',
        btnOrientation: '0',
      },
    };
  } else if (msgtype === 'text') {
    body = { msgtype: 'text', text: { content } };
  } else {
    body = { msgtype: 'markdown', markdown: { title, text: content } };
  }

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
 * 发送部门看板（ActionCard + ECharts 交互式看板页面）
 */
async function sendDashboard(taskData, dryRun) {
  console.log('\n📊 [2] 部门看板（生成交互式看板...）');
  console.log('─'.repeat(40));

  const dayjs = require('dayjs');
  const today = dayjs();
  const { summary } = taskData;
  const totalPending = summary.totalTasks - summary.completedTasks;

  // 1. 生成看板 HTML → 直接上传 OSS（不要用 uploadReport，避免二次包装）
  let dashboardUrl = '';
  const html = dashboardHtml.generate(taskData);
  try {
    const dayjs = require('dayjs');
    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const objectKey = `dashboard/${date}/board-${time}.html`;
    dashboardUrl = await ossUploader.uploadFile(objectKey, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    console.log(`  看板页面已上传: ${dashboardUrl}`);
  } catch (e) {
    console.log(`  看板页面上传失败: ${e.message}`);
  }
  // 始终保存本地副本
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'dashboard.html'), html);
  console.log('  本地副本: data/dashboard.html');

  // 2. 生成图表并上传（用于 ActionCard 封面）
  let chartUrls = {};
  try {
    chartUrls = await chartGenerator.generateAll(taskData);
    console.log('  图表已生成并上传 OSS');
  } catch (e) {
    console.log(`  图表上传失败: ${e.message}`);
  }

  // 3. 构建 ActionCard 消息
  const dateStr = today.format('M/D');
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.day()];

  let cardText = `## 📊 ${dateStr} ${weekday} · 部门工作看板\n\n`;
  cardText += `**${totalPending}** 待办 · **${summary.completedTasks}** 已完成 · 🔴 ${summary.blockedTasks}阻塞 · 🟡 ${summary.pendingResponseTasks || 0}催办\n\n`;

  // 嵌入全部图表图片（暗色专业风格）
  if (chartUrls.deptBarUrl) cardText += `![](${chartUrls.deptBarUrl})\n\n`;
  if (chartUrls.statusPieUrl) cardText += `![](${chartUrls.statusPieUrl})\n\n`;
  if (chartUrls.completionRateUrl) cardText += `![](${chartUrls.completionRateUrl})\n\n`;
  if (chartUrls.healthChartUrl) cardText += `![](${chartUrls.healthChartUrl})\n\n`;

  // 异常摘要
  const problems = [];
  for (const dept of taskData.departments) {
    const blocked = (dept.tasks || []).filter(t => t.statusKey === 'blocked' && !t.isCompleted).length;
    const overdue = (dept.tasks || []).filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isBefore(today, 'day')).length;
    if (blocked > 0 || overdue > 0) {
      const issues = [];
      if (blocked) issues.push(`${blocked}阻塞`);
      if (overdue) issues.push(`${overdue}逾期`);
      problems.push(`${chartGenerator._shortName ? chartGenerator._shortName(dept.department) : dept.department.slice(0,4)}: ${issues.join('/')}`);
    }
  }
  if (problems.length > 0) {
    cardText += `**⚠️** ${problems.slice(0, 3).join(' · ')}\n\n`;
  }

  cardText += `---\n\n*🤖 AI 智能任务跟踪系统 · ${today.format('HH:mm')}*`;

  console.log(cardText);
  console.log('─'.repeat(40));

  if (!dryRun) {
    if (dashboardUrl) {
      // 发送 ActionCard（带"查看完整看板"按钮）
      return sendDingTalk(`${dateStr} 部门看板`, cardText, 'actionCard', {
        btnTitle: '📊 查看交互式看板',
        btnUrl: dashboardUrl,
      });
    } else {
      // 降级为普通 markdown
      return sendDingTalk(`${dateStr} 部门看板`, cardText);
    }
  }
  return true;
}

/**
 * 发送事项明细表（原生钉钉可滚动长列表）
 */
async function sendDetailTable(taskData, dryRun) {
  console.log('\n📋 [2.5] 事项明细表（原生滚动）');
  console.log('─'.repeat(40));
  const { title, text } = messageTemplates.generateDetailTable(taskData);
  console.log(text.slice(0, 500) + (text.length > 500 ? '\n...(省略)' : ''));
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

/**
 * 为 --preview-all 构建看板 ActionCard（带 [2/5] 标注）
 */
async function _buildDashboardForPreview(taskData, dryRun) {
  const dayjs = require('dayjs');
  const today = dayjs();
  const { summary } = taskData;
  const totalPending = summary.totalTasks - summary.completedTasks;

  // 生成看板HTML → 上传OSS
  let dashboardUrl = '';
  const html = dashboardHtml.generate(taskData);
  try {
    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const objectKey = `dashboard/${date}/preview-${time}.html`;
    dashboardUrl = await ossUploader.uploadFile(objectKey, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    console.log(`  看板页面已上传: ${dashboardUrl}`);
  } catch (e) {
    console.log(`  看板页面上传失败: ${e.message}`);
  }
  // 保存本地副本
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'dashboard.html'), html);

  // 生成图表
  let chartUrls = {};
  try {
    chartUrls = await chartGenerator.generateAll(taskData);
    console.log('  图表已生成');
  } catch (e) {
    console.log(`  图表生成失败: ${e.message}`);
  }

  // 构建 ActionCard
  const dashboard = messageTemplates.generateDashboard(taskData, chartUrls);
  const cardText = `## 📊 样式预览 [2/5] 部门看板 ActionCard\n\n> 触发时间：每工作日 18:00\n> 作用：全局概览+部门排行+异常明细\n> 底部按钮 → 打开交互式看板（5个G2Plot图表）\n\n---\n\n${dashboard.text}`;

  if (!dryRun) {
    if (dashboardUrl) {
      return sendDingTalk('[2/5] 部门看板', cardText, 'actionCard', {
        btnTitle: '📊 查看交互式看板（5个图表）',
        btnUrl: dashboardUrl,
      });
    } else {
      return sendDingTalk('[2/5] 部门看板', cardText);
    }
  } else {
    console.log(cardText.slice(0, 500));
    return true;
  }
}

/**
 * 发送钉钉互动卡片（原生嵌入式卡片，含图表）
 */
async function sendInteractiveCard(taskData, cardType, dryRun) {
  console.log(`\n🎴 互动卡片（${cardType}）`);
  console.log('─'.repeat(40));

  const cardTemplateId = config.dingtalk.cardTemplateId;
  if (!cardTemplateId) {
    console.error('  ✗ 未配置 DINGTALK_CARD_TEMPLATE_ID，请在 .env 中添加');
    return false;
  }

  // 1. 生成图表并上传OSS
  let chartUrls = {};
  if (cardType === 'dashboard' || cardType === 'weekly') {
    console.log('  生成图表中...');
    try {
      chartUrls = await chartGenerator.generateAll(taskData);
      const count = Object.keys(chartUrls).filter(k => chartUrls[k]).length;
      console.log(`  ✓ ${count}张图表已生成并上传OSS`);
    } catch (e) {
      console.log(`  ⚠ 图表生成失败: ${e.message}（将发送纯文字卡片）`);
    }
  }

  // 2. 生成卡片数据（含图表URL）
  const cardData = messageTemplates.generateCardData(taskData, cardType, chartUrls);
  console.log(`  标题: ${cardData.title}`);
  console.log(`  内容预览:\n${cardData.content.slice(0, 600)}`);
  if (cardData.content.length > 600) console.log('  ...(省略)');
  console.log('─'.repeat(40));

  if (dryRun) {
    console.log('  (预览模式，不实际发送)');
    return true;
  }

  const outTrackId = `clawdbot-${cardType}-${Date.now()}`;
  const options = {};

  if (config.dingtalk.openConversationId) {
    options.openConversationId = config.dingtalk.openConversationId;
  }

  const result = await dingtalkClient.sendInteractiveCard(
    cardTemplateId,
    outTrackId,
    cardData,
    options
  );

  if (result.success) {
    console.log('  ✓ 互动卡片发送成功!');
    console.log(`  outTrackId: ${outTrackId}`);
    if (result.result) console.log(`  返回数据: ${JSON.stringify(result.result)}`);
  } else {
    console.error(`  ✗ 互动卡片发送失败: ${result.error}`);
    if (result.detail) console.error(`  详细错误: ${JSON.stringify(result.detail, null, 2)}`);
  }
  return result.success;
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
  const sendDetail = args.includes('--detail');
  const sendUrg = args.includes('--urgent');
  const sendWeek = args.includes('--weekly');
  const sendCard = args.includes('--card');
  const previewAll = args.includes('--preview-all');
  const sendAll = !sendMorning && !sendDash && !sendDetail && !sendUrg && !sendWeek && !sendCard && !previewAll;

  console.log('========================================');
  console.log('  ClawdBot 催办发送工具 v3');
  console.log('  5种消息模板 · 全量样式预览');
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

  // ========== --preview-all：一次发全部5种，每条带编号标注 ==========
  if (previewAll) {
    console.log('\n🎯 样式预览模式：将依次发送全部5种消息到钉钉群\n');
    console.log('  [1/5] 晨报焦点 ─ 每天10:00自动发');
    console.log('  [2/5] 部门看板 ─ 每天18:00自动发（ActionCard+交互式看板）');
    console.log('  [3/5] 事项明细表 ─ 原生可滚动长列表');
    console.log('  [4/5] 单项催办 ─ 每天14:00逐条发（仅发1条示例）');
    console.log('  [5/5] 周五回顾 ─ 每周五18:00替代看板\n');

    let ok = 0;

    // [1/5] 晨报焦点
    console.log('━'.repeat(50));
    console.log('📧 发送 [1/5] 晨报焦点...');
    const morning = messageTemplates.generateMorningBrief(taskData);
    const morningText = `## 📧 样式预览 [1/5] 晨报焦点\n\n> 触发时间：每工作日 10:00\n> 作用：半屏异常速览（逾期/阻塞/催办）\n\n---\n\n${morning.text}`;
    if (!dryRun) { if (await sendDingTalk('[1/5] 晨报焦点', morningText)) ok++; await sleep(3000); }
    else { console.log(morningText.slice(0, 400)); ok++; }

    // [2/5] 部门看板 ActionCard
    console.log('━'.repeat(50));
    console.log('📊 发送 [2/5] 部门看板 ActionCard...');
    const dashResult = await _buildDashboardForPreview(taskData, dryRun);
    if (dashResult) ok++;
    if (!dryRun) await sleep(3000);

    // [3/5] 事项明细表
    console.log('━'.repeat(50));
    console.log('📋 发送 [3/5] 事项明细表...');
    const detail = messageTemplates.generateDetailTable(taskData);
    const detailText = `## 📋 样式预览 [3/5] 事项明细表\n\n> 触发时间：按需（--detail）或可加入日常\n> 作用：全量待办清单，钉钉内原生滚动\n\n---\n\n${detail.text}`;
    if (!dryRun) { if (await sendDingTalk('[3/5] 事项明细表', detailText)) ok++; await sleep(3000); }
    else { console.log(detailText.slice(0, 400)); ok++; }

    // [4/5] 单项催办（只发1条示例）
    console.log('━'.repeat(50));
    console.log('🔔 发送 [4/5] 单项催办（示例1条）...');
    const alerts = messageTemplates.generateUrgentAlerts(taskData);
    if (alerts.length > 0) {
      const sampleAlert = alerts[0];
      const alertText = `## 🔔 样式预览 [4/5] 单项催办\n\n> 触发时间：每工作日 14:00（逐条发送，最多5条）\n> 作用：直接@负责人催办逾期/阻塞事项\n\n---\n\n${sampleAlert.text}`;
      if (!dryRun) { if (await sendDingTalk('[4/5] 单项催办', alertText)) ok++; await sleep(3000); }
      else { console.log(alertText.slice(0, 400)); ok++; }
    } else {
      console.log('  当前无催办事项');
    }

    // [5/5] 周五回顾
    console.log('━'.repeat(50));
    console.log('📅 发送 [5/5] 周五回顾...');
    const weekly = messageTemplates.generateWeeklyReview(taskData, null, {});
    const weeklyText = `## 📅 样式预览 [5/5] 周五回顾\n\n> 触发时间：每周五 18:00（替代当天部门看板）\n> 作用：本周成果/完成率排行/待推动事项\n\n---\n\n${weekly.text}`;
    if (!dryRun) { if (await sendDingTalk('[5/5] 周五回顾', weeklyText)) ok++; }
    else { console.log(weeklyText.slice(0, 400)); ok++; }

    console.log('\n' + '━'.repeat(50));
    console.log(`✅ 样式预览完成: ${ok}/5 条已发送`);
    console.log('请打开钉钉群查看全部5种消息样式');
    console.log('━'.repeat(50));
    return;
  }

  // ========== 常规发送 ==========
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

  if (sendAll || sendDetail) {
    totalCount++;
    if (await sendDetailTable(taskData, dryRun)) successCount++;
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

  if (sendCard) {
    // 确定卡片类型：--card 后面可跟 morning/weekly，默认 dashboard
    const cardIdx = args.indexOf('--card');
    const cardType = args[cardIdx + 1] && !args[cardIdx + 1].startsWith('--') ? args[cardIdx + 1] : 'dashboard';
    totalCount++;
    if (await sendInteractiveCard(taskData, cardType, dryRun)) successCount++;
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
