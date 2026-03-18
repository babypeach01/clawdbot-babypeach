/**
 * 基础功能测试
 * 验证任务解析器和数据流的正确性
 */
const taskParser = require('../src/modules/task-parser');

// 模拟文档内容
const mockDocContent = `
公司各部门周度工作进展追踪

【市场部 - 张三】
更新时间: 2026/3/18
1. Q2品牌推广方案 | 截止:3/25 | 进度:60% | 已完成线上渠道对接，线下物料制作中
2. 春季营销活动 | 截止:3/20 | 进度:85% | 方案已定稿，等待设计部出图
3. 竞品分析报告 | 截止:3/15 | 进度:40% | 延期，数据收集不完整

【技术部 - 李四】
更新时间: 2026/3/17
1. 系统v2.0升级 | 截止:3/22 | 进度:75% | 核心功能开发完成，进入联调测试阶段
2. 数据库迁移 | 截止:3/18 | 进度:20% | 阻塞：需要DBA支持，已提申请未排期
3. API文档整理 | 截止:3/30 | 进度:50% | 正常推进中

【财务部 - 王五】
更新时间: 2026/3/16
1. Q1财务报表 | 截止:3/20 | 进度:90% | 数据汇总完成，复核中
2. 年度预算编制 | 截止:4/10 | 进度:30% | 等待各部门提交预算需求
3. 供应商付款审批 | 截止:3/19 | 进度:100% | 已完成

【人力资源部 - 赵六】
1. 春季招聘计划 | 截止:3/25 | 进度:55% | 岗位JD已发布，简历筛选中
2. 员工培训方案 | 截止:3/28 | 进度:15% | 困难：培训供应商价格超预算，正在重新比价
`;

// 测试解析
console.log('=== 测试1: 文档解析 ===\n');
const result = taskParser.parseDocContent(mockDocContent);

console.log(`解析到 ${result.departments.length} 个部门:`);
for (const dept of result.departments) {
  console.log(`  ${dept.department} (${dept.owner}): ${dept.tasks.length} 个任务`);
  for (const task of dept.tasks) {
    const flags = [];
    if (task.isOverdue) flags.push('⏰逾期');
    if (task.isBlocked) flags.push('🚫阻塞');
    console.log(`    - ${task.name} | ${task.progress}% | 截止:${task.deadline} ${flags.join(' ')}`);
  }
}

console.log(`\n统计: 总${result.summary.totalTasks}个任务, ${result.summary.completedTasks}已完成, ${result.summary.overdueTasks}逾期, ${result.summary.blockedTasks}阻塞`);

// 测试变更检测
console.log('\n=== 测试2: 变更检测 ===\n');
const modifiedDoc = mockDocContent.replace('进度:60%', '进度:70%').replace('进度:20%', '进度:35%');
const newResult = taskParser.parseDocContent(modifiedDoc);
const changes = taskParser.detectChanges(newResult, result);
console.log(`检测到 ${changes.length} 项变更:`);
for (const change of changes) {
  console.log(`  [${change.type}] ${change.department} - ${change.task}: ${change.from}% → ${change.to}%`);
}

// 验证
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

console.log('\n=== 验证结果 ===\n');
assert(result.departments.length === 4, '解析到4个部门');
assert(result.summary.totalTasks === 11, '总共11个任务');
assert(result.summary.completedTasks === 1, '1个已完成');
assert(result.summary.overdueTasks >= 1, '至少1个逾期');
assert(result.summary.blockedTasks >= 1, '至少1个阻塞');
assert(changes.length === 2, '检测到2项变更');
assert(result.departments[0].department === '市场部', '第一个部门是市场部');
assert(result.departments[1].tasks[1].isBlocked === true, '数据库迁移任务被标记为阻塞');

console.log(`\n总计: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
