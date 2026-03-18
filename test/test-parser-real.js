/**
 * 使用实际文档片段测试解析器
 */
const taskParser = require('../src/modules/task-parser');

// 取实际文档的前几个部门作为测试样本
const realDocSample = `3月各部门工作任务
全体：
待完成
1. 龙虾机器人飞书布局及调用2天内必须完成 $\\color{#0089FF}{@胡瑾}$
2. 所有表格内容更新
3. 3月回款目标2000
已完成
1. 各负责人任务清单梳理及撰写
2. 全体人员：openclaw机器人的使用和匹配情况，整体clawdbot的进度和计划表产出，自身网站搭建计划表产出，截止时间为3.5（下午下班前）
一、后市场部 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ $\\color{#0089FF}{@王雨洁-P6C(王雨洁)}$
待完成：
（一）阶段目标：
1. 后市场整体业务（售后及贷后）规划报告（3.16上交）： $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ $\\color{#0089FF}{@王雨洁-P6C(王雨洁)}$
2. 时间范围：45天（3月剩余2周及4月全月）
* 按照7天，14天，21天，30天的时间节点，明确各节点目标及达成进度。
（四）找车/收车： $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$
1. 待回收3月需要降低至55以内 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$
2. 针对江苏盐城库车辆，无法对于价格达成共识 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ ：暂时无人能解决，寻求办法中
3. 12.26张创车辆，24款，广州停车场人员密切关注，务必追回车辆 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ ：推进中
4. 山东极星车辆推进收回工作 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ ：收车中
5. 蒋思佳2台车取回，及报价评估 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ ：仅找到1辆，为不惊动对方，仍在蹲守收车中
已完成：
1. 保险重点催收东莞壹指/杭州智选/上海智可选 $\\color{#0089FF}{@王雨洁-P6C(王雨洁)}$ ：均已通知到顾客，全面推进收款中
2. 违章相关车辆处理规则 $\\color{#0089FF}{@吕鹏飞-PM8C(吕鹏飞)}$ $\\color{#0089FF}{@王怡涵-PM8C(王怡涵)}$ ：流程已出
二、汽车销售部 $\\color{#0089FF}{@钟鸣宇-PM8C(钟鸣宇)}$
待完成：
（一）车辆销售：
1. ID4处理进度追踪 $\\color{#0089FF}{@钟鸣宇-PM8C(钟鸣宇)}$ ：剩3
2. 长鑫两台逾期车辆补款或扣押金并文字留档 $\\color{#0089FF}{@钟鸣宇-PM8C(钟鸣宇)}$ ：出完剩下一台退6w押金
（二）二手车销售： $\\color{#0089FF}{@彭钰峰- P7C(彭钰峰)}$
1. 彭本月销售二手车不得低于40 $\\color{#0089FF}{@彭钰峰- P7C(彭钰峰)}$ 已卖出17台，其中4乐道，13极氪
已完成：
1. 中铁建销售相关信息发至老板 $\\color{#0089FF}{@钟鸣宇-PM8C(钟鸣宇)}$ ：其全部车型均可售卖，相关信息已发老板
八、人事部 $\\color{#0089FF}{@钟颖仪-P7C(钟颖仪)}$
待完成：
（一）招聘工作
1. 北京总助招聘工作推进 $\\color{#0089FF}{@郭倩-P7C(郭倩-噗噗)}$ $\\color{#0089FF}{@钟颖仪-P7C(钟颖仪)}$ ：招聘进行中，由于北京无固定办公地址，招聘效果不佳
2. 南京及杭州招聘事宜加速推进（总助招聘22日前务必完成） $\\color{#0089FF}{@郭倩-P7C(郭倩-噗噗)}$ $\\color{#0089FF}{@钟颖仪-P7C(钟颖仪)}$
已完成：
`;

const result = taskParser.parseDocContent(realDocSample);

console.log('========== 解析结果摘要 ==========');
console.log(`部门数量: ${result.departments.length}`);
console.log(`总任务数: ${result.summary.totalTasks}`);
console.log(`已完成: ${result.summary.completedTasks}`);
console.log(`推进中: ${result.summary.inProgressTasks}`);
console.log(`催办中: ${result.summary.pendingResponseTasks}`);
console.log(`阻塞: ${result.summary.blockedTasks}`);
console.log(`暂缓: ${result.summary.onHoldTasks}`);
console.log('');

for (const dept of result.departments) {
  console.log(`\n===== ${dept.department} (负责人: ${dept.owner}) =====`);
  console.log(`  待完成: ${dept.pendingCount}  |  已完成: ${dept.completedCount}`);

  for (const task of dept.tasks) {
    const flag = task.isCompleted ? '[已完成]' : `[${task.status}]`;
    const sub = task.subSection ? `<${task.subSection}> ` : '';
    console.log(`  ${flag} ${sub}${task.title}`);
    if (task.owners.length > 0) console.log(`         负责人: ${task.owners.join(', ')}`);
    if (task.notes) console.log(`         备注: ${task.notes.substring(0, 60)}...`);
  }
}
