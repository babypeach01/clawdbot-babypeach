@echo off
chcp 65001 >nul
title ClawdBot 催办发送工具

echo ========================================
echo   ClawdBot 本地催办发送工具
echo ========================================
echo.

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未安装 Node.js，请先安装: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 node_modules
if not exist "node_modules" (
    echo 首次运行，安装依赖...
    call npm install
    echo.
)

echo 请选择操作：
echo.
echo   [1] 发送汇总催办（推荐）
echo   [2] 测试连通性
echo   [3] 预览消息（不发送）
echo   [4] 导入新文档并发送
echo   [5] 按部门发送
echo   [6] 按个人发送
echo.
set /p choice=请输入选项 (1-6):

if "%choice%"=="1" (
    node scripts/local-send.js
) else if "%choice%"=="2" (
    node scripts/local-send.js --test
) else if "%choice%"=="3" (
    node scripts/local-send.js --dry-run
) else if "%choice%"=="4" (
    echo.
    set /p filepath=请输入文档路径（可拖拽文件到此处）:
    node scripts/local-send.js --file "%filepath%"
) else if "%choice%"=="5" (
    echo.
    set /p deptname=请输入部门名称:
    node scripts/local-send.js --dept "%deptname%"
) else if "%choice%"=="6" (
    echo.
    set /p personname=请输入姓名:
    node scripts/local-send.js --person "%personname%"
) else (
    echo 无效选项
)

echo.
pause
