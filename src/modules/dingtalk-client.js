/**
 * 钉钉API客户端
 * 负责：获取Access Token、发送机器人消息、读取在线文档、@指定人员
 */
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

class DingTalkClient {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.baseUrl = 'https://oapi.dingtalk.com';
    this.newApiBase = 'https://api.dingtalk.com';
  }

  /**
   * 获取企业内部应用的 Access Token
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const res = await axios.post(`${this.newApiBase}/v1.0/oauth2/accessToken`, {
        appKey: config.dingtalk.appKey,
        appSecret: config.dingtalk.appSecret,
      });

      this.accessToken = res.data.accessToken;
      // Token有效期2小时，提前5分钟刷新
      this.tokenExpiry = Date.now() + (res.data.expireIn - 300) * 1000;
      logger.info('钉钉Access Token刷新成功');
      return this.accessToken;
    } catch (err) {
      logger.error(`获取Access Token失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 生成机器人签名
   */
  _generateSign() {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${config.dingtalk.robotSecret}`;
    const hmac = crypto.createHmac('sha256', config.dingtalk.robotSecret);
    hmac.update(stringToSign);
    const sign = encodeURIComponent(hmac.digest('base64'));
    return { timestamp, sign };
  }

  /**
   * 通过群机器人发送Markdown消息
   * @param {string} title - 消息标题
   * @param {string} markdownText - Markdown格式的消息内容
   * @param {string[]} atUserIds - 需要@的用户ID列表
   */
  async sendRobotMessage(title, markdownText, atUserIds = []) {
    try {
      const { timestamp, sign } = this._generateSign();
      const url = `${config.dingtalk.robotWebhook}&timestamp=${timestamp}&sign=${sign}`;

      const payload = {
        msgtype: 'markdown',
        markdown: { title, text: markdownText },
        at: {
          atUserIds: atUserIds,
          isAtAll: false,
        },
      };

      const res = await axios.post(url, payload);
      if (res.data.errcode !== 0) {
        logger.error(`机器人消息发送失败: ${res.data.errmsg}`);
        return false;
      }
      logger.info(`机器人消息发送成功: ${title}`);
      return true;
    } catch (err) {
      logger.error(`发送机器人消息异常: ${err.message}`);
      return false;
    }
  }

  /**
   * 通过群机器人发送ActionCard消息（带按钮，更醒目）
   */
  async sendActionCard(title, markdownText, buttonTitle, buttonUrl) {
    try {
      const { timestamp, sign } = this._generateSign();
      const url = `${config.dingtalk.robotWebhook}&timestamp=${timestamp}&sign=${sign}`;

      const payload = {
        msgtype: 'actionCard',
        actionCard: {
          title,
          text: markdownText,
          singleTitle: buttonTitle || '查看详情',
          singleURL: buttonUrl || '',
          btnOrientation: '0',
        },
      };

      const res = await axios.post(url, payload);
      if (res.data.errcode !== 0) {
        logger.error(`ActionCard发送失败: ${res.data.errmsg}`);
        return false;
      }
      logger.info(`ActionCard发送成功: ${title}`);
      return true;
    } catch (err) {
      logger.error(`发送ActionCard异常: ${err.message}`);
      return false;
    }
  }

  /**
   * 读取钉钉在线文档内容
   * 注意：钉钉在线文档API需要企业内部应用权限
   */
  async getDocContent() {
    try {
      const token = await this.getAccessToken();
      const res = await axios.get(
        `${this.newApiBase}/v1.0/doc/spaces/${config.dingtalk.spaceId}/documents/${config.dingtalk.docId}`,
        { headers: { 'x-acs-dingtalk-access-token': token } }
      );
      logger.info('在线文档内容读取成功');
      return res.data;
    } catch (err) {
      logger.error(`读取在线文档失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 发送钉钉互动卡片消息（新版卡片平台 API）
   *
   * API: POST /v1.0/card/instances/createAndDeliver
   * 文档: https://open.dingtalk.com/document/orgapp/create-and-deliver-cards
   *
   * @param {string} cardTemplateId - 卡片模板ID（开发者后台创建）
   * @param {string} outTrackId - 卡片唯一标识（业务侧维护，用于后续更新）
   * @param {Object} cardData - 卡片模板变量数据 { title: '...', content: '...' }
   * @param {Object} options - 可选参数
   * @param {string} options.openConversationId - 群会话ID（群聊场景必填）
   * @param {boolean} options.supportForward - 是否支持转发，默认true
   */
  async sendInteractiveCard(cardTemplateId, outTrackId, cardData, options = {}) {
    try {
      const token = await this.getAccessToken();
      const robotCode = config.dingtalk.appKey;

      const payload = {
        cardTemplateId,
        outTrackId,
        cardData: {
          cardParamMap: cardData,
        },
        imGroupOpenDeliverModel: {
          robotCode,
        },
        imGroupOpenSpaceModel: {
          supportForward: options.supportForward !== false,
        },
      };

      // 群聊场景：openSpaceId 格式为 dtv1.card//IM_GROUP.{openConversationId}
      if (options.openConversationId) {
        payload.openSpaceId = `dtv1.card//IM_GROUP.${options.openConversationId}`;
      }

      const res = await axios.post(
        `${this.newApiBase}/v1.0/card/instances/createAndDeliver`,
        payload,
        {
          headers: {
            'x-acs-dingtalk-access-token': token,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`互动卡片发送成功: ${outTrackId}`);
      return { success: true, result: res.data };
    } catch (err) {
      const errMsg = err.response?.data?.message || err.response?.data?.errmsg || err.message;
      logger.error(`互动卡片发送失败: ${errMsg}`);
      logger.error(`详细错误: ${JSON.stringify(err.response?.data || {})}`);
      return { success: false, error: errMsg, detail: err.response?.data };
    }
  }

  /**
   * 更新已发送的互动卡片内容
   *
   * API: PUT /v1.0/card/instances
   *
   * @param {string} outTrackId - 卡片唯一标识
   * @param {Object} cardData - 更新的卡片数据
   */
  async updateInteractiveCard(outTrackId, cardData) {
    try {
      const token = await this.getAccessToken();

      const res = await axios.put(
        `${this.newApiBase}/v1.0/card/instances`,
        {
          outTrackId,
          cardData: {
            cardParamMap: cardData,
          },
        },
        {
          headers: {
            'x-acs-dingtalk-access-token': token,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`互动卡片更新成功: ${outTrackId}`);
      return { success: true, result: res.data };
    } catch (err) {
      logger.error(`互动卡片更新失败: ${err.response?.data?.message || err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * 通过工作通知发送单独消息给管理员（用于紧急预警）
   */
  async sendWorkNotification(userId, title, content) {
    try {
      const token = await this.getAccessToken();
      const agentId = config.dingtalk.appKey; // 企业内部应用agentId

      const res = await axios.post(
        `${this.baseUrl}/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`,
        {
          agent_id: agentId,
          userid_list: userId,
          msg: {
            msgtype: 'markdown',
            markdown: { title, text: content },
          },
        }
      );

      if (res.data.errcode !== 0) {
        logger.error(`工作通知发送失败: ${res.data.errmsg}`);
        return false;
      }
      logger.info(`工作通知已发送给: ${userId}`);
      return true;
    } catch (err) {
      logger.error(`发送工作通知异常: ${err.message}`);
      return false;
    }
  }
}

module.exports = new DingTalkClient();
