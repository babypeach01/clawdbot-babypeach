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
   * ⭐ 当日总览表格图（用 canvas 直接画表格，不依赖 Chart.js）
   *
   * 表格列：部门 | 总数 | 待办 | 已完成 | 今日到期 | 逾期 | 阻塞 | 达成率
   * 直接嵌入钉钉消息，不需要点击/下载
   */
  async dailySummaryTable(taskData) {
    const { createCanvas } = require('canvas');
    const today = dayjs();
    const dateStr = today.format('M月D日');
    const weekday = ['周日','周一','周二','周三','周四','周五','周六'][today.day()];
    const { departments, summary } = taskData;

    // 准备数据
    const depts = departments
      .filter(d => ((d.pendingCount || 0) + (d.completedCount || 0)) > 0)
      .sort((a, b) => this._rate(a) - this._rate(b));

    const rows = depts.map(d => {
      const tasks = d.tasks || [];
      const total = (d.pendingCount || 0) + (d.completedCount || 0);
      const done = d.completedCount || 0;
      const pending = d.pendingCount || 0;
      const dueToday = tasks.filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isSame(today, 'day')).length;
      const overdue = tasks.filter(t => !t.isCompleted && t.deadline && dayjs(t.deadline).isBefore(today, 'day')).length;
      const blocked = tasks.filter(t => !t.isCompleted && t.statusKey === 'blocked').length;
      const rate = this._rate(d);
      return {
        dept: this._shortName(d.department),
        total, pending, done, dueToday, overdue, blocked, rate,
      };
    });

    // 汇总行
    const totals = {
      dept: '合计',
      total: summary.totalTasks,
      pending: summary.totalTasks - summary.completedTasks,
      done: summary.completedTasks,
      dueToday: rows.reduce((s, r) => s + r.dueToday, 0),
      overdue: rows.reduce((s, r) => s + r.overdue, 0),
      blocked: rows.reduce((s, r) => s + r.blocked, 0),
      rate: summary.totalTasks > 0 ? Math.round((summary.completedTasks / summary.totalTasks) * 100) : 0,
    };

    // ── 表格布局参数 ──
    const cols = [
      { key: 'dept',     label: '部门',     width: 130, align: 'left' },
      { key: 'total',    label: '总数',     width: 60,  align: 'center' },
      { key: 'pending',  label: '待办',     width: 60,  align: 'center' },
      { key: 'done',     label: '已完成',   width: 70,  align: 'center' },
      { key: 'dueToday', label: '今日到期', width: 80,  align: 'center' },
      { key: 'overdue',  label: '逾期',     width: 60,  align: 'center' },
      { key: 'blocked',  label: '阻塞',     width: 60,  align: 'center' },
      { key: 'rate',     label: '达成率',   width: 80,  align: 'center' },
    ];

    const padX = 24;          // 画布左右边距
    const titleH = 60;        // 标题区高度
    const headerH = 40;       // 表头行高
    const rowH = 38;          // 数据行高
    const totalRowH = 42;     // 汇总行高
    const footH = 28;         // 底部留白
    const tableW = cols.reduce((s, c) => s + c.width, 0);
    const canvasW = tableW + padX * 2;
    const canvasH = titleH + headerH + rows.length * rowH + totalRowH + footH;

    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    // ── 背景 ──
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // ── 标题 ──
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${dateStr} ${weekday} · 当日工作总览`, padX, titleH / 2 - 2);

    // 右侧总数据
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.textAlign = 'right';
    const summaryText = `共${totals.total}项  完成${totals.done}  待办${totals.pending}  达成率${totals.rate}%`;
    ctx.fillText(summaryText, canvasW - padX, titleH / 2 - 2);

    // ── 表头 ──
    let y = titleH;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(padX, y, tableW, headerH);

    // 表头文字
    ctx.font = 'bold 13px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#374151';
    ctx.textBaseline = 'middle';
    let x = padX;
    for (const col of cols) {
      ctx.textAlign = col.align === 'left' ? 'left' : 'center';
      const tx = col.align === 'left' ? x + 12 : x + col.width / 2;
      ctx.fillText(col.label, tx, y + headerH / 2);
      x += col.width;
    }

    // 表头底线
    ctx.strokeStyle = '#D1D5DB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y + headerH);
    ctx.lineTo(padX + tableW, y + headerH);
    ctx.stroke();

    // ── 数据行 ──
    y += headerH;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // 斑马纹
      if (i % 2 === 1) {
        ctx.fillStyle = '#F9FAFB';
        ctx.fillRect(padX, y, tableW, rowH);
      }

      // 行底线
      ctx.strokeStyle = '#F3F4F6';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(padX, y + rowH);
      ctx.lineTo(padX + tableW, y + rowH);
      ctx.stroke();

      x = padX;
      for (const col of cols) {
        let val = row[col.key];
        let color = '#374151';

        // 数字着色
        if (col.key === 'dueToday' && val > 0) color = '#D97706';
        if (col.key === 'overdue' && val > 0) color = '#DC2626';
        if (col.key === 'blocked' && val > 0) color = '#DC2626';
        if (col.key === 'rate') {
          if (val >= 60) color = '#059669';
          else if (val >= 30) color = '#D97706';
          else color = '#DC2626';
          val = val + '%';
        }
        if (col.key === 'done' && val > 0) color = '#059669';

        ctx.font = col.key === 'dept' ? 'bold 13px "PingFang SC", "Microsoft YaHei", sans-serif' : '13px "PingFang SC", sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = col.align === 'left' ? 'left' : 'center';
        const tx = col.align === 'left' ? x + 12 : x + col.width / 2;
        ctx.fillText(String(val), tx, y + rowH / 2);
        x += col.width;
      }

      y += rowH;
    }

    // ── 汇总行 ──
    ctx.fillStyle = '#EFF6FF';
    ctx.fillRect(padX, y, tableW, totalRowH);
    ctx.strokeStyle = '#93C5FD';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + tableW, y);
    ctx.stroke();

    x = padX;
    for (const col of cols) {
      let val = totals[col.key];
      let color = '#1E40AF';
      if (col.key === 'dueToday' && val > 0) color = '#D97706';
      if (col.key === 'overdue' && val > 0) color = '#DC2626';
      if (col.key === 'blocked' && val > 0) color = '#DC2626';
      if (col.key === 'rate') val = val + '%';

      ctx.font = 'bold 13px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = col.align === 'left' ? 'left' : 'center';
      const tx = col.align === 'left' ? x + 12 : x + col.width / 2;
      ctx.fillText(String(val), tx, y + totalRowH / 2);
      x += col.width;
    }

    return canvas.toBuffer('image/png');
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
