/**
 * 阿里云 OSS 上传模块
 * 将报告/图表上传到 OSS，返回公开访问链接
 */
const OSS = require('ali-oss');
const dayjs = require('dayjs');
const config = require('../config');
const logger = require('../utils/logger');

class OssUploader {
  constructor() {
    this.client = null;
    this.baseUrl = null;
  }

  _ensureClient() {
    if (this.client) return;

    const { accessKeyId, accessKeySecret, bucket, region } = config.oss;
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new Error('OSS 配置不完整，请检查 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET');
    }

    this.client = new OSS({ region, accessKeyId, accessKeySecret, bucket });
    this.baseUrl = `https://${bucket}.${region}.aliyuncs.com`;
  }

  /**
   * 上传 Markdown 报告（转为 HTML 后上传）
   * @param {string} markdown - Markdown 内容
   * @param {string} type - 报告类型: daily | weekly | alert
   * @returns {string} 公开访问 URL
   */
  async uploadReport(markdown, type = 'daily') {
    this._ensureClient();

    const date = dayjs().format('YYYY-MM-DD');
    const time = dayjs().format('HHmmss');
    const objectKey = `reports/${date}/${type}-${time}.html`;

    const html = this._markdownToHtml(markdown, type);

    const result = await this.client.put(objectKey, Buffer.from(html, 'utf8'), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });

    const url = result.url || `${this.baseUrl}/${objectKey}`;
    logger.info(`报告已上传 OSS: ${url}`);
    return url;
  }

  /**
   * 上传任意文件（Buffer 或本地路径）
   * @param {string} objectKey - OSS 对象路径
   * @param {Buffer|string} content - 文件内容或本地路径
   * @param {string} contentType - MIME type
   * @returns {string} 公开访问 URL
   */
  async uploadFile(objectKey, content, contentType = 'application/octet-stream') {
    this._ensureClient();

    const result = await this.client.put(objectKey, content, {
      headers: { 'Content-Type': contentType },
    });

    const url = result.url || `${this.baseUrl}/${objectKey}`;
    logger.info(`文件已上传 OSS: ${url}`);
    return url;
  }

  /**
   * 简易 Markdown → HTML 转换（带样式，适合钉钉内置浏览器查看）
   */
  _markdownToHtml(markdown, type) {
    const titleMap = {
      daily: '每日工作看板',
      weekly: '周度趋势报告',
      alert: '风险预警报告',
    };
    const title = titleMap[type] || '工作报告';

    // 基础 Markdown → HTML 转换
    let body = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // 标题
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // 粗体
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 引用
      .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
      // 分割线
      .replace(/^---$/gm, '<hr>')
      // 列表项
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^· (.+)$/gm, '<li>$1</li>')
      // 表格处理
      .replace(/^\|(.+)\|$/gm, (match) => {
        const cells = match.split('|').filter(c => c.trim());
        if (cells.every(c => /^[\s:-]+$/.test(c))) return ''; // 跳过分隔行
        const tag = body.indexOf(match) < body.indexOf('\n') ? 'th' : 'td';
        const row = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('');
        return `<tr>${row}</tr>`;
      })
      // 段落
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - ${dayjs().format('YYYY-MM-DD')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; padding: 16px; }
  .container { max-width: 800px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  h1 { font-size: 22px; color: #1a1a1a; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #1677ff; }
  h2 { font-size: 18px; color: #1677ff; margin: 20px 0 12px; }
  h3 { font-size: 16px; color: #333; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th, td { padding: 8px 12px; border: 1px solid #e8e8e8; text-align: left; }
  th { background: #fafafa; font-weight: 600; }
  tr:hover { background: #f0f7ff; }
  blockquote { background: #f6f8fa; border-left: 4px solid #1677ff; padding: 12px 16px; margin: 12px 0; border-radius: 0 8px 8px 0; }
  hr { border: none; border-top: 1px solid #e8e8e8; margin: 20px 0; }
  li { margin-left: 20px; margin-bottom: 4px; }
  strong { color: #1a1a1a; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e8e8e8; font-size: 12px; color: #999; text-align: center; }
</style>
</head>
<body>
<div class="container">
<p>${body}</p>
<div class="footer">由 AI 智能任务跟踪系统自动生成 · ${dayjs().format('YYYY-MM-DD HH:mm')}</div>
</div>
</body>
</html>`;
  }
}

module.exports = new OssUploader();
