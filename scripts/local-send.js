#!/usr/bin/env node
/**
 * ClawdBot 报送工具（v5 - 三次推送体系）
 *
 * ═══ 每日三次推送 ═══
 *   --morning          早晨总览（总结图 + 可滚动表格链接）
 *   --check            下午核查（今日到期事项明细 + 私聊部门负责人）
 *   --evening [备注]   晚上日报（当日完成情况小结）
 *
 * ═══ 辅助命令 ═══
 *   --weekly           周五回顾
 *   --remind 部门名    催办指定部门（@负责人）
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

async function sendPrivate(userId, title, content) {
  const result = await dingtalkClient.sendWorkNotification(userId, title, content);
  if (result) console.log('  ✓ 私信发送成功');
  else console.error('  ✗ 私信发送失败');
  return result;
}

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

// ========== 公共：上传可滚动表格 ==========

async function uploadScrollableTable(taskData) {
  const dayjs = require('dayjs');
  const html = dashboardHtml.generateScrollableTable(taskData);

  // 保存本地
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'table.html'), html);
  console.log('  本地: data/table.html');

  // 上传OSS
  try {
    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const key = `table/${date}/detail-${time}.html`;
    const url = await ossUploader.uploadFile(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    console.log(`  表格已上传: ${url}`);
    return url;
  } catch (e) {
    console.log(`  OSS上传失败: ${e.message}（可用本地文件查看）`);
    return '';
  }
}

async function uploadDashboard(taskData) {
  const dayjs = require('dayjs');
  const html = dashboardHtml.generate(taskData);
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'dashboard.html'), html);

  try {
    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const key = `dashboard/${date}/board-${time}.html`;
    const url = await ossUploader.uploadFile(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    return url;
  } catch (e) {
    return '';
  }
}

// ========== 核心命令 ==========

/**
 * --morning: 早晨总览
 * 总览图（PNG）+ 文字概括 + 可滚动表格链接
 */
async function cmdMorning(taskData, dryRun) {
  console.log('\n☀️  早晨总览');
  console.log('═'.repeat(40));

  // 1. 生成总览图
  console.log('  生成总览图...');
  const chartBuf = await chartGenerator.overviewChart(taskData);
  let chartUrl = '';
  if (chartBuf) {
    const chartsDir = path.join(__dirname, '..', 'data', 'charts');
    if (!fs.existsSync(chartsDir)) fs.mkdirSync(chartsDir, { recursive: true });
    fs.writeFileSync(path.join(chartsDir, 'overview.png'), chartBuf);
    console.log('  本地: data/charts/overview.png');
    try {
      chartUrl = await chartGenerator.uploadToOss(chartBuf, 'overview');
      if (chartUrl) console.log(`  图片: ${chartUrl}`);
    } catch (e) { console.log(`  OSS上传失败: ${e.message}`); }
  }

  // 2. 生成可滚动表格
  console.log('  生成明细表格...');
  const tableUrl = await uploadScrollableTable(taskData);

  // 3. 构建消息
  const { title, text } = messageTemplates.generateMorningSummary(taskData, tableUrl);
  let msgText = text;
  if (chartUrl) {
    msgText = `![总览](${chartUrl})\n\n${text}`;
  }

  console.log('─'.repeat(40));
  console.log(msgText);
  console.log('─'.repeat(40));

  if (dryRun) return true;

  if (tableUrl) {
    return sendActionCard(title, msgText, '📋 查看明细表（可左右滑动）', tableUrl);
  }
  return sendToGroup(title, msgText);
}

/**
 * --check: 下午核查
 * 推送今日到期事项到群 + 可选私聊各部门负责人
 */
async function cmdCheck(taskData, dryRun) {
  console.log('\n🔍 下午核查');
  console.log('═'.repeat(40));

  const result = messageTemplates.generateAfternoonCheck(taskData);

  console.log(result.text);
  console.log('─'.repeat(40));

  if (dryRun) {
    if (result.items && result.items.length > 0) {
      // 展示哪些部门负责人会收到私聊
      const deptOwners = {};
      for (const item of result.items) {
        if (item.deptOwner) {
          if (!deptOwners[item.dept]) deptOwners[item.dept] = { owner: item.deptOwner, tasks: [] };
          deptOwners[item.dept].tasks.push(item);
        }
      }
      if (Object.keys(deptOwners).length > 0) {
        console.log('\n  将私聊以下部门负责人：');
        for (const [dept, info] of Object.entries(deptOwners)) {
          console.log(`    ${dept} → ${info.owner}（${info.tasks.length}项）`);
        }
      }
    }
    console.log('  (预览模式)');
    return true;
  }

  // 发群消息
  await sendToGroup(result.title, result.text);

  // 私聊各部门负责人
  if (result.items && result.items.length > 0) {
    const deptOwners = {};
    for (const item of result.items) {
      if (item.deptOwner) {
        if (!deptOwners[item.dept]) deptOwners[item.dept] = { owner: item.deptOwner, tasks: [] };
        deptOwners[item.dept].tasks.push(item);
      }
    }

    const dayjs = require('dayjs');
    for (const [dept, info] of Object.entries(deptOwners)) {
      console.log(`\n  私聊 ${dept} → ${info.owner}...`);
      const reminder = messageTemplates.generateDeptReminder(dept, info.tasks);
      // 通过群机器人@对方（钉钉webhook支持atUserIds）
      if (!WEBHOOK) continue;
      const timestamp = Date.now();
      let url = WEBHOOK;
      if (SECRET) url += `&timestamp=${timestamp}&sign=${sign(timestamp, SECRET)}`;
      try {
        await axios.post(url, {
          msgtype: 'markdown',
          markdown: { title: reminder.title, text: reminder.text },
          at: { atUserIds: [info.owner], isAtAll: false },
        });
        console.log(`  ✓ 已@${info.owner}`);
      } catch (e) {
        console.log(`  ✗ 发送失败: ${e.message}`);
      }
    }
  }

  return true;
}

/**
 * --evening [备注]: 晚上日报
 * 当日完成情况总结 + 可滚动表格链接
 */
async function cmdEvening(taskData, extraNotes, dryRun) {
  console.log('\n🌙 晚间日报');
  console.log('═'.repeat(40));

  // 1. 生成总览图
  console.log('  生成总览图...');
  const chartBuf = await chartGenerator.overviewChart(taskData);
  let chartUrl = '';
  if (chartBuf) {
    const chartsDir = path.join(__dirname, '..', 'data', 'charts');
    if (!fs.existsSync(chartsDir)) fs.mkdirSync(chartsDir, { recursive: true });
    fs.writeFileSync(path.join(chartsDir, 'overview-evening.png'), chartBuf);
    try {
      chartUrl = await chartGenerator.uploadToOss(chartBuf, 'overview-evening');
      if (chartUrl) console.log(`  图片: ${chartUrl}`);
    } catch (e) { console.log(`  OSS上传失败: ${e.message}`); }
  }

  // 2. 生成表格
  console.log('  生成明细表格...');
  const tableUrl = await uploadScrollableTable(taskData);

  // 3. 构建消息
  const { title, text } = messageTemplates.generateEveningSummary(taskData, tableUrl, extraNotes);
  let msgText = text;
  if (chartUrl) {
    msgText = `![总览](${chartUrl})\n\n${text}`;
  }

  console.log('─'.repeat(40));
  console.log(msgText);
  console.log('─'.repeat(40));

  if (dryRun) return true;

  if (tableUrl) {
    return sendActionCard(title, msgText, '📋 查看完整明细', tableUrl);
  }
  return sendToGroup(title, msgText);
}

/**
 * --remind 部门名: 催办指定部门
 */
async function cmdRemind(taskData, deptName, dryRun) {
  console.log(`\n📌 催办 → ${deptName}`);
  console.log('─'.repeat(40));

  const dayjs = require('dayjs');
  const today = dayjs();
  const dept = taskData.departments.find(d =>
    d.department.includes(deptName) || d.department.replace(/\s+/g, '').includes(deptName)
  );
  if (!dept) {
    console.log(`  未找到部门「${deptName}」`);
    return false;
  }

  const items = (dept.tasks || []).filter(t => {
    if (t.isCompleted) return false;
    if (!t.deadline) return t.statusKey === 'blocked' || t.statusKey === 'pending_response';
    return dayjs(t.deadline).diff(today, 'day') <= 0;
  }).map(t => ({
    title: t.title,
    overdueDays: t.deadline ? Math.max(0, today.diff(dayjs(t.deadline), 'day')) : 0,
  }));

  if (items.length === 0) {
    console.log(`  ${deptName} 当前无紧急事项`);
    return true;
  }

  const shortName = dept.department.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 8);
  const reminder = messageTemplates.generateDeptReminder(shortName, items);
  console.log(reminder.text);

  if (dryRun) return true;
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

// ========== 兼容旧命令 ==========

async function cmdCard(taskData, dryRun) {
  return cmdMorning(taskData, dryRun);
}

// ========== 主逻辑 ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('════════════════════════════════════════');
  console.log('  ClawdBot 报送工具 v5（三次推送体系）');
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
  if (args.includes('--morning')) {
    await cmdMorning(taskData, dryRun);
  } else if (args.includes('--check')) {
    await cmdCheck(taskData, dryRun);
  } else if (args.includes('--evening')) {
    const evIdx = args.indexOf('--evening');
    const notes = args.slice(evIdx + 1).filter(a => !a.startsWith('--')).join(' ');
    await cmdEvening(taskData, notes, dryRun);
  } else if (args.includes('--card')) {
    // 兼容旧命令
    await cmdCard(taskData, dryRun);
  } else if (args.includes('--dashboard')) {
    console.log('\n📊 生成交互式看板...');
    const url = await uploadDashboard(taskData);
    console.log(`\n看板已生成:`);
    if (url) console.log(`  OSS: ${url}`);
    console.log(`  本地: data/dashboard.html`);
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
    console.log('每日三次推送：');
    console.log('  --morning          ☀️  早晨总览（大图+表格链接）');
    console.log('  --check            🔍 下午核查（到期事项+@部门负责人）');
    console.log('  --evening [备注]   🌙 晚间日报（完成情况+重点备注）');
    console.log('');
    console.log('辅助命令：');
    console.log('  --remind 部门名    催办指定部门');
    console.log('  --weekly           周五回顾');
    console.log('  --dashboard        生成交互式看板');
    console.log('  --test             连通性测试');
    console.log('  --dry-run          预览不发送');
    console.log('');
    console.log('示例：');
    console.log('  node scripts/local-send.js --morning --dry-run');
    console.log('  node scripts/local-send.js --check');
    console.log('  node scripts/local-send.js --evening 老板要求加速XX项目');
  }
}

main().catch(e => {
  console.error('运行错误:', e.message);
  process.exit(1);
});
