/**
 * 定时任务调度器（v3 - 总结汇报导向）
 *
 * 工作流：
 *   10:00  宏观总结卡片 → 群（互动卡片+原生图表）
 *   17:00  重点事项预警 → 管理者私信（管理者审核后手动推送）
 *   周五18:00  周回顾 → 群
 *
 * 数据刷新：每天 09:30 自动从钉钉文档拉取最新数据
 */
const cron = require('node-cron');
const dayjs = require('dayjs');
const config = require('./config');
const dingtalk = require('./modules/dingtalk-client');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const reportGenerator = require('./modules/report-generator');
const messageTemplates = require('./modules/message-templates');
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
    reportGenerator.saveSnapshot(taskData);
    logger.info(`✓ 数据已更新: ${taskData.summary.totalTasks}事项 ${taskData.departments.length}部门`);
    return taskData;
  } catch (err) {
    logger.error(`数据刷新失败: ${err.message}`);
    return null;
  }
}

/**
 * 10:00 宏观总结卡片 → 群
 */
async function sendMorningSummary() {
  logger.info('📊 发送每日总览...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const { title, text } = messageTemplates.generateDailySummary(taskData);
  await dingtalk.sendRobotMessage(title, text);
  logger.info('✓ 每日总览已发送');
}

/**
 * 17:00 重点事项预警 → 管理者私信
 */
async function sendPrivateAlert() {
  logger.info('⚠️ 发送重点事项预警...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData?.departments) { logger.warn('无数据，跳过'); return; }

  const alertMsg = messageTemplates.generatePrivateAlert(taskData);
  if (!alertMsg) { logger.info('✅ 无异常事项'); return; }

  const adminUserId = config.alert.adminUserId;
  if (adminUserId && adminUserId !== 'your_admin_user_id') {
    const ok = await dingtalk.sendWorkNotification(adminUserId, alertMsg.title, alertMsg.text);
    if (ok) logger.info('✓ 预警已发送给管理者');
    else logger.error('预警私信发送失败，降级到群消息');
  }

  // 降级：也发到群（管理者可能没配userId）
  if (!adminUserId || adminUserId === 'your_admin_user_id') {
    await dingtalk.sendRobotMessage(alertMsg.title, alertMsg.text);
    logger.info('✓ 预警已发送到群（未配置管理者ID）');
  }
}

/**
 * 周五 18:00 周回顾 → 群
 */
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
  logger.info('=== ClawdBot 报送系统启动 (v3 总结导向) ===');

  // 09:30 数据刷新
  cron.schedule('30 9 * * 1-5', () => {
    refreshData().catch(e => logger.error(`数据刷新失败: ${e.message}`));
  });
  logger.info('已注册: 09:30 数据刷新');

  // 10:00 宏观总结卡片 → 群
  cron.schedule('0 10 * * 1-5', () => {
    sendMorningSummary().catch(e => logger.error(`总结卡片失败: ${e.message}`));
  });
  logger.info('已注册: 10:00 宏观总结卡片');

  // 17:00 重点事项预警 → 管理者私信
  cron.schedule('0 17 * * 1-5', () => {
    sendPrivateAlert().catch(e => logger.error(`预警失败: ${e.message}`));
  });
  logger.info('已注册: 17:00 重点事项预警');

  // 周五 18:00 周回顾
  cron.schedule('0 18 * * 5', () => {
    sendWeeklyReview().catch(e => logger.error(`周回顾失败: ${e.message}`));
  });
  logger.info('已注册: 周五18:00 周回顾');

  logger.info('所有定时任务已注册');
}

/**
 * 手动执行全流程（API触发用）
 */
async function runFullCycle(mode = 'manual') {
  logger.info(`====== 手动执行 (${mode}) ======`);
  const taskData = await refreshData();
  if (!taskData) return { success: false, error: '数据刷新失败' };

  await sendMorningSummary();
  return { success: true, taskData };
}

module.exports = { runFullCycle, startScheduler, refreshData };
