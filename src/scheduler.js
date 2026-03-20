/**
 * 定时任务调度器（v5 - 每天一次晚间推送）
 *
 *   09:30  数据刷新（从钉钉文档拉取）
 *   19:00  当日小结 → 群（表格图片+简短文字，直接看完）
 *   周五19:00  周回顾替代日报
 */
const cron = require('node-cron');
const dayjs = require('dayjs');
const config = require('./config');
const dingtalk = require('./modules/dingtalk-client');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const messageTemplates = require('./modules/message-templates');
const dataStore = require('./modules/data-store');
const logger = require('./utils/logger');

async function refreshData() {
  logger.info('刷新任务数据...');
  try {
    const docContent = await dingtalk.getDocContent();
    const rawText = typeof docContent === 'string' ? docContent : JSON.stringify(docContent);
    let taskData = taskParser.parseDocContent(rawText);
    if (taskData.summary.totalTasks === 0 || taskData.departments.length === 0) {
      const aiExtracted = await aiAnalyzer.extractTasksFromRawText(rawText);
      if (aiExtracted && aiExtracted.summary.totalTasks > 0) taskData = aiExtracted;
    }
    dataStore.saveLatestTasks(taskData);
    logger.info(`数据已更新: ${taskData.summary.totalTasks}事项 ${taskData.departments.length}部门`);
    return taskData;
  } catch (err) {
    logger.error(`数据刷新失败: ${err.message}`);
    return null;
  }
}

async function sendDailyReport() {
  logger.info('发送当日小结...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const { title, text } = messageTemplates.generateDailyReport(taskData);
  await dingtalk.sendRobotMessage(title, text);
  logger.info('当日小结已发送');
}

async function sendWeeklyReview() {
  logger.info('发送周回顾...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) return;
  const { title, text } = messageTemplates.generateWeeklyReview(taskData);
  await dingtalk.sendRobotMessage(title, text);
  logger.info('周回顾已发送');
}

function startScheduler() {
  logger.info('=== ClawdBot 启动 ===');

  cron.schedule('30 9 * * 1-5', () => {
    refreshData().catch(e => logger.error(`刷新失败: ${e.message}`));
  });
  logger.info('09:30 数据刷新');

  // 周一至周四 19:00 当日小结
  cron.schedule('0 19 * * 1-4', () => {
    sendDailyReport().catch(e => logger.error(`日报失败: ${e.message}`));
  });
  logger.info('19:00 当日小结（周一至周四）');

  // 周五 19:00 周回顾
  cron.schedule('0 19 * * 5', () => {
    sendWeeklyReview().catch(e => logger.error(`周回顾失败: ${e.message}`));
  });
  logger.info('周五19:00 周回顾');
}

async function runFullCycle() {
  const taskData = await refreshData();
  if (!taskData) return { success: false, error: '数据刷新失败' };
  await sendDailyReport();
  return { success: true, taskData };
}

module.exports = { runFullCycle, startScheduler, refreshData };
