/**
 * 定时任务调度器（v6 - 互动卡片，每天一次晚间推送）
 *
 *   09:30  数据刷新（从钉钉文档拉取）
 *   19:00  当日小结 → 钉钉互动卡片（原生嵌入）
 *   周五19:00  周回顾替代日报
 */
const cron = require('node-cron');
const dayjs = require('dayjs');
const config = require('./config');
const dingtalk = require('./modules/dingtalk-client');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const cardBuilder = require('./modules/card-builder');
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

async function sendDailyCard() {
  logger.info('发送当日小结（互动卡片）...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const templateId = config.dingtalk.cardTemplateId;
  const conversationId = config.dingtalk.openConversationId;
  if (!templateId || !conversationId) {
    logger.error('互动卡片配置不完整，跳过');
    return;
  }

  const cardParamMap = cardBuilder.buildDailySummary(taskData);
  const outTrackId = `daily-${dayjs().format('YYYY-MM-DD-HHmmss')}`;

  const result = await dingtalk.sendInteractiveCard(
    templateId, outTrackId, cardParamMap,
    { openConversationId: conversationId }
  );

  if (result.success) {
    logger.info('当日小结卡片已发送');
  } else {
    logger.error(`卡片发送失败: ${result.error}`);
  }
}

function startScheduler() {
  logger.info('=== ClawdBot 启动 ===');

  cron.schedule('30 9 * * 1-5', () => {
    refreshData().catch(e => logger.error(`刷新失败: ${e.message}`));
  });
  logger.info('09:30 数据刷新');

  // 周一至五 19:00 当日小结
  cron.schedule('0 19 * * 1-5', () => {
    sendDailyCard().catch(e => logger.error(`日报失败: ${e.message}`));
  });
  logger.info('19:00 当日小结（互动卡片）');
}

async function runFullCycle() {
  const taskData = await refreshData();
  if (!taskData) return { success: false, error: '数据刷新失败' };
  await sendDailyCard();
  return { success: true, taskData };
}

module.exports = { runFullCycle, startScheduler, refreshData };
