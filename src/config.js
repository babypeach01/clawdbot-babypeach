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
    // 主引擎：优先使用 Gemini，其次 Kimi，都没有则降级到规则引擎
    provider: process.env.AI_PROVIDER || 'auto', // auto | gemini | kimi
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    },
    kimi: {
      apiKey: process.env.KIMI_API_KEY,
      model: process.env.KIMI_MODEL || 'moonshot-v1-8k',
      baseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    },
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
