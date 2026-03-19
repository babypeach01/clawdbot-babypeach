#!/usr/bin/env node
/**
 * 获取钉钉群会话的 openConversationId
 *
 * 用法：node scripts/get-conversation-id.js
 *
 * 会列出机器人所在的群会话信息
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const API_BASE = 'https://api.dingtalk.com';

async function getAccessToken() {
  const res = await axios.post(`${API_BASE}/v1.0/oauth2/accessToken`, {
    appKey: process.env.DINGTALK_APP_KEY,
    appSecret: process.env.DINGTALK_APP_SECRET,
  });
  return res.data.accessToken;
}

async function main() {
  console.log('获取 Access Token...');
  const token = await getAccessToken();
  console.log('✓ Token 获取成功\n');

  // 方法1：通过机器人信息获取
  console.log('查询机器人所在群列表...');
  try {
    const res = await axios.post(
      `${API_BASE}/v1.0/robot/groupMessages/query`,
      {},
      { headers: { 'x-acs-dingtalk-access-token': token } }
    );
    console.log('群列表:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log(`方法1失败: ${e.response?.data?.message || e.message}`);
  }

  // 方法2：通过 webhook 发一条消息，从返回值中提取
  // 互动卡片需要 openConversationId，可以通过以下 API 获取
  console.log('\n尝试通过 chat API 获取...');
  try {
    const res = await axios.post(
      `${API_BASE}/v1.0/im/chat/ids`,
      {},
      { headers: { 'x-acs-dingtalk-access-token': token } }
    );
    console.log('Chat IDs:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log(`方法2失败: ${e.response?.data?.message || e.message}`);
  }

  // 方法3：直接用 oapi 接口
  console.log('\n尝试 oapi 接口...');
  try {
    const res = await axios.get(
      `https://oapi.dingtalk.com/chat/list?access_token=${token}`
    );
    if (res.data.errcode === 0 && res.data.chatlist) {
      console.log('\n找到以下群会话：\n');
      for (const chat of res.data.chatlist) {
        console.log(`  群名称: ${chat.name}`);
        console.log(`  chatId: ${chat.chatid}`);
        console.log(`  owner:  ${chat.owner}`);
        console.log('');
      }

      // 对每个 chatId 获取 openConversationId
      for (const chat of res.data.chatlist) {
        try {
          const convRes = await axios.post(
            `${API_BASE}/v1.0/im/chat/${chat.chatid}/openConversationId`,
            {},
            { headers: { 'x-acs-dingtalk-access-token': token } }
          );
          console.log(`  群「${chat.name}」的 openConversationId: ${convRes.data.openConversationId}`);
        } catch (e2) {
          // 尝试另一个 API
          try {
            const convRes2 = await axios.post(
              `${API_BASE}/v1.0/im/conversations`,
              { chatId: chat.chatid },
              { headers: { 'x-acs-dingtalk-access-token': token } }
            );
            console.log(`  群「${chat.name}」的 openConversationId: ${convRes2.data.openConversationId}`);
          } catch (e3) {
            console.log(`  群「${chat.name}」获取 openConversationId 失败: ${e3.response?.data?.message || e3.message}`);
          }
        }
      }
    } else {
      console.log('  无结果:', res.data.errmsg || '无群信息');
    }
  } catch (e) {
    console.log(`方法3失败: ${e.response?.data?.message || e.message}`);
  }

  console.log('\n提示: 获取到 openConversationId 后，请添加到 .env 文件：');
  console.log('DINGTALK_OPEN_CONVERSATION_ID=你获取到的ID');
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
