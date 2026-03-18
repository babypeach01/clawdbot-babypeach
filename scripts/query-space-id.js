/**
 * 查询钉钉文档的 SpaceId
 * 用法: node scripts/query-space-id.js
 */
require('dotenv').config();
const axios = require('axios');

async function main() {
  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  const docId = process.env.DINGTALK_DOC_ID;

  // 1. 获取 access token
  const tokenRes = await axios.post('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    appKey,
    appSecret,
  });
  const token = tokenRes.data.accessToken;
  console.log('Access Token 获取成功\n');

  // 2. 通过 nodeId 查询节点信息（包含 spaceId）
  try {
    const res = await axios.get(`https://api.dingtalk.com/v1.0/doc/nodes/${docId}`, {
      headers: { 'x-acs-dingtalk-access-token': token },
    });
    console.log('文档节点信息:');
    console.log(JSON.stringify(res.data, null, 2));
    if (res.data.spaceId) {
      console.log(`\n>>> SpaceId: ${res.data.spaceId} <<<`);
    }
  } catch (e) {
    console.log('节点查询失败:', e.response?.data || e.message);
  }

  // 3. 备选：列出空间
  try {
    const res = await axios.post('https://api.dingtalk.com/v1.0/doc/spaces/query', {}, {
      headers: { 'x-acs-dingtalk-access-token': token },
    });
    console.log('\n空间列表:');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log('\n空间列表查询失败:', e.response?.data || e.message);
  }
}

main().catch(e => console.error('错误:', e.response?.data || e.message));
