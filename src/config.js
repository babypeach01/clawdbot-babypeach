require('dotenv').config();

module.exports = {
  dingtalk: {
    appKey: process.env.DINGTALK_APP_KEY,
    appSecret: process.env.DINGTALK_APP_SECRET,
    robotWebhook: process.env.DINGTALK_ROBOT_WEBHOOK,
    robotSecret: process.env.DINGTALK_ROBOT_SECRET,
    docId: process.env.DINGTALK_DOC_ID,
    spaceId: process.env.DINGTALK_SPACE_ID,
  },
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL || 'claude-sonnet-4-6',
  },
  reminder: {
    times: (process.env.REMINDER_TIMES || '09:30,14:00,17:00').split(','),
    overdueDaysThreshold: parseInt(process.env.OVERDUE_DAYS_THRESHOLD || '2', 10),
    riskKeywords: (process.env.RISK_KEYWORDS || '延期,阻塞,困难,无法,推迟,取消,暂停,风险,问题').split(','),
  },
  alert: {
    adminUserId: process.env.ADMIN_USER_ID,
    threshold: process.env.ALERT_THRESHOLD || 'medium',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    dataDir: process.env.DATA_DIR || './data',
  },
};
