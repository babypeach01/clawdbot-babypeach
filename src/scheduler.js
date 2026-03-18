/**
 * 定时任务调度器
 * 负责：按配置的时间点自动执行催办、分析、报告生成等任务
 *
 * 执行流程：
 * 1. 读取钉钉在线文档 → 2. 解析任务数据 → 3. AI分析风险
 * → 4. 发送催办消息 → 5. 触发预警 → 6. 生成报告 → 7. 保存快照
 */
const cron = require('node-cron');
const dayjs = require('dayjs');
const config = require('./config');
const dingtalk = require('./modules/dingtalk-client');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const reminderEngine = require('./modules/reminder-engine');
const reportGenerator = require('./modules/report-generator');
const dataStore = require('./modules/data-store');
const logger = require('./utils/logger');

/**
 * 核心执行流程：读取 → 解析 → 分析 → 催办 → 预警 → 报告
 */
async function runFullCycle(mode = 'scheduled') {
  logger.info(`====== 开始执行全流程 (${mode}) ======`);

  try {
    // Step 1: 读取钉钉在线文档
    logger.info('[1/6] 读取钉钉在线文档...');
    const docContent = await dingtalk.getDocContent();
    const rawText = typeof docContent === 'string' ? docContent : JSON.stringify(docContent);

    // Step 2: 解析文档内容为结构化数据
    logger.info('[2/6] 解析文档内容...');
    const taskData = taskParser.parseDocContent(rawText);

    // Step 3: 与历史数据对比，检测变更
    const previousData = dataStore.loadLatestTasks();
    const changes = taskParser.detectChanges(taskData, previousData);
    if (changes.length > 0) {
      logger.info(`检测到 ${changes.length} 项变更`);
    }

    // Step 4: AI智能分析
    logger.info('[3/6] AI智能分析...');
    const analysisResult = await aiAnalyzer.analyzeAll(taskData);

    // Step 5: 发送催办消息
    logger.info('[4/6] 发送催办消息...');
    await reminderEngine.sendDailyReminders(analysisResult, taskData);

    // Step 6: 检查并发送未更新提醒
    await reminderEngine.sendStaleUpdateAlerts(taskData);

    // Step 7: 发送人工预警（如果有高风险事项）
    logger.info('[5/6] 检查预警...');
    if (analysisResult.alertsForManager && analysisResult.alertsForManager.length > 0) {
      await reminderEngine.sendManagerAlert(analysisResult.alertsForManager);
      logger.info(`⚠️ 已触发 ${analysisResult.alertsForManager.length} 条人工预警`);
    }

    // Step 8: 生成并发送领导看板
    logger.info('[6/6] 生成看板报告...');
    const dashboard = await reportGenerator.generateDailyDashboard(taskData, analysisResult);
    await dingtalk.sendRobotMessage('每日看板', dashboard);

    // Step 9: 保存数据
    dataStore.saveLatestTasks(taskData);
    dataStore.saveAnalysis(dayjs().format('YYYY-MM-DD'), analysisResult);
    reportGenerator.saveSnapshot(taskData, analysisResult);

    logger.info('====== 全流程执行完成 ======');
    return { success: true, taskData, analysisResult, dashboard };
  } catch (err) {
    logger.error(`全流程执行失败: ${err.message}`);
    // 发送错误通知
    await dingtalk.sendRobotMessage(
      '⚠️ 系统异常',
      `### 系统执行异常\n\n自动化流程执行出错: ${err.message}\n\n请检查系统配置。`
    ).catch(() => {});
    return { success: false, error: err.message };
  }
}

/**
 * 启动定时任务
 */
function startScheduler() {
  logger.info('=== 钉钉待办自动化催办系统启动 ===');
  logger.info(`催办时间: ${config.reminder.times.join(', ')}`);

  // 为每个配置的催办时间设置定时任务
  for (const time of config.reminder.times) {
    const [hour, minute] = time.split(':');
    const cronExpr = `${minute} ${hour} * * 1-5`; // 工作日执行

    cron.schedule(cronExpr, () => {
      logger.info(`定时催办触发: ${time}`);
      runFullCycle('scheduled');
    });

    logger.info(`已注册定时任务: 每工作日 ${time}`);
  }

  // 每周五下午4点生成周报
  cron.schedule('0 16 * * 5', async () => {
    logger.info('触发周报生成...');
    const weekData = reportGenerator.loadRecentSnapshots(5);
    if (weekData.length > 0) {
      const weeklyReport = await reportGenerator.generateWeeklyReport(weekData);
      await dingtalk.sendRobotMessage('本周工作进度周报', weeklyReport);
    }
  });

  logger.info('所有定时任务已注册，系统运行中...');
}

module.exports = { runFullCycle, startScheduler };
