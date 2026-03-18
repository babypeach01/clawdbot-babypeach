/**
 * 图表生成器
 * 使用 QuickChart.io API 生成真实图表图片，上传到 OSS 获取可嵌入链接
 */
const axios = require('axios');
const dayjs = require('dayjs');
const logger = require('../utils/logger');

const QUICKCHART_BASE = 'https://quickchart.io/chart';

class ChartGenerator {
  /**
   * 生成部门待办水平条形图
   * @param {Array} departments - [{department, pendingCount, completedCount}]
   * @returns {string} 图片 URL
   */
  deptBarChart(departments) {
    const sorted = departments
      .filter(d => d.pendingCount > 0)
      .sort((a, b) => b.pendingCount - a.pendingCount)
      .slice(0, 10);

    const labels = sorted.map(d => this._shortName(d.department));
    const pending = sorted.map(d => d.pendingCount);
    const completed = sorted.map(d => d.completedCount || 0);

    const config = {
      type: 'horizontalBar',
      data: {
        labels,
        datasets: [
          {
            label: '待办',
            data: pending,
            backgroundColor: '#ff6384',
          },
          {
            label: '已完成',
            data: completed,
            backgroundColor: '#36a2eb',
          },
        ],
      },
      options: {
        title: { display: true, text: `部门任务分布 ${dayjs().format('M/D')}`, fontSize: 16 },
        scales: {
          xAxes: [{ stacked: true, ticks: { beginAtZero: true } }],
          yAxes: [{ stacked: true }],
        },
        plugins: {
          datalabels: {
            display: true,
            color: '#fff',
            font: { weight: 'bold' },
          },
        },
      },
    };

    return this._buildUrl(config, 600, 350);
  }

  /**
   * 生成任务状态环形饼图
   * @param {object} summary - {inProgressTasks, pendingResponseTasks, blockedTasks, completedTasks, ...}
   * @returns {string} 图片 URL
   */
  statusDoughnut(summary) {
    const config = {
      type: 'doughnut',
      data: {
        labels: ['推进中', '催办中', '阻塞', '暂缓', '待启动', '已完成'],
        datasets: [{
          data: [
            summary.inProgressTasks || 0,
            summary.pendingResponseTasks || 0,
            summary.blockedTasks || 0,
            summary.onHoldTasks || 0,
            summary.notStartedTasks || 0,
            summary.completedTasks || 0,
          ],
          backgroundColor: ['#36a2eb', '#ffce56', '#ff6384', '#9966ff', '#c9cbcf', '#4bc0c0'],
        }],
      },
      options: {
        title: { display: true, text: `任务状态总览 ${dayjs().format('M/D')}`, fontSize: 16 },
        plugins: {
          datalabels: {
            display: true,
            formatter: (value) => value > 0 ? value : '',
            color: '#fff',
            font: { weight: 'bold', size: 14 },
          },
        },
      },
    };

    return this._buildUrl(config, 400, 350);
  }

  /**
   * 生成个人负荷 Top10 条形图
   * @param {Array} departments
   * @returns {string} 图片 URL
   */
  personLoadChart(departments) {
    const personMap = {};
    for (const dept of departments) {
      for (const task of dept.tasks) {
        if (task.isCompleted) continue;
        const owner = task.owner || dept.owner || '未指定';
        personMap[owner] = (personMap[owner] || 0) + 1;
      }
    }

    const sorted = Object.entries(personMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const labels = sorted.map(([name]) => name);
    const data = sorted.map(([, count]) => count);

    const config = {
      type: 'horizontalBar',
      data: {
        labels,
        datasets: [{
          label: '待办任务数',
          data,
          backgroundColor: data.map(v => v > 25 ? '#ff6384' : v > 15 ? '#ffce56' : '#36a2eb'),
        }],
      },
      options: {
        title: { display: true, text: '个人任务负荷 Top 10', fontSize: 16 },
        legend: { display: false },
        scales: {
          xAxes: [{ ticks: { beginAtZero: true } }],
        },
        plugins: {
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'right',
            color: '#333',
            font: { weight: 'bold' },
          },
        },
      },
    };

    return this._buildUrl(config, 600, 350);
  }

  /**
   * 生成异常事项红绿灯指示图（紧凑型）
   * @param {object} alerts - {overdue, blocked, urgent}
   * @returns {string} 图片 URL
   */
  alertGauge(alerts) {
    const total = (alerts.overdue || 0) + (alerts.blocked || 0) + (alerts.urgent || 0);
    const level = total === 0 ? '正常' : total <= 3 ? '关注' : total <= 8 ? '预警' : '严重';
    const color = total === 0 ? '#4bc0c0' : total <= 3 ? '#ffce56' : total <= 8 ? '#ff9f40' : '#ff6384';

    const config = {
      type: 'radialGauge',
      data: {
        datasets: [{
          data: [Math.min(total, 20)],
          backgroundColor: color,
        }],
      },
      options: {
        domain: [0, 20],
        trackColor: '#e8e8e8',
        centerPercentage: 80,
        centerArea: {
          text: `${level}\n${total}项`,
          fontSize: 24,
          fontColor: color,
        },
        roundedCorners: true,
      },
    };

    return this._buildUrl(config, 300, 300);
  }

  /**
   * 构建 QuickChart URL
   */
  _buildUrl(config, width = 600, height = 400) {
    const chartJson = JSON.stringify(config);
    const encoded = encodeURIComponent(chartJson);
    return `${QUICKCHART_BASE}?c=${encoded}&w=${width}&h=${height}&bkg=white&f=png`;
  }

  /**
   * 下载图表并上传到 OSS（可选，用于长期保存）
   */
  async downloadAndUpload(chartUrl, ossUploader, filename) {
    try {
      const response = await axios.get(chartUrl, { responseType: 'arraybuffer', timeout: 10000 });
      const buffer = Buffer.from(response.data);
      const date = dayjs().format('YYYY-MM-DD');
      const objectKey = `charts/${date}/${filename}.png`;
      const ossUrl = await ossUploader.uploadFile(objectKey, buffer, 'image/png');
      return ossUrl;
    } catch (err) {
      logger.warn(`图表上传 OSS 失败，使用 QuickChart 直链: ${err.message}`);
      return chartUrl; // 降级：直接用 QuickChart URL
    }
  }

  _shortName(name) {
    if (!name) return '未分类';
    return name.replace(/\s+租车\/用车\/租机/, '').replace(/\s+/, '').slice(0, 6);
  }
}

module.exports = new ChartGenerator();
