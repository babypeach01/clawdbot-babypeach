/**
 * 定时任务调度器（v2）
 *
 * 执行流程：
 * 1. 读取钉钉在线文档
 * 2. 正则解析任务数据（快速粗提取）
 * 3. 如果正则解析效果差，调用AI智能提取（兜底）
 * 4. AI去重和合并同类项
 * 5. AI风险分析
 * 6. 发送催办消息 + 预警
 * 7. 生成报告 + 保存快照
 */
const cron = require('node-cron');
const dayjs = require('dayjs');
const config = require('./config');
const dingtalk = require('./modules/dingtalk-client');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const reminderEngine = require('./modules/reminder-engine');
const reportGenerator = require('./modules/report-generator');
const messageTemplates = require('./modules/message-templates');
const dataStore = require('./modules/data-store');
const logger = require('./utils/logger');

/**
 * 核心执行流程
 */
async function runFullCycle(mode = 'scheduled') {
  logger.info(`====== 开始执行全流程 (${mode}) ======`);

  try {
    // Step 1: 读取钉钉在线文档
    logger.info('[1/7] 读取钉钉在线文档...');
    const docContent = await dingtalk.getDocContent();
    const rawText = typeof docContent === 'string' ? docContent : JSON.stringify(docContent);

    // Step 2: 正则解析（快速粗提取）
    logger.info('[2/7] 正则解析文档内容...');
    let taskData = taskParser.parseDocContent(rawText);

    // Step 3: 如果正则解析效果不好（任务太少），用AI兜底提取
    if (taskData.summary.totalTasks === 0 || taskData.departments.length === 0) {
      logger.info('[2.5/7] 正则解析结果为空，启用AI智能提取...');
      const aiExtracted = await aiAnalyzer.extractTasksFromRawText(rawText);
      if (aiExtracted && aiExtracted.summary.totalTasks > 0) {
        taskData = aiExtracted;
        logger.info(`AI提取到 ${taskData.summary.totalTasks} 个任务`);
      }
    }

    // Step 4: 与历史数据对比
    const previousData = dataStore.loadLatestTasks();
    const changes = taskParser.detectChanges(taskData, previousData);
    if (changes.length > 0) {
      logger.info(`检测到 ${changes.length} 项变更`);
    }

    // Step 5: AI去重
    logger.info('[3/7] AI去重分析...');
    const { duplicates } = await aiAnalyzer.deduplicateTasks(taskData);
    if (duplicates.length > 0) {
      const dedupReport = reportGenerator.generateDeduplicationReport(duplicates);
      if (dedupReport) {
        await dingtalk.sendRobotMessage('重复任务检测', dedupReport);
      }
    }

    // Step 6: AI风险分析
    logger.info('[4/7] AI智能分析...');
    const analysisResult = await aiAnalyzer.analyzeAll(taskData);

    // Step 7: 发送催办消息
    logger.info('[5/7] 发送催办消息...');
    await reminderEngine.sendDailyReminders(analysisResult, taskData);

    // Step 8: 发送人工预警
    logger.info('[6/7] 检查预警...');
    if (analysisResult.alertsForManager && analysisResult.alertsForManager.length > 0) {
      await reminderEngine.sendManagerAlert(analysisResult.alertsForManager);
      logger.info(`⚠️ 已触发 ${analysisResult.alertsForManager.length} 条人工预警`);
    }

    // Step 9: 生成并发送看板
    logger.info('[7/7] 生成看板报告...');
    const dashboard = await reportGenerator.generateDailyDashboard(taskData, analysisResult);
    await dingtalk.sendRobotMessage('每日看板', dashboard);

    // Step 10: 保存数据
    dataStore.saveLatestTasks(taskData);
    dataStore.saveAnalysis(dayjs().format('YYYY-MM-DD'), analysisResult);
    reportGenerator.saveSnapshot(taskData, analysisResult);

    logger.info('====== 全流程执行完成 ======');
    return { success: true, taskData, analysisResult, dashboard, duplicates };
  } catch (err) {
    logger.error(`全流程执行失败: ${err.message}`);
    await dingtalk.sendRobotMessage(
      '⚠️ 系统异常',
      `### 系统执行异常\n\n自动化流程执行出错: ${err.message}\n\n请检查系统配置。`
    ).catch(() => {});
    return { success: false, error: err.message };
  }
}

/**
 * 发送晨报（只看异常：逾期/阻塞/催办中）
 */
async function sendMorningBrief() {
  logger.info('📧 发送晨报...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData || !taskData.departments) {
    logger.warn('无任务数据，跳过晨报');
    return;
  }
  const { title, text } = messageTemplates.generateMorningBrief(taskData);
  await dingtalk.sendRobotMessage(title, text);
}

/**
 * 发送部门看板（图表为主）
 */
async function sendDashboard() {
  logger.info('📧 发送部门看板...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData || !taskData.departments) {
    logger.warn('无任务数据，跳过看板');
    return;
  }
  const previousData = dataStore.loadLatestTasks(); // TODO: load yesterday's snapshot for diff
  const changes = taskParser.detectChanges(taskData, previousData);
  const { title, text } = messageTemplates.generateDashboard(taskData, changes);
  await dingtalk.sendRobotMessage(title, text);
}

/**
 * 发送催办消息（仅逾期+阻塞，逐条独立发送）
 */
async function sendUrgentAlerts() {
  logger.info('📧 发送催办消息...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData || !taskData.departments) return;

  const alerts = messageTemplates.generateUrgentAlerts(taskData);
  // 限制最多发5条，避免刷屏
  for (const alert of alerts.slice(0, 5)) {
    await dingtalk.sendRobotMessage(alert.title, alert.text);
    // 间隔2秒避免频率限制
    await new Promise(r => setTimeout(r, 2000));
  }
  if (alerts.length > 0) {
    logger.info(`已发送${Math.min(alerts.length, 5)}条催办（共${alerts.length}条）`);
  }
}

/**
 * 发送周回顾（周五替代晚报）
 */
async function sendWeeklyReview() {
  logger.info('📧 发送周回顾...');
  const taskData = dataStore.loadLatestTasks();
  if (!taskData || !taskData.departments) return;

  const weekData = reportGenerator.loadRecentSnapshots(5);
  const { title, text } = messageTemplates.generateWeeklyReview(taskData, weekData);
  await dingtalk.sendRobotMessage(title, text);
}

/**
 * 启动定时任务
 */
function startScheduler() {
  logger.info('=== 钉钉待办自动化催办系统启动 (v3) ===');

  // ┌─────────────────────────────────────────┐
  // │  时间表（工作日 Mon-Fri）                  │
  // │  10:00  晨报焦点（半屏，只看异常）           │
  // │  14:00  催办提醒（逾期+阻塞，逐条发）        │
  // │  18:00  部门看板（一屏图表）                 │
  // │  周五16:00  周回顾（替代当日晚报）           │
  // └─────────────────────────────────────────┘

  // 晨报 10:00
  cron.schedule('0 10 * * 1-5', () => {
    logger.info('⏰ 定时触发: 晨报');
    sendMorningBrief().catch(e => logger.error(`晨报失败: ${e.message}`));
  });
  logger.info('已注册: 每工作日 10:00 晨报');

  // 催办 14:00
  cron.schedule('0 14 * * 1-5', () => {
    logger.info('⏰ 定时触发: 催办');
    sendUrgentAlerts().catch(e => logger.error(`催办失败: ${e.message}`));
  });
  logger.info('已注册: 每工作日 14:00 催办');

  // 晚间看板 18:00
  cron.schedule('0 18 * * 1-5', () => {
    const isFriday = dayjs().day() === 5;
    if (isFriday) {
      logger.info('⏰ 周五触发: 周回顾');
      sendWeeklyReview().catch(e => logger.error(`周回顾失败: ${e.message}`));
    } else {
      logger.info('⏰ 定时触发: 部门看板');
      sendDashboard().catch(e => logger.error(`看板失败: ${e.message}`));
    }
  });
  logger.info('已注册: 每工作日 18:00 看板/周五周回顾');

  logger.info('所有定时任务已注册，系统运行中...');
}

module.exports = { runFullCycle, startScheduler };
