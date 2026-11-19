// scripts/preview-to-desktop.mjs
// 一键跳过开屏气球、直达小手机主桌面的便捷预览脚本
// 华专属定制 · 极速直达桌面

import { spawn } from 'child_process';
import http from 'http';

const TARGET_PORT = process.env.PORT || '3002';
const TARGET_URL = `http://localhost:${TARGET_PORT}/?direct=1`;

function checkServerReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${TARGET_PORT}/`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log(`\n📱 正在检查小手机服务 (端口 ${TARGET_PORT})...`);
  const isReady = await checkServerReady();

  if (!isReady) {
    console.log(`⚠️  端口 ${TARGET_PORT} 服务尚未启动，请先运行: npm run dev:3002`);
    process.exit(1);
  }

  console.log(`✨ 服务正常运行中！正在打开独立桌面预览窗口: ${TARGET_URL}`);

  // 在 Windows 上优先调用 msedge / chrome 以独立 App 窗口模式打开
  const isWin = process.platform === 'win32';
  if (isWin) {
    const browserProcess = spawn('cmd.exe', [
      '/c',
      'start',
      'msedge',
      `--app=${TARGET_URL}`,
      '--window-size=430,932',
    ], { detached: true, stdio: 'ignore' });
    browserProcess.unref();
  } else {
    const browserProcess = spawn('open', [TARGET_URL], { detached: true, stdio: 'ignore' });
    browserProcess.unref();
  }

  console.log(`🎉 已直达第三张图主页面！跳过开屏气球，无需手动点击右箭头。\n`);
}

main().catch(console.error);
