/**
 * 高品质图表生成器（v4 - 浅色简约精致主题）
 *
 * 白底 + 低饱和色 + 精致排版 + 轻量网格
 * 风格：苹果/无印良品式极简，拒绝花哨
 */
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const WIDTH = 900;
const HEIGHT = 520;
const COMPACT_HEIGHT = 440;

// ━━━ 浅色简约配色 ━━━
const LIGHT = {
  bg: '#ffffff',
  cardBg: '#f8f9fa',
  text: '#1a1a2e',           // 主文字 - 深色但不纯黑
  subtext: '#8e8e93',        // 次文字 - iOS灰
  grid: 'rgba(0,0,0,0.04)',  // 极淡网格线
  border: 'rgba(0,0,0,0.06)',
  titleColor: '#1a1a2e',
  labelColor: '#3a3a4a',
  legendColor: '#6e6e7e',

  // 功能色 - 低饱和、柔和
  blue: '#5B8DEF',
  teal: '#5AC8C8',
  green: '#5BBD72',
  mint: '#7ED6A8',
  red: '#E8676B',
  coral: '#F09A7E',
  orange: '#F0A551',
  amber: '#E8C94A',
  purple: '#9B8FD9',
  lavender: '#B8A9E8',
  pink: '#E88CB4',
  gray: '#A0A4B0',

  // 部门色序列 - 柔和渐进色
  deptColors: [
    '#5B8DEF', '#5AC8C8', '#9B8FD9', '#E88CB4',
    '#F0A551', '#5BBD72', '#E8C94A', '#E8676B',
    '#B8A9E8', '#A0A4B0', '#7ED6A8', '#F09A7E',
  ],
  // 状态色
  statusColors: {
    in_progress: '#5B8DEF',
    pending_response: '#F0A551',
    blocked: '#E8676B',
    on_hold: '#9B8FD9',
    not_started: '#C8C8CE',
    completed: '#5BBD72',
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
          backgroundColour: LIGHT.bg,
        });
      }
      return this._compactCanvas;
    }
    if (!this._canvas) {
      this._canvas = new ChartJSNodeCanvas({
        width: WIDTH, height: HEIGHT,
        backgroundColour: LIGHT.bg,
      });
    }
    return this._canvas;
  }

  /**
   * 部门任务分布（横向堆叠条形图 - 浅色简约）
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
            backgroundColor: LIGHT.coral + 'cc',
            borderColor: LIGHT.coral,
            borderWidth: 0,
            borderRadius: 4,
            barPercentage: 0.55,
          },
          {
            label: '已完成',
            data: completed,
            backgroundColor: LIGHT.mint + 'cc',
            borderColor: LIGHT.mint,
            borderWidth: 0,
            borderRadius: 4,
            barPercentage: 0.55,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 16, right: 36, bottom: 16, left: 16 } },
        plugins: {
          title: {
            display: true,
            text: `部门任务分布`,
            font: { size: 17, weight: '600', family: '"PingFang SC", "SF Pro Display", sans-serif' },
            color: LIGHT.titleColor,
            padding: { bottom: 24 },
          },
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: LIGHT.legendColor,
              font: { size: 12, family: '"PingFang SC", "SF Pro Text", sans-serif' },
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 20,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: LIGHT.grid, drawBorder: false },
            ticks: { color: LIGHT.subtext, font: { size: 11 } },
            border: { display: false },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: LIGHT.labelColor, font: { size: 13, weight: '500', family: '"PingFang SC", sans-serif' } },
            border: { display: false },
          },
        },
      },
    };

    return this._render(config);
  }

  /**
   * 任务状态环形饼图（简约浅色）
   */
  async statusDoughnut(summary) {
    const data = [
      { label: '推进中', value: summary.inProgressTasks || 0, color: LIGHT.statusColors.in_progress },
      { label: '催办中', value: summary.pendingResponseTasks || 0, color: LIGHT.statusColors.pending_response },
      { label: '阻塞', value: summary.blockedTasks || 0, color: LIGHT.statusColors.blocked },
      { label: '暂缓', value: summary.onHoldTasks || 0, color: LIGHT.statusColors.on_hold },
      { label: '待启动', value: summary.notStartedTasks || 0, color: LIGHT.statusColors.not_started },
      { label: '已完成', value: summary.completedTasks || 0, color: LIGHT.statusColors.completed },
    ].filter(d => d.value > 0);

    const config = {
      type: 'doughnut',
      data: {
        labels: data.map(d => `${d.label}  ${d.value}`),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: data.map(d => d.color + 'dd'),
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 8,
          spacing: 2,
        }],
      },
      options: {
        responsive: false,
        cutout: '62%',
        layout: { padding: { top: 16, right: 24, bottom: 16, left: 24 } },
        plugins: {
          title: {
            display: true,
            text: `任务状态总览`,
            font: { size: 17, weight: '600', family: '"PingFang SC", "SF Pro Display", sans-serif' },
            color: LIGHT.titleColor,
            padding: { bottom: 20 },
          },
          legend: {
            position: 'right',
            labels: {
              color: LIGHT.labelColor,
              font: { size: 13, family: '"PingFang SC", "SF Pro Text", sans-serif' },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              generateLabels: (chart) => {
                const dataset = chart.data.datasets[0];
                return chart.data.labels.map((label, i) => ({
                  text: label,
                  fillStyle: dataset.backgroundColor[i],
                  strokeStyle: '#ffffff',
                  lineWidth: 0,
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
   * 部门完成率排行（横向条形图 - 柔和渐变色）
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
      d.rate >= 50 ? LIGHT.green + 'cc' :
      d.rate >= 20 ? LIGHT.orange + 'cc' :
      LIGHT.coral + 'cc'
    );

    const config = {
      type: 'bar',
      data: {
        labels: deptRates.map(d => d.name),
        datasets: [{
          label: '完成率 %',
          data: deptRates.map(d => d.rate),
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 4,
          barPercentage: 0.5,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 16, right: 44, bottom: 16, left: 16 } },
        plugins: {
          title: {
            display: true,
            text: `部门完成率`,
            font: { size: 17, weight: '600', family: '"PingFang SC", "SF Pro Display", sans-serif' },
            color: LIGHT.titleColor,
            padding: { bottom: 24 },
          },
          legend: { display: false },
        },
        scales: {
          x: {
            max: 100,
            grid: { color: LIGHT.grid, drawBorder: false },
            ticks: {
              color: LIGHT.subtext,
              font: { size: 11 },
              callback: (v) => v + '%',
            },
            border: { display: false },
          },
          y: {
            grid: { display: false },
            ticks: { color: LIGHT.labelColor, font: { size: 13, weight: '500', family: '"PingFang SC", sans-serif' } },
            border: { display: false },
          },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * 部门异常信号图（阻塞/逾期/催办堆叠 - 浅色）
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
            backgroundColor: LIGHT.red + 'cc',
            borderWidth: 0,
            borderRadius: 3,
            barPercentage: 0.55,
          },
          {
            label: '逾期',
            data: deptData.map(d => d.overdue),
            backgroundColor: LIGHT.orange + 'cc',
            borderWidth: 0,
            borderRadius: 3,
            barPercentage: 0.55,
          },
          {
            label: '催办中',
            data: deptData.map(d => d.urgent),
            backgroundColor: LIGHT.amber + 'cc',
            borderWidth: 0,
            borderRadius: 3,
            barPercentage: 0.55,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 16, right: 36, bottom: 16, left: 16 } },
        plugins: {
          title: {
            display: true,
            text: `异常信号`,
            font: { size: 17, weight: '600', family: '"PingFang SC", "SF Pro Display", sans-serif' },
            color: LIGHT.titleColor,
            padding: { bottom: 24 },
          },
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: LIGHT.legendColor,
              font: { size: 12, family: '"PingFang SC", "SF Pro Text", sans-serif' },
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 20,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: LIGHT.grid, drawBorder: false },
            ticks: { color: LIGHT.subtext, font: { size: 11 }, stepSize: 1 },
            border: { display: false },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: LIGHT.labelColor, font: { size: 13, weight: '500', family: '"PingFang SC", sans-serif' } },
            border: { display: false },
          },
        },
      },
    };

    return this._render(config, COMPACT_HEIGHT);
  }

  /**
   * ⭐ 综合总览图（一张图看全局）
   * 横向分组柱状图：每部门显示 已完成 / 待办 / 异常
   * 顶部标注日期+整体达成率
   */
  async overviewChart(taskData) {
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日','周一','周二','周三','周四','周五','周六'][today.day()];
    const { departments, summary } = taskData;
    const totalRate = summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0;

    const depts = departments
      .filter(d => ((d.pendingCount || 0) + (d.completedCount || 0)) > 0)
      .sort((a, b) => {
        const ra = this._rate(a), rb = this._rate(b);
        return ra - rb; // 差的在上面（先看到问题）
      })
      .slice(0, 12);

    const labels = depts.map(d => this._shortName(d.department));
    const completed = depts.map(d => d.completedCount || 0);
    const pending = depts.map(d => {
      const p = d.pendingCount || 0;
      const blocked = (d.tasks || []).filter(t => !t.isCompleted && (t.statusKey === 'blocked' || (t.deadline && dayjs(t.deadline).isBefore(today, 'day')))).length;
      return Math.max(0, p - blocked);
    });
    const abnormal = depts.map(d => {
      return (d.tasks || []).filter(t => !t.isCompleted && (t.statusKey === 'blocked' || (t.deadline && dayjs(t.deadline).isBefore(today, 'day')))).length;
    });
    const rates = depts.map(d => this._rate(d));

    // 动态高度：根据部门数适配，少于4个部门也不会太空
    const chartH = Math.min(700, Math.max(300, depts.length * 50 + 120));

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '已完成',
            data: completed,
            backgroundColor: '#5BBD72cc',
            borderWidth: 0,
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.75,
          },
          {
            label: '进行中',
            data: pending,
            backgroundColor: '#5B8DEFcc',
            borderWidth: 0,
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.75,
          },
          {
            label: '异常（逾期/阻塞）',
            data: abnormal,
            backgroundColor: '#E8676Bcc',
            borderWidth: 0,
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.75,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 8, right: 60, bottom: 16, left: 8 } },
        plugins: {
          title: {
            display: true,
            text: `${dateStr} ${weekday}  工作总览  |  达成率 ${totalRate}%  |  共${summary.totalTasks}项  完成${summary.completedTasks}  待办${summary.totalTasks - summary.completedTasks}`,
            font: { size: 16, weight: '600', family: '"PingFang SC", "SF Pro Display", sans-serif' },
            color: LIGHT.titleColor,
            padding: { bottom: 20, top: 8 },
          },
          legend: {
            position: 'top',
            align: 'center',
            labels: {
              color: LIGHT.legendColor,
              font: { size: 12, family: '"PingFang SC", "SF Pro Text", sans-serif' },
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 18,
            },
          },
          // 在柱条右侧显示达成率
          datalabels: false,
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: LIGHT.grid, drawBorder: false },
            ticks: { color: LIGHT.subtext, font: { size: 11 }, stepSize: 1 },
            border: { display: false },
            title: { display: true, text: '事项数', color: LIGHT.subtext, font: { size: 11 } },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: LIGHT.labelColor,
              font: { size: 13, weight: '500', family: '"PingFang SC", sans-serif' },
              callback: function(value, index) {
                return labels[index] + '  ' + rates[index] + '%';
              },
            },
            border: { display: false },
          },
        },
      },
      plugins: [{
        id: 'rateLabels',
        afterDraw: (chart) => {
          const ctx = chart.ctx;
          const meta = chart.getDatasetMeta(2); // 最后一个dataset
          meta.data.forEach((bar, i) => {
            const total = completed[i] + pending[i] + abnormal[i];
            if (total === 0) return;
            ctx.save();
            ctx.fillStyle = LIGHT.subtext;
            ctx.font = '12px "PingFang SC", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const x = bar.x + 8;
            const y = bar.y;
            ctx.fillText(`${completed[i]}/${total}`, x, y);
            ctx.restore();
          });
        },
      }],
    };

    return this._render(config, chartH);
  }

  _rate(d) {
    const total = (d.pendingCount || 0) + (d.completedCount || 0);
    return total > 0 ? Math.round(((d.completedCount || 0) / total) * 100) : 0;
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
