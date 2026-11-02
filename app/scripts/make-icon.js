// 把 build/icon.svg 渲染成 1024×1024 的 build/icon.png，electron-builder 打包时再转成 ico。
// 用法：npm run icon（改了 icon.svg 之后运行）
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const buildDir = path.resolve(__dirname, '..', 'build');

// 在隐藏窗口里用 canvas 画 SVG 再导出 PNG，不依赖截图，和屏幕缩放无关
async function render(svg) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/png');
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const dataUrl = await win.webContents.executeJavaScript(
    `const SIZE = ${SIZE}; (${render})(${JSON.stringify(svg)})`,
  );
  fs.writeFileSync(path.join(buildDir, 'icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`已生成 build/icon.png（${SIZE}×${SIZE}）`);
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
