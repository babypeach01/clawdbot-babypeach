/**
 * 查询钉钉文档的知识库和节点信息
 * 用法: node scripts/query-space-id.js [operatorId]
 *
 * operatorId 是你的钉钉 unionId，可以在应用后台查看
 * 如果不传，脚本会先尝试获取管理员信息
 */
require('dotenv').config();
const axios = require('axios');

const BASE = 'https://api.dingtalk.com';

async function main() {
  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  const docId = process.env.DINGTALK_DOC_ID;
  const operatorId = process.argv[2]; // 可选：传入 unionId

  // 1. 获取 access token
  const tokenRes = await axios.post(`${BASE}/v1.0/oauth2/accessToken`, {
    appKey,
    appSecret,
  });
  const token = tokenRes.data.accessToken;
  console.log('✅ Access Token 获取成功\n');

  const headers = { 'x-acs-dingtalk-access-token': token };

  // 2. 尝试多种 API 路径查找文档

  // 方式A: v2.0 知识库 API（需要 operatorId）
  if (operatorId) {
    console.log(`--- 使用 operatorId: ${operatorId} ---\n`);

    try {
      const res = await axios.get(`${BASE}/v2.0/wiki/workspaces`, {
        headers,
        params: { operatorId, maxResults: 50 },
      });
      console.log('知识库列表:');
      const workspaces = res.data.workspaces || [];
      workspaces.forEach(ws => {
        console.log(`  - ${ws.name} | workspaceId: ${ws.workspaceId} | rootNodeId: ${ws.rootNodeId}`);
      });
      console.log();

      // 遍历每个知识库查找目标文档
      for (const ws of workspaces) {
        try {
          const nodesRes = await axios.get(`${BASE}/v2.0/wiki/nodes`, {
            headers,
            params: { parentNodeId: ws.rootNodeId, operatorId, maxResults: 50 },
          });
          const nodes = nodesRes.data.nodes || [];
          console.log(`知识库 [${ws.name}] 的节点:`);
          nodes.forEach(n => {
            console.log(`  - ${n.name} | nodeId: ${n.nodeId} | type: ${n.type} | docKey: ${n.docKey || 'N/A'}`);
            if (n.nodeId === docId || n.docKey === docId) {
              console.log(`\n  >>> 找到目标文档! workspaceId: ${ws.workspaceId} <<<\n`);
            }
          });
          console.log();
        } catch (e) {
          console.log(`  知识库 [${ws.name}] 节点查询失败:`, e.response?.data?.message || e.message);
        }
      }
    } catch (e) {
      console.log('知识库列表查询失败:', e.response?.data || e.message);
    }
  } else {
    console.log('提示: 未传入 operatorId，跳过知识库查询');
    console.log('用法: node scripts/query-space-id.js <你的unionId>\n');
  }

  // 方式B: 尝试通过链接获取节点（不需要 operatorId）
  console.log('--- 尝试通过文档URL获取节点信息 ---\n');
  const docUrl = `https://alidocs.dingtalk.com/i/nodes/${docId}`;

  if (operatorId) {
    try {
      const res = await axios.post(`${BASE}/v2.0/wiki/nodeByUrl`, {
        url: docUrl,
        operatorId,
      }, { headers });
      console.log('通过URL查询结果:');
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
      console.log('通过URL查询失败:', e.response?.data?.message || e.message);
    }
  }

  // 方式C: 直接用 Workbook API 读取表格（不需要 spaceId）
  if (operatorId && docId) {
    console.log('\n--- 尝试 Workbook API (直接读取表格) ---\n');
    console.log(`workbookId: ${docId}`);
    console.log(`operatorId: ${operatorId}\n`);

    // C1: 获取工作表列表
    try {
      const res = await axios.get(`${BASE}/v1.0/doc/workbooks/${docId}/sheets`, {
        headers,
        params: { operatorId },
      });
      console.log('✅ 工作表列表:');
      const sheets = res.data.value || res.data.sheets || [];
      if (sheets.length === 0) {
        console.log('  (空)');
        console.log('  原始响应:', JSON.stringify(res.data).slice(0, 500));
      }
      for (const sheet of sheets) {
        const sheetId = sheet.id || sheet.sheetId;
        const sheetName = sheet.name || sheet.title || '未命名';
        console.log(`  - ${sheetName} | id: ${sheetId} | visibility: ${sheet.visibility || 'N/A'}`);

        // C2: 读取每个工作表的前几行数据
        try {
          const rangeAddr = `A1:Z5`; // 读取前5行
          const encodedName = encodeURIComponent(sheetName);
          const rangeRes = await axios.get(
            `${BASE}/v1.0/doc/workbooks/${docId}/sheets/${encodedName}/ranges/${rangeAddr}`,
            { headers, params: { operatorId } }
          );
          const values = rangeRes.data.displayValues || rangeRes.data.values || [];
          console.log(`    前5行数据:`);
          values.forEach((row, i) => {
            const rowStr = (row || []).map(c => c || '').join(' | ');
            console.log(`    [${i + 1}] ${rowStr}`);
          });
          console.log();
        } catch (e2) {
          console.log(`    读取数据失败: ${e2.response?.data?.message || e2.message}`);
          console.log(`    状态码: ${e2.response?.status}`);
        }
      }
    } catch (e) {
      console.log('Workbook API 失败:', e.response?.data?.message || e.message);
      console.log('  状态码:', e.response?.status);
      console.log('  完整错误:', JSON.stringify(e.response?.data || {}).slice(0, 500));
      console.log('\n  ⚠️  如果返回 403/权限错误，需要在钉钉开放平台给应用添加以下权限:');
      console.log('     - 文档 > 表格 > 获取工作表');
      console.log('     - 文档 > 表格 > 获取单元格区域');
      console.log('     应用管理后台: https://open-dev.dingtalk.com/');
    }
  }

  // 方式D: 获取管理员用户信息（拿 unionId）
  console.log('\n--- 获取管理员列表 (用于找 unionId) ---\n');
  try {
    const res = await axios.post(
      `https://oapi.dingtalk.com/topapi/user/listadmin?access_token=${token}`
    );
    if (res.data.errcode === 0 && res.data.result) {
      console.log('管理员列表:');
      res.data.result.forEach(admin => {
        console.log(`  - userId: ${admin.userid} | sys_level: ${admin.sys_level}`);
      });
      console.log('\n提示: 拿到 userId 后，可以用下面命令获取 unionId:');
      console.log('  node scripts/query-space-id.js --get-union <userId>\n');
    } else {
      console.log('获取管理员失败:', res.data.errmsg);
    }
  } catch (e) {
    console.log('管理员列表失败:', e.response?.data?.message || e.message);
  }

  // 获取指定 userId 的 unionId
  if (process.argv[2] === '--get-union' && process.argv[3]) {
    const userId = process.argv[3];
    try {
      const res = await axios.post(
        `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${token}`,
        { userid: userId }
      );
      if (res.data.errcode === 0) {
        const user = res.data.result;
        console.log(`\n用户信息: ${user.name}`);
        console.log(`  userId: ${user.userid}`);
        console.log(`  unionId: ${user.unionid}`);
        console.log(`\n现在可以用 unionId 查询知识库:`);
        console.log(`  node scripts/query-space-id.js ${user.unionid}`);
      } else {
        console.log('获取用户失败:', res.data.errmsg);
      }
    } catch (e) {
      console.log('用户查询失败:', e.response?.data?.message || e.message);
    }
  }
}

main().catch(e => console.error('错误:', e.response?.data || e.message));
