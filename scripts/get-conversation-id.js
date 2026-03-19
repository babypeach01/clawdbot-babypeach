#!/usr/bin/env node
/**
 * 获取钉钉群的 openConversationId
 *
 * 方法：通过企业内部应用 API 查询机器人所在群信息
 *
 * 用法：node scripts/get-conversation-id.js
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

  const headers = {
    'x-acs-dingtalk-access-token': token,
    'Content-Type': 'application/json',
  };

  // 方法1：通过 robotCode 查询机器人所在的群列表
  console.log('方法1: 查询机器人所在群...');
  try {
    const res = await axios.post(
      `${API_BASE}/v1.0/robot/groups/query`,
      { robotCode: process.env.DINGTALK_APP_KEY },
      { headers }
    );
    console.log('✓ 成功! 机器人群列表:');
    console.log(JSON.stringify(res.data, null, 2));
    return;
  } catch (e) {
    console.log(`  失败: ${e.response?.data?.message || e.response?.data?.errmsg || e.message}\n`);
  }

  // 方法2：通过 IM 接口查询会话列表
  console.log('方法2: 查询IM会话列表...');
  try {
    const res = await axios.post(
      `${API_BASE}/v1.0/im/interconnections/conversations/query`,
      {},
      { headers }
    );
    console.log('✓ 成功!');
    console.log(JSON.stringify(res.data, null, 2));
    return;
  } catch (e) {
    console.log(`  失败: ${e.response?.data?.message || e.response?.data?.errmsg || e.message}\n`);
  }

  // 方法3：通过老接口 /topapi/chat/list
  console.log('方法3: 通过 topapi 查询群列表...');
  try {
    const res = await axios.post(
      `https://oapi.dingtalk.com/topapi/chat/list?access_token=${token}`,
      { useridList: [] }
    );
    if (res.data.errcode === 0) {
      console.log('✓ 成功!');
      console.log(JSON.stringify(res.data, null, 2));
      return;
    }
    console.log(`  失败: ${res.data.errmsg}\n`);
  } catch (e) {
    console.log(`  失败: ${e.message}\n`);
  }

  // 方法4：通过 chatId 转换（如果用户知道 chatId）
  console.log('方法4: 如果你知道群的 chatId，可以转换为 openConversationId...');
  try {
    // 尝试列出群（使用 robot 的 oapi）
    const res = await axios.get(
      `https://oapi.dingtalk.com/topapi/im/chat/scenegroup/list?access_token=${token}`
    );
    if (res.data.errcode === 0 && res.data.result) {
      console.log('✓ 找到群列表:');
      for (const group of res.data.result.scene_group_list || []) {
        console.log(`  群名: ${group.title}`);
        console.log(`  openConversationId: ${group.open_conversation_id}`);
        console.log('');
      }
      return;
    }
    console.log(`  失败: ${res.data.errmsg}\n`);
  } catch (e) {
    console.log(`  失败: ${e.message}\n`);
  }

  // 方法5：通过 webhook 发送一条特殊消息获取
  console.log('方法5: 通过 Stream 模式获取...');
  console.log('  需要安装 dingtalk-stream: npm install dingtalk-stream\n');

  console.log('━'.repeat(50));
  console.log('\n❓ 所有自动方法都失败了。请手动获取 openConversationId：\n');
  console.log('方式A（推荐）：钉钉开发者后台 → API调试工具');
  console.log('  1. 打开 https://open-dev.dingtalk.com/apiExplorer');
  console.log('  2. 搜索「根据chatId查询群会话的openConversationId」');
  console.log('  3. 或搜索「创建场景群」- 如果你创建过场景群\n');
  console.log('方式B：安装 dingtalk-stream SDK');
  console.log('  npm install dingtalk-stream');
  console.log('  然后重新运行此脚本（会自动尝试 Stream 模式）\n');
  console.log('方式C：在群里 @机器人 发消息');
  console.log('  如果你的应用配置了消息接收地址（HTTP回调），');
  console.log('  在群里 @机器人 发一条消息，回调数据中会包含 conversationId\n');

  // 检查是否安装了 dingtalk-stream
  try {
    const { DWClient, TOPIC_ROBOT } = require('dingtalk-stream');
    console.log('检测到 dingtalk-stream 已安装！正在启动 Stream 模式...');
    console.log('请在钉钉群里 @你的机器人 发送任意消息...\n');

    const client = new DWClient({
      clientId: process.env.DINGTALK_APP_KEY,
      clientSecret: process.env.DINGTALK_APP_SECRET,
    });

    client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
      const data = JSON.parse(res.data);
      console.log('━'.repeat(50));
      console.log('✅ 收到消息！以下是群会话信息：\n');
      console.log(`  conversationId: ${data.conversationId}`);
      console.log(`  conversationType: ${data.conversationType}`);
      console.log(`  senderNick: ${data.senderNick}`);
      console.log(`  chatbotCorpId: ${data.chatbotCorpId}`);
      console.log(`\n请将以下内容添加到 .env 文件：`);
      console.log(`DINGTALK_OPEN_CONVERSATION_ID=${data.conversationId}`);
      console.log('\n按 Ctrl+C 退出');
      return { status: 'OK' };
    });

    await client.connect();
    console.log('Stream 连接已建立，等待消息中...');

    // 保持进程运行
    await new Promise(() => {});
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.log('dingtalk-stream 未安装。如需使用 Stream 模式，请先运行：');
      console.log('  npm install dingtalk-stream\n');
    } else {
      console.log(`Stream 模式错误: ${e.message}`);
    }
  }
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
