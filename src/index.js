/**
 * 钉钉待办事项自动化催办与智能预警系统
 *
 * 主入口：启动HTTP服务 + 定时任务调度器
 *
 * 功能：
 * - 自动读取钉钉在线文档中各部门的任务进度
 * - AI智能分析风险并生成催办消息
 * - 定时在钉钉群发送进度简报和催办通知
 * - 高风险事项自动预警管理者
 * - 生成领导看板和周报
 */
const express = require('express');
const dayjs = require('dayjs');
const config = require('./config');
const { runFullCycle, startScheduler } = require('./scheduler');
const taskParser = require('./modules/task-parser');
const aiAnalyzer = require('./modules/ai-analyzer');
const reminderEngine = require('./modules/reminder-engine');
const reportGenerator = require('./modules/report-generator');
const dataStore = require('./modules/data-store');
const logger = require('./utils/logger');

const app = express();
app.use(express.json());

// ============================================
// HTTP API 接口（支持手动触发和外部集成）
// ============================================

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
  res.json({ status: 'running', timestamp: dayjs().format() });
});

/**
 * 手动触发一次完整的催办流程
 */
app.post('/api/trigger', async (req, res) => {
  logger.info('收到手动触发请求');
  const result = await runFullCycle('manual');
  res.json(result);
});

/**
 * 通过API直接提交文档内容进行分析
 * 适用于：无法直接读取钉钉文档API时，用户手动粘贴内容
 *
 * POST /api/analyze
 * Body: { "content": "文档文本内容" }
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: '请提供文档内容 (content字段)' });
    }

    // 解析
    const taskData = taskParser.parseDocContent(content);
    // AI分析
    const analysisResult = await aiAnalyzer.analyzeAll(taskData);
    // 生成看板
    const dashboard = await reportGenerator.generateDailyDashboard(taskData, analysisResult);

    // 保存
    dataStore.saveLatestTasks(taskData);

    res.json({
      success: true,
      taskData,
      analysisResult,
      dashboard,
    });
  } catch (err) {
    logger.error(`分析接口错误: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 通过API提交文档内容，执行分析+催办+预警完整流程
 *
 * POST /api/process
 * Body: { "content": "文档文本内容" }
 */
app.post('/api/process', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: '请提供文档内容 (content字段)' });
    }

    // 解析
    const taskData = taskParser.parseDocContent(content);
    const previousData = dataStore.loadLatestTasks();
    const changes = taskParser.detectChanges(taskData, previousData);

    // AI分析
    const analysisResult = await aiAnalyzer.analyzeAll(taskData);

    // 催办
    await reminderEngine.sendDailyReminders(analysisResult, taskData);
    await reminderEngine.sendStaleUpdateAlerts(taskData);

    // 预警
    if (analysisResult.alertsForManager?.length > 0) {
      await reminderEngine.sendManagerAlert(analysisResult.alertsForManager);
    }

    // 报告
    const dashboard = await reportGenerator.generateDailyDashboard(taskData, analysisResult);

    // 保存
    dataStore.saveLatestTasks(taskData);
    dataStore.saveAnalysis(dayjs().format('YYYY-MM-DD'), analysisResult);
    reportGenerator.saveSnapshot(taskData, analysisResult);

    res.json({ success: true, changes, analysisResult, dashboard });
  } catch (err) {
    logger.error(`处理接口错误: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 获取最新的任务数据和分析结果
 */
app.get('/api/status', (req, res) => {
  const tasks = dataStore.loadLatestTasks();
  const today = dayjs().format('YYYY-MM-DD');
  const analysis = dataStore.loadAnalysis(today);
  res.json({ tasks, analysis, date: today });
});

/**
 * 获取趋势数据
 */
app.get('/api/trends', (req, res) => {
  const days = parseInt(req.query.days || '7', 10);
  const snapshots = reportGenerator.loadRecentSnapshots(days);
  res.json({ snapshots, days });
});

// ============================================
// 启动服务
// ============================================
app.listen(config.server.port, () => {
  logger.info(`HTTP服务已启动: http://localhost:${config.server.port}`);
  logger.info('可用接口:');
  logger.info('  GET  /health          - 健康检查');
  logger.info('  POST /api/trigger     - 手动触发催办流程');
  logger.info('  POST /api/analyze     - 提交文档内容分析');
  logger.info('  POST /api/process     - 提交文档内容执行完整流程');
  logger.info('  GET  /api/status      - 查看最新状态');
  logger.info('  GET  /api/trends      - 查看趋势数据');

  // 启动定时任务调度器
  startScheduler();
});
