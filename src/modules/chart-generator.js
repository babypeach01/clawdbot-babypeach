/**
 * 高质量图表生成器（v2 - chartjs-node-canvas 本地渲染 + OSS 上传）
 *
 * 生成精美图表图片，上传到 OSS 获取可嵌入钉钉消息的链接
 * 支持降级到 QuickChart URL（OSS 不可用时）
 */
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// 高清渲染配置
const WIDTH = 800;
const HEIGHT = 480;
const COMPACT_HEIGHT = 400;

// 全局字体和颜色配置
const COLORS = {
  primary: '#1677ff',
  danger: '#ff4d4f',
  warning: '#faad14',
  success: '#52c41a',
  info: '#1890ff',
  purple: '#722ed1',
  grey: '#8c8c8c',
  bg: '#ffffff',
  text: '#262626',
  subtext: '#8c8c8c',
  border: '#f0f0f0',
  // 部门颜色序列（渐变蓝→紫→橙）
  deptSequence: ['#1677ff', '#2f54eb', '#722ed1', '#eb2f96', '#fa541c', '#fa8c16', '#13c2c2', '#52c41a', '#a0d911', '#fadb14', '#8c8c8c', '#595959'],
  // 状态颜色
  status: {
    in_progress: '#1677ff',
    pending_response: '#faad14',
    blocked: '#ff4d4f',
    on_hold: '#722ed1',
    not_started: '#d9d9d9',
    completed: '#52c41a',
  },
};

class ChartGenerator {
  constructor() {
    this._canvas = null;
    this._compactCanvas = null;
  }

  _getCanvas(height = HEIGHT) {
    if (height <= COMPACT_HEIGHT) {
      if (!this._compactCanvas) {
        this._compactCanvas = new ChartJSNodeCanvas({
          width: WIDTH, height: COMPACT_HEIGHT,
          backgroundColour: COLORS.bg,
        });
      }
      return this._compactCanvas;
    }
    if (!this._canvas) {
      this._canvas = new ChartJSNodeCanvas({
        width: WIDTH, height: HEIGHT,
        backgroundColour: COLORS.bg,
      });
    }
    return this._canvas;
  }

  /**
   * 生成部门任务分布横向条形图（堆叠，待办+已完成）
   */
  async deptBarChart(departments) {
    const sorted = departments
      .filter(d => (d.pendingCount || 0) + (d.completedCount || 0) > 0)
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0))
      .slice(0, 10);

    const labels = sorted.map(d => this._shortName(d.department));
    const pending = sorted.map(d => d.pendingCount || 0);
    const completed = sorted.map(d => d.completedCount || 0);

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '待办', data: pending, backgroundColor: '#ff6b6b', borderRadius: 4, barPercentage: 0.7 },
          { label: '已完成', data: completed, backgroundColor: '#51cf66', borderRadius: 4, barPercentage: 0.7 },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        plugins: {
          title: { display: true, text: `📊 部门任务分布 · ${dayjs().format('M/D')}`, font: { size: 20, weight: 'bold' }, padding: { bottom: 16 } },
          legend: { position: 'top', labels: { font: { size: 14 }, usePointStyle: true, pointStyle: 'rectRounded' } },
          datalabels: { display: false },
        },
        scales: {
          x: { stacked: true, grid: { color: '#f5f5f5' }, ticks: { font: { size: 13 } } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 14, weight: 'bold' } } },
        },
      },
    };

    return this._render(config);
  }

  /**
   * 生成任务状态环形饼图
   */
  async statusDoughnut(summary) {
    const data = [
      { label: '推进中', value: summary.inProgressTasks || 0, color: COLORS.status.in_progress },
      { label: '催办中', value: summary.pendingResponseTasks || 0, color: COLORS.status.pending_response },
      { label: '阻塞', value: summary.blockedTasks || 0, color: COLORS.status.blocked },
      { label: '暂缓', value: summary.onHoldTasks || 0, color: COLORS.status.on_hold },
      { label: '待启动', value: summary.notStartedTasks || 0, color: COLORS.status.not_started },
      { label: '已完成', value: summary.completedTasks || 0, color: COLORS.status.completed },
    ].filter(d => d.value > 0);

    const config = {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: data.map(d => d.color),
          borderWidth: 3,
          borderColor: COLORS.bg,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: false,
        cutout: '55%',
        plugins: {
          title: { display: true, text: `🎯 任务状态总览 · ${dayjs().format('M/D')}`, font: { size: 20, weight: 'bold' }, padding: { bottom: 16 } },
          legend: { position: 'right', labels: { font: { size: 14 }, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * 生成个人负荷 Top10 水平条形图（渐变色）
   */
  async personLoadChart(departments) {
    const personMap = {};
    for (const dept of departments) {
      for (const task of dept.tasks || []) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '未指定';
        if (!owner || owner === '未指定') continue;
        personMap[owner] = (personMap[owner] || 0) + 1;
      }
    }

    const sorted = Object.entries(personMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (sorted.length === 0) return null;

    const labels = sorted.map(([name]) => name);
    const data = sorted.map(([, count]) => count);
    const colors = data.map(v => v > 30 ? '#ff4d4f' : v > 20 ? '#fa8c16' : v > 10 ? '#faad14' : '#1677ff');

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '待办任务数',
          data,
          backgroundColor: colors,
          borderRadius: 4,
          barPercentage: 0.65,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        plugins: {
          title: { display: true, text: `👤 个人任务负荷 Top 10`, font: { size: 20, weight: 'bold' }, padding: { bottom: 16 } },
          legend: { display: false },
        },
        scales: {
          x: { grid: { color: '#f5f5f5' }, ticks: { font: { size: 13 } } },
          y: { grid: { display: false }, ticks: { font: { size: 14, weight: 'bold' } } },
        },
      },
    };

    return this._render(config);
  }

  /**
   * 生成部门健康度热力指示图（红黄绿信号灯）
   */
  async deptHealthChart(departments) {
    const today = dayjs();
    const deptData = departments
      .filter(d => (d.pendingCount || 0) > 0)
      .map(d => {
        const blocked = (d.tasks || []).filter(t => t.statusKey === 'blocked' && !t.isCompleted).length;
        const overdue = (d.tasks || []).filter(t => {
          if (t.isCompleted || !t.deadline) return false;
          return dayjs(t.deadline).isBefore(today, 'day');
        }).length;
        const urgent = (d.tasks || []).filter(t => t.statusKey === 'pending_response' && !t.isCompleted).length;
        const score = blocked * 3 + overdue * 2 + urgent;
        return { name: this._shortName(d.department), blocked, overdue, urgent, score, pending: d.pendingCount || 0 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const labels = deptData.map(d => d.name);

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '阻塞', data: deptData.map(d => d.blocked), backgroundColor: '#ff4d4f', borderRadius: 3, barPercentage: 0.7 },
          { label: '逾期', data: deptData.map(d => d.overdue), backgroundColor: '#fa8c16', borderRadius: 3, barPercentage: 0.7 },
          { label: '催办中', data: deptData.map(d => d.urgent), backgroundColor: '#faad14', borderRadius: 3, barPercentage: 0.7 },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        plugins: {
          title: { display: true, text: `⚠️ 部门异常信号 · ${dayjs().format('M/D')}`, font: { size: 20, weight: 'bold' }, padding: { bottom: 16 } },
          legend: { position: 'top', labels: { font: { size: 13 }, usePointStyle: true, pointStyle: 'rectRounded' } },
        },
        scales: {
          x: { stacked: true, grid: { color: '#f5f5f5' }, ticks: { font: { size: 13 }, stepSize: 1 } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 14, weight: 'bold' } } },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * 渲染图表为 PNG Buffer
   */
  async _render(config, height) {
    try {
      const canvas = this._getCanvas(height);
      const buffer = canvas.renderToBufferSync(config, 'image/png');
      return buffer;
    } catch (err) {
      logger.error(`图表渲染失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 渲染图表并保存到本地文件（用于预览）
   */
  async renderToFile(config, filename, height) {
    const buffer = await this._render(config, height);
    if (!buffer) return null;
    const outDir = path.join(__dirname, '..', '..', 'data', 'charts');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  /**
   * 生成图表并上传到 OSS，返回公开 URL
   * @param {Buffer} buffer - PNG 图片 buffer
   * @param {string} name - 文件名（不含扩展名）
   * @returns {string} 公开访问 URL
   */
  async uploadToOss(buffer, name) {
    try {
      const ossUploader = require('./oss-uploader');
      const date = dayjs().format('YYYY-MM-DD');
      const time = dayjs().format('HHmmss');
      const objectKey = `charts/${date}/${name}-${time}.png`;
      const url = await ossUploader.uploadFile(objectKey, buffer, 'image/png');
      return url;
    } catch (err) {
      logger.warn(`OSS 上传失败，保存本地: ${err.message}`);
      // 降级：保存到本地
      const outDir = path.join(__dirname, '..', '..', 'data', 'charts');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const filepath = path.join(outDir, `${name}.png`);
      fs.writeFileSync(filepath, buffer);
      return null;
    }
  }

  /**
   * 一键生成所有图表并上传，返回 URL 集合
   */
  async generateAll(taskData) {
    const results = {};

    const deptBar = await this.deptBarChart(taskData.departments);
    if (deptBar) {
      results.deptBarUrl = await this.uploadToOss(deptBar, 'dept-bar');
      this._saveLocal(deptBar, 'dept-bar.png');
    }

    const statusPie = await this.statusDoughnut(taskData.summary);
    if (statusPie) {
      results.statusPieUrl = await this.uploadToOss(statusPie, 'status-pie');
      this._saveLocal(statusPie, 'status-pie.png');
    }

    const personLoad = await this.personLoadChart(taskData.departments);
    if (personLoad) {
      results.personLoadUrl = await this.uploadToOss(personLoad, 'person-load');
      this._saveLocal(personLoad, 'person-load.png');
    }

    const healthChart = await this.deptHealthChart(taskData.departments);
    if (healthChart) {
      results.healthChartUrl = await this.uploadToOss(healthChart, 'dept-health');
      this._saveLocal(healthChart, 'dept-health.png');
    }

    return results;
  }

  _saveLocal(buffer, filename) {
    const outDir = path.join(__dirname, '..', '..', 'data', 'charts');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, filename), buffer);
  }

  _shortName(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 6);
  }
}

module.exports = new ChartGenerator();
