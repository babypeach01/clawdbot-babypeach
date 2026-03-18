/**
 * 预览 & 发送消息到钉钉群
 *
 * 用法:
 *   node scripts/preview-messages.js                  # 仅打印预览，不发送
 *   node scripts/preview-messages.js --send morning   # 发送晨报
 *   node scripts/preview-messages.js --send dashboard # 发送部门看板
 *   node scripts/preview-messages.js --send alerts    # 发送催办（逐条）
 *   node scripts/preview-messages.js --send weekly    # 发送周回顾
 *   node scripts/preview-messages.js --send all       # 全部发送（间隔3秒）
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const taskParser = require('../src/modules/task-parser');
const templates = require('../src/modules/message-templates');
const dingtalk = require('../src/modules/dingtalk-client');

function loadTaskData() {
  const sourcePath = path.join(__dirname, '..', 'data', 'tasks-source.md');
  if (!fs.existsSync(sourcePath)) {
    console.error('❌ 未找到 data/tasks-source.md');
    process.exit(1);
  }
  const source = fs.readFileSync(sourcePath, 'utf-8');
  return taskParser.parseDocContent(source);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessage(title, text) {
  const ok = await dingtalk.sendRobotMessage(title, text);
  if (ok) {
    console.log(`  ✅ 已发送: ${title}`);
  } else {
    console.log(`  ❌ 发送失败: ${title}`);
  }
  return ok;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldSend = args.includes('--send');
  const target = args[args.indexOf('--send') + 1] || 'all';

  const taskData = loadTaskData();
  console.log(`📄 加载 ${taskData.summary.totalTasks} 个任务, ${taskData.departments.length} 个部门\n`);

  // 1. 晨报
  const morning = templates.generateMorningBrief(taskData);
  console.log('━'.repeat(50));
  console.log('  📧 晨报 - 今日焦点');
  console.log('━'.repeat(50));
  console.log(morning.text);
  console.log('');

  // 2. 部门看板
  const dashboard = templates.generateDashboard(taskData, []);
  console.log('━'.repeat(50));
  console.log('  📧 部门看板');
  console.log('━'.repeat(50));
  console.log(dashboard.text);
  console.log('');

  // 3. 催办消息
  const alerts = templates.generateUrgentAlerts(taskData);
  console.log('━'.repeat(50));
  console.log(`  📧 催办消息 (共${alerts.length}条)`);
  console.log('━'.repeat(50));
  for (const alert of alerts.slice(0, 5)) {
    console.log(alert.text);
    console.log('---');
  }
  if (alerts.length > 5) console.log(`  ...还有${alerts.length - 5}条催办\n`);

  // 4. 周回顾
  const weekly = templates.generateWeeklyReview(taskData, []);
  console.log('━'.repeat(50));
  console.log('  📧 周回顾');
  console.log('━'.repeat(50));
  console.log(weekly.text);
  console.log('');

  // 发送
  if (!shouldSend) {
    console.log('━'.repeat(50));
    console.log('  以上为预览。要发送到钉钉群，请运行:');
    console.log('');
    console.log('  node scripts/preview-messages.js --send morning    # 发晨报');
    console.log('  node scripts/preview-messages.js --send dashboard  # 发看板');
    console.log('  node scripts/preview-messages.js --send alerts     # 发催办');
    console.log('  node scripts/preview-messages.js --send weekly     # 发周报');
    console.log('  node scripts/preview-messages.js --send all        # 全部发');
    console.log('━'.repeat(50));
    return;
  }

  console.log('\n🚀 开始发送...\n');

  if (target === 'morning' || target === 'all') {
    await sendMessage(morning.title, morning.text);
    if (target === 'all') await sleep(3000);
  }

  if (target === 'dashboard' || target === 'all') {
    await sendMessage(dashboard.title, dashboard.text);
    if (target === 'all') await sleep(3000);
  }

  if (target === 'alerts' || target === 'all') {
    // 催办只发前3条（避免刷屏）
    const toSend = alerts.slice(0, 3);
    for (const alert of toSend) {
      await sendMessage(alert.title, alert.text);
      await sleep(2000);
    }
    if (alerts.length > 3) {
      console.log(`  ⏭️ 跳过剩余${alerts.length - 3}条催办（防刷屏）`);
    }
  }

  if (target === 'weekly' || target === 'all') {
    await sendMessage(weekly.title, weekly.text);
  }

  console.log('\n✅ 发送完成');
}

main().catch(e => console.error('错误:', e.message));
