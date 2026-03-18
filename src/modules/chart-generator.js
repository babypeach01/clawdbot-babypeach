/**
 * 高品质图表生成器（v3 - 暗色专业主题，匹配驾驶舱风格）
 *
 * 深色背景 + 渐变色 + 圆角 + 阴影 + 精致字体
 * 嵌入钉钉消息后与暗色看板视觉统一
 */
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const WIDTH = 900;
const HEIGHT = 520;
const COMPACT_HEIGHT = 440;

// ━━━ 暗色主题配色 ━━━
const DARK = {
  bg: '#0f172a',           // 深蓝黑背景
  cardBg: '#1e293b',       // 卡片背景
  text: '#e2e8f0',         // 主文字
  subtext: '#94a3b8',      // 次文字
  grid: 'rgba(148,163,184,0.08)', // 网格线
  border: 'rgba(148,163,184,0.12)',

  // 功能色
  blue: '#3b82f6',
  cyan: '#06b6d4',
  green: '#10b981',
  emerald: '#34d399',
  red: '#ef4444',
  rose: '#f43f5e',
  orange: '#f97316',
  amber: '#f59e0b',
  purple: '#8b5cf6',
  violet: '#a78bfa',
  pink: '#ec4899',
  gray: '#64748b',

  // 渐变色序列（部门用）
  deptColors: [
    '#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899',
    '#f97316', '#10b981', '#f59e0b', '#ef4444',
    '#a78bfa', '#64748b', '#34d399', '#f43f5e',
  ],
  // 状态色
  statusColors: {
    in_progress: '#3b82f6',
    pending_response: '#f59e0b',
    blocked: '#ef4444',
    on_hold: '#8b5cf6',
    not_started: '#64748b',
    completed: '#10b981',
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
          backgroundColour: DARK.bg,
        });
      }
      return this._compactCanvas;
    }
    if (!this._canvas) {
      this._canvas = new ChartJSNodeCanvas({
        width: WIDTH, height: HEIGHT,
        backgroundColour: DARK.bg,
      });
    }
    return this._canvas;
  }

  /**
   * 部门任务分布（横向堆叠条形图 - 暗色风格）
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
          {
            label: '待办',
            data: pending,
            backgroundColor: 'rgba(239,68,68,0.85)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 6,
            barPercentage: 0.65,
          },
          {
            label: '已完成',
            data: completed,
            backgroundColor: 'rgba(16,185,129,0.85)',
            borderColor: '#10b981',
            borderWidth: 1,
            borderRadius: 6,
            barPercentage: 0.65,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 10, right: 30, bottom: 10, left: 10 } },
        plugins: {
          title: {
            display: true,
            text: `部门任务分布 · ${dayjs().format('M/D')}`,
            font: { size: 18, weight: 'bold', family: 'PingFang SC, sans-serif' },
            color: DARK.text,
            padding: { bottom: 20 },
          },
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: DARK.subtext,
              font: { size: 13, family: 'PingFang SC, sans-serif' },
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 16,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: DARK.grid, drawBorder: false },
            ticks: { color: DARK.subtext, font: { size: 12 } },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: DARK.text, font: { size: 14, weight: 'bold', family: 'PingFang SC, sans-serif' } },
          },
        },
      },
    };

    return this._render(config);
  }

  /**
   * 任务状态环形饼图（暗色风格 + 发光效果）
   */
  async statusDoughnut(summary) {
    const data = [
      { label: '推进中', value: summary.inProgressTasks || 0, color: DARK.statusColors.in_progress },
      { label: '催办中', value: summary.pendingResponseTasks || 0, color: DARK.statusColors.pending_response },
      { label: '阻塞', value: summary.blockedTasks || 0, color: DARK.statusColors.blocked },
      { label: '暂缓', value: summary.onHoldTasks || 0, color: DARK.statusColors.on_hold },
      { label: '待启动', value: summary.notStartedTasks || 0, color: DARK.statusColors.not_started },
      { label: '已完成', value: summary.completedTasks || 0, color: DARK.statusColors.completed },
    ].filter(d => d.value > 0);

    const config = {
      type: 'doughnut',
      data: {
        labels: data.map(d => `${d.label}  ${d.value}`),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: data.map(d => d.color + 'dd'),
          borderColor: data.map(d => d.color),
          borderWidth: 2,
          hoverOffset: 12,
          spacing: 3,
        }],
      },
      options: {
        responsive: false,
        cutout: '58%',
        layout: { padding: { top: 10, right: 20, bottom: 10, left: 20 } },
        plugins: {
          title: {
            display: true,
            text: `任务状态总览 · ${dayjs().format('M/D')}`,
            font: { size: 18, weight: 'bold', family: 'PingFang SC, sans-serif' },
            color: DARK.text,
            padding: { bottom: 16 },
          },
          legend: {
            position: 'right',
            labels: {
              color: DARK.text,
              font: { size: 14, family: 'PingFang SC, sans-serif' },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 18,
              generateLabels: (chart) => {
                const dataset = chart.data.datasets[0];
                return chart.data.labels.map((label, i) => ({
                  text: label,
                  fillStyle: dataset.backgroundColor[i],
                  strokeStyle: dataset.borderColor[i],
                  lineWidth: 2,
                  pointStyle: 'circle',
                  hidden: false,
                  index: i,
                }));
              },
            },
          },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * 部门完成率排行（横向条形图 - 渐变色）
   */
  async completionRateChart(departments) {
    const deptRates = departments
      .map(d => {
        const total = (d.pendingCount || 0) + (d.completedCount || 0);
        const rate = total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
        return { name: this._shortName(d.department), rate, total };
      })
      .filter(d => d.total > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);

    const colors = deptRates.map(d =>
      d.rate >= 50 ? 'rgba(16,185,129,0.85)' :
      d.rate >= 20 ? 'rgba(245,158,11,0.85)' :
      'rgba(239,68,68,0.85)'
    );
    const borderColors = deptRates.map(d =>
      d.rate >= 50 ? '#10b981' : d.rate >= 20 ? '#f59e0b' : '#ef4444'
    );

    const config = {
      type: 'bar',
      data: {
        labels: deptRates.map(d => d.name),
        datasets: [{
          label: '完成率 %',
          data: deptRates.map(d => d.rate),
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 6,
          barPercentage: 0.6,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 10, right: 40, bottom: 10, left: 10 } },
        plugins: {
          title: {
            display: true,
            text: `部门完成率排行`,
            font: { size: 18, weight: 'bold', family: 'PingFang SC, sans-serif' },
            color: DARK.text,
            padding: { bottom: 20 },
          },
          legend: { display: false },
        },
        scales: {
          x: {
            max: 100,
            grid: { color: DARK.grid, drawBorder: false },
            ticks: {
              color: DARK.subtext,
              font: { size: 12 },
              callback: (v) => v + '%',
            },
          },
          y: {
            grid: { display: false },
            ticks: { color: DARK.text, font: { size: 14, weight: 'bold', family: 'PingFang SC, sans-serif' } },
          },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * 部门异常信号图（阻塞/逾期/催办堆叠 - 暗色风格）
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
        return { name: this._shortName(d.department), blocked, overdue, urgent, score };
      })
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (deptData.length === 0) return null;

    const config = {
      type: 'bar',
      data: {
        labels: deptData.map(d => d.name),
        datasets: [
          {
            label: '阻塞',
            data: deptData.map(d => d.blocked),
            backgroundColor: 'rgba(239,68,68,0.85)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.65,
          },
          {
            label: '逾期',
            data: deptData.map(d => d.overdue),
            backgroundColor: 'rgba(249,115,22,0.85)',
            borderColor: '#f97316',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.65,
          },
          {
            label: '催办中',
            data: deptData.map(d => d.urgent),
            backgroundColor: 'rgba(245,158,11,0.85)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.65,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 10, right: 30, bottom: 10, left: 10 } },
        plugins: {
          title: {
            display: true,
            text: `部门异常信号 · ${dayjs().format('M/D')}`,
            font: { size: 18, weight: 'bold', family: 'PingFang SC, sans-serif' },
            color: DARK.text,
            padding: { bottom: 20 },
          },
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: DARK.subtext,
              font: { size: 13, family: 'PingFang SC, sans-serif' },
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 16,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: DARK.grid, drawBorder: false },
            ticks: { color: DARK.subtext, font: { size: 12 }, stepSize: 1 },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: DARK.text, font: { size: 14, weight: 'bold', family: 'PingFang SC, sans-serif' } },
          },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * 一键生成所有图表并上传
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

    const completionRate = await this.completionRateChart(taskData.departments);
    if (completionRate) {
      results.completionRateUrl = await this.uploadToOss(completionRate, 'completion-rate');
      this._saveLocal(completionRate, 'completion-rate.png');
    }

    const healthChart = await this.deptHealthChart(taskData.departments);
    if (healthChart) {
      results.healthChartUrl = await this.uploadToOss(healthChart, 'dept-health');
      this._saveLocal(healthChart, 'dept-health.png');
    }

    return results;
  }

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

  async renderToFile(config, filename, height) {
    const buffer = await this._render(config, height);
    if (!buffer) return null;
    const outDir = path.join(__dirname, '..', '..', 'data', 'charts');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

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
      const outDir = path.join(__dirname, '..', '..', 'data', 'charts');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `${name}.png`), buffer);
      return null;
    }
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
