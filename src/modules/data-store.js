/**
 * 简易数据存储
 * 负责：持久化任务数据和历史记录（JSON文件存储）
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class DataStore {
  constructor() {
    this.dataDir = config.server.dataDir;
    this._ensureDir(this.dataDir);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 保存最新的任务数据
   */
  saveLatestTasks(taskData) {
    const filepath = path.join(this.dataDir, 'latest-tasks.json');
    fs.writeFileSync(filepath, JSON.stringify(taskData, null, 2));
    logger.info('最新任务数据已保存');
  }

  /**
   * 读取最新的任务数据
   */
  loadLatestTasks() {
    const filepath = path.join(this.dataDir, 'latest-tasks.json');
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }

  /**
   * 保存分析结果
   */
  saveAnalysis(date, result) {
    const filepath = path.join(this.dataDir, `analysis-${date}.json`);
    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  }

  /**
   * 读取分析结果
   */
  loadAnalysis(date) {
    const filepath = path.join(this.dataDir, `analysis-${date}.json`);
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }
}

module.exports = new DataStore();
