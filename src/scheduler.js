/**
 * 定时任务调度器（v4 - 三次推送体系）
 *
 * 工作流：
 *   09:30  数据刷新（从钉钉文档拉取）
 *   10:00  早晨总览 → 群（总览图+可滚动表格链接）
 *   14:00  下午核查 → 群（今日到期事项+@部门负责人）
 *   19:00  晚间日报 → 群（当日完成情况小结）
 *   周五19:00 → 周回顾替代日报
 */
const cron = require('node-cron');
const dayjs = require('dayjs');
const config = require('./config');
const dingtalk = require('./modules/dingtalk-client');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const messageTemplates = require('./modules/message-templates');
const chartGenerator = require('./modules/chart-generator');
const dashboardHtml = require('./modules/dashboard-html');
const ossUploader = require('./modules/oss-uploader');
const dataStore = require('./modules/data-store');
const logger = require('./utils/logger');

/**
 * 数据刷新：从钉钉文档拉取最新任务数据
 */
async function refreshData() {
  logger.info('🔄 刷新任务数据...');
  try {
    const docContent = await dingtalk.getDocContent();
    const rawText = typeof docContent === 'string' ? docContent : JSON.stringify(docContent);

    let taskData = taskParser.parseDocContent(rawText);

    if (taskData.summary.totalTasks === 0 || taskData.departments.length === 0) {
      logger.info('正则解析为空，启用AI提取...');
      const aiExtracted = await aiAnalyzer.extractTasksFromRawText(rawText);
      if (aiExtracted && aiExtracted.summary.totalTasks > 0) {
        taskData = aiExtracted;
      }
    }

    dataStore.saveLatestTasks(taskData);
    logger.info(`✓ 数据已更新: ${taskData.summary.totalTasks}事项 ${taskData.departments.length}部门`);
    return taskData;
  } catch (err) {
    logger.error(`数据刷新失败: ${err.message}`);
    return null;
  }
}

/**
 * 上传可滚动表格到OSS
 */
async function uploadTable(taskData) {
  try {
    const html = dashboardHtml.generateScrollableTable(taskData);
    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const key = `table/${date}/detail-${time}.html`;
    return await ossUploader.uploadFile(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  } catch (err) {
    logger.warn(`表格上传失败: ${err.message}`);
    return '';
  }
}

/**
 * 上传总览图到OSS
 */
async function uploadChart(taskData, name = 'overview') {
  try {
    const buf = await chartGenerator.overviewChart(taskData);
    if (!buf) return '';
    return await chartGenerator.uploadToOss(buf, name);
  } catch (err) {
    logger.warn(`图表上传失败: ${err.message}`);
    return '';
  }
}

// ═══ 10:00 早晨总览 ═══

async function sendMorningSummary() {
  logger.info('☀️  发送早晨总览...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const chartUrl = await uploadChart(taskData, 'morning');
  const tableUrl = await uploadTable(taskData);
  const { title, text } = messageTemplates.generateMorningSummary(taskData, tableUrl);

  let msgText = text;
  if (chartUrl) msgText = `![总览](${chartUrl})\n\n${text}`;

  if (tableUrl) {
    await dingtalk.sendActionCard(title, msgText, '📋 查看明细表（可左右滑动）', tableUrl);
  } else {
    await dingtalk.sendRobotMessage(title, msgText);
  }
  logger.info('✓ 早晨总览已发送');
}

// ═══ 14:00 下午核查 ═══

async function sendAfternoonCheck() {
  logger.info('🔍 发送下午核查...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const result = messageTemplates.generateAfternoonCheck(taskData);
  await dingtalk.sendRobotMessage(result.title, result.text);

  // 私聊各部门负责人
  if (result.items && result.items.length > 0) {
    const deptOwners = {};
    for (const item of result.items) {
      if (item.deptOwner) {
        if (!deptOwners[item.dept]) deptOwners[item.dept] = { owner: item.deptOwner, tasks: [] };
        deptOwners[item.dept].tasks.push(item);
      }
    }

    for (const [dept, info] of Object.entries(deptOwners)) {
      const reminder = messageTemplates.generateDeptReminder(dept, info.tasks);
      // 通过群机器人@部门负责人
      await dingtalk.sendRobotMessage(reminder.title, reminder.text, [info.owner]);
      logger.info(`已@${info.owner}（${dept}）`);
    }
  }

  logger.info('✓ 下午核查已发送');
}

// ═══ 19:00 晚间日报 ═══

async function sendEveningSummary() {
  logger.info('🌙 发送晚间日报...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const chartUrl = await uploadChart(taskData, 'evening');
  const tableUrl = await uploadTable(taskData);
  const { title, text } = messageTemplates.generateEveningSummary(taskData, tableUrl);

  let msgText = text;
  if (chartUrl) msgText = `![总览](${chartUrl})\n\n${text}`;

  if (tableUrl) {
    await dingtalk.sendActionCard(title, msgText, '📋 查看完整明细', tableUrl);
  } else {
    await dingtalk.sendRobotMessage(title, msgText);
  }
  logger.info('✓ 晚间日报已发送');
}

// ═══ 周五回顾 ═══

async function sendWeeklyReview() {
  logger.info('📅 发送周回顾...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) return;

  const { title, text } = messageTemplates.generateWeeklyReview(taskData);
  await dingtalk.sendRobotMessage(title, text);
  logger.info('✓ 周回顾已发送');
}

/**
 * 启动定时任务
 */
function startScheduler() {
  logger.info('=== ClawdBot 报送系统启动 (v4 三次推送体系) ===');

  // 09:30 数据刷新
  cron.schedule('30 9 * * 1-5', () => {
    refreshData().catch(e => logger.error(`数据刷新失败: ${e.message}`));
  });
  logger.info('已注册: 09:30 数据刷新');

  // 10:00 早晨总览
  cron.schedule('0 10 * * 1-5', () => {
    sendMorningSummary().catch(e => logger.error(`早晨总览失败: ${e.message}`));
  });
  logger.info('已注册: 10:00 早晨总览');

  // 14:00 下午核查
  cron.schedule('0 14 * * 1-5', () => {
    sendAfternoonCheck().catch(e => logger.error(`下午核查失败: ${e.message}`));
  });
  logger.info('已注册: 14:00 下午核查');

  // 19:00 晚间日报（周五→周回顾）
  cron.schedule('0 19 * * 1-4', () => {
    sendEveningSummary().catch(e => logger.error(`晚间日报失败: ${e.message}`));
  });
  logger.info('已注册: 19:00 晚间日报（周一至周四）');

  cron.schedule('0 19 * * 5', () => {
    sendWeeklyReview().catch(e => logger.error(`周回顾失败: ${e.message}`));
  });
  logger.info('已注册: 周五19:00 周回顾');

  logger.info('所有定时任务已注册');
}

/**
 * 手动执行全流程
 */
async function runFullCycle(mode = 'manual') {
  logger.info(`====== 手动执行 (${mode}) ======`);
  const taskData = await refreshData();
  if (!taskData) return { success: false, error: '数据刷新失败' };

  await sendMorningSummary();
  return { success: true, taskData };
}

module.exports = { runFullCycle, startScheduler, refreshData };
