#!/usr/bin/env node
/**
 * ClawdBot 报送工具（v8 - 钉钉互动卡片，支持手动编辑）
 *
 * 用法：
 *   --generate          从数据生成 data/daily-report.json（你可以手动编辑调整）
 *   --send              读取 data/daily-report.json 发送互动卡片到群
 *   --generate --send   生成后直接发送（不需要手动调整时用）
 *   --test              连通性测试
 *   --dry-run           搭配任何命令，只预览不发送
 *
 * 典型流程：
 *   1. node scripts/local-send.js --generate
 *   2. 打开 data/daily-report.json，手动修改内容（改数字、删事项、加备注）
 *   3. node scripts/local-send.js --send
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const cardBuilder = require('../src/modules/card-builder');
const taskParser = require('../src/modules/task-parser');
const config = require('../src/config');

const REPORT_FILE = path.join(__dirname, '..', 'data', 'daily-report.json');

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

// ========== 步骤一：生成卡片数据文件 ==========

function cmdGenerate(taskData) {
  console.log('\n📝 生成卡片数据...');

  const cardParamMap = cardBuilder.buildDailySummary(taskData);

  // 写入可编辑的JSON文件
  const reportData = {
    _说明: '你可以编辑下面的内容，改完后运行: node scripts/local-send.js --send',
    _模板ID: config.dingtalk.cardTemplateId || '未配置',
    cardParamMap,
  };

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(reportData, null, 2), 'utf-8');

  console.log(`  ✓ 已生成: data/daily-report.json`);
  console.log(`  → 你可以打开编辑，调整后运行: node scripts/local-send.js --send\n`);

  // 打印预览
  console.log('─'.repeat(50));
  console.log(`标题: ${cardParamMap.title}`);
  console.log(`总览: 共${cardParamMap.totalCount}项 完成${cardParamMap.doneCount} 待办${cardParamMap.pendingCount} 达成率${cardParamMap.rate}`);
  if (cardParamMap.hasAlert === 'true') {
    console.log(`⚠ 异常: ${cardParamMap.alertText}`);
  }
  console.log('');
  console.log('部门明细:');
  console.log(cardParamMap.deptMarkdown);
  console.log('─'.repeat(50));

  return cardParamMap;
}

// ========== 步骤二：读取文件并发送互动卡片 ==========

async function cmdSend(dryRun) {
  console.log('\n📤 发送互动卡片...');

  if (!fs.existsSync(REPORT_FILE)) {
    console.error('  ✗ 文件不存在: data/daily-report.json');
    console.error('  → 请先运行: node scripts/local-send.js --generate');
    return false;
  }

  const reportData = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const cardParamMap = reportData.cardParamMap;

  if (!cardParamMap) {
    console.error('  ✗ JSON格式不对，缺少 cardParamMap');
    return false;
  }

  // 检查必要配置
  const templateId = config.dingtalk.cardTemplateId;
  const conversationId = config.dingtalk.openConversationId;

  if (!templateId) {
    console.error('  ✗ 未配置 DINGTALK_CARD_TEMPLATE_ID');
    return false;
  }
  if (!conversationId) {
    console.error('  ✗ 未配置 DINGTALK_OPEN_CONVERSATION_ID');
    return false;
  }

  // 预览
  console.log('─'.repeat(50));
  console.log(`标题: ${cardParamMap.title}`);
  console.log(`模板: ${templateId}`);
  console.log(`群会话: ${conversationId}`);
  console.log(`总览: 共${cardParamMap.totalCount}项 完成${cardParamMap.doneCount} 待办${cardParamMap.pendingCount} 达成率${cardParamMap.rate}`);
  if (cardParamMap.hasAlert === 'true') {
    console.log(`⚠ 异常: ${cardParamMap.alertText}`);
  }
  console.log('');
  console.log('部门明细:');
  console.log(cardParamMap.deptMarkdown);
  console.log('─'.repeat(50));

  if (dryRun) {
    console.log('  (预览模式，未发送)');
    return true;
  }

  // 发送互动卡片
  const dingtalk = require('../src/modules/dingtalk-client');
  const outTrackId = `daily-${dayjs().format('YYYY-MM-DD-HHmmss')}`;

  const result = await dingtalk.sendInteractiveCard(
    templateId,
    outTrackId,
    cardParamMap,
    { openConversationId: conversationId }
  );

  if (result.success) {
    console.log(`  ✓ 互动卡片发送成功 (trackId: ${outTrackId})`);
  } else {
    console.error(`  ✗ 发送失败: ${result.error}`);
    if (result.detail) {
      console.error(`  详情: ${JSON.stringify(result.detail)}`);
    }
  }

  return result.success;
}

// ========== 连通测试 ==========

async function cmdTest() {
  console.log('\n🔗 连通性测试...');

  const templateId = config.dingtalk.cardTemplateId;
  const conversationId = config.dingtalk.openConversationId;

  console.log(`  模板ID: ${templateId || '❌ 未配置'}`);
  console.log(`  群会话ID: ${conversationId || '❌ 未配置'}`);
  console.log(`  AppKey: ${config.dingtalk.appKey ? '✓' : '❌ 未配置'}`);
  console.log(`  AppSecret: ${config.dingtalk.appSecret ? '✓' : '❌ 未配置'}`);

  if (!templateId || !conversationId) {
    console.error('\n  ✗ 配置不完整，请检查 .env 文件');
    return false;
  }

  const dingtalk = require('../src/modules/dingtalk-client');
  const outTrackId = `test-${Date.now()}`;

  const result = await dingtalk.sendInteractiveCard(
    templateId,
    outTrackId,
    {
      title: '连通测试',
      totalCount: '0',
      doneCount: '0',
      pendingCount: '0',
      rate: '0%',
      deptMarkdown: '测试消息 - ClawdBot 连通正常',
      hasAlert: 'false',
      alertText: '',
      updateTime: dayjs().format('HH:mm'),
    },
    { openConversationId: conversationId }
  );

  if (result.success) {
    console.log('  ✓ 互动卡片连通测试成功');
  } else {
    console.error(`  ✗ 测试失败: ${result.error}`);
  }

  return result.success;
}

// ========== 主逻辑 ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doGenerate = args.includes('--generate');
  const doSend = args.includes('--send');

  console.log('════════════════════════════════════════');
  console.log('  ClawdBot 报送工具 v8（互动卡片）');
  console.log('════════════════════════════════════════');

  if (dryRun) console.log('  ⚡ 预览模式');

  // 连通测试
  if (args.includes('--test')) {
    const ok = await cmdTest();
    process.exit(ok ? 0 : 1);
  }

  // 帮助
  if (!doGenerate && !doSend && !args.includes('--test')) {
    console.log(`
  用法:
    --generate          生成卡片数据到 data/daily-report.json（可手动编辑）
    --send              读取 data/daily-report.json 发送互动卡片到群
    --generate --send   生成后直接发送
    --dry-run           搭配使用，只预览不发送
    --test              互动卡片连通性测试

  典型流程:
    1. node scripts/local-send.js --generate
    2. 打开 data/daily-report.json 手动调整数字/事项
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
    cmdGenerate(taskData);
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
