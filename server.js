'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { XianyuClient } = require('./lib/xianyu');
const { AppError } = require('./lib/errors');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, '.data');
const PORT = Number(process.env.PORT) || 7788;
const HOST = '127.0.0.1';

const client = new XianyuClient({
  profileDir: path.join(DATA_DIR, 'browser-profile'),
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
  );
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, limit = 262144) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(
          new AppError('BODY_TOO_LARGE', '请求内容过大。', {
            hint: 'Cookie 或请求内容请控制在 256KB 以内。',
            status: 413,
          }),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(
          new AppError('INVALID_JSON', '请求格式不正确。', {
            hint: '请刷新页面后重试。',
            status: 400,
          }),
        );
      }
    });
    req.on('error', reject);
  });
}

function normalizeKeyword(input) {
  const keyword = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!keyword) {
    throw new AppError('INVALID_KEYWORD', '请输入产品名称。', {
      hint: '例如：iPhone 15 Pro 256G、AirPods Pro 2、Switch OLED。',
      status: 400,
    });
  }
  if (keyword.length > 60) {
    throw new AppError('INVALID_KEYWORD', '产品名称太长。', {
      hint: '请控制在 60 个字符以内，型号和容量可以保留。',
      status: 400,
    });
  }
  return keyword;
}

function errorResponse(error) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = '程序遇到了一点问题。';
  let hint = '请稍后重试。';

  if (error instanceof AppError) {
    status = error.status || 500;
    code = error.code;
    message = error.message;
    hint = error.hint || '';
  } else if (error && /browser has been closed|Target page, context or browser/i.test(error.message)) {
    status = 500;
    code = 'BROWSER_CLOSED';
    message = '浏览器窗口被关闭了。';
    hint = '请重新点击查行情，程序会重新打开浏览器。';
  } else if (error && /Timeout/i.test(error.message)) {
    status = 504;
    code = 'TIMEOUT';
    message = '闲鱼页面响应超时。';
    hint = '请检查网络，或打开浏览器窗口确认闲鱼能正常访问后重试。';
  } else if (error && error.message) {
    message = '查询没有完成。';
    hint = String(error.message).slice(0, 180);
  }

  return { status, body: { ok: false, code, message, hint } };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, name: 'xianyu-price-ruler', version: '1.0.0' });
    return true;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    const state = await client.status();
    sendJson(res, 200, { ok: true, ...state });
    return true;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    await readJsonBody(req);
    const state = await client.openLogin();
    sendJson(res, 200, { ok: true, ...state });
    return true;
  }

  if (pathname === '/api/login/refresh' && req.method === 'POST') {
    await readJsonBody(req);
    const state = await client.refreshLogin();
    sendJson(res, 200, { ok: true, ...state });
    return true;
  }

  if (pathname === '/api/window' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (typeof body.visible !== 'boolean') {
      throw new AppError('INVALID_WINDOW_ACTION', '窗口开关参数不正确。', {
        hint: '请刷新页面后重试。',
        status: 400,
      });
    }
    const state = body.visible ? await client.showWindow() : await client.hideWindow();
    sendJson(res, 200, { ok: true, ...state });
    return true;
  }

  if (pathname === '/api/cookie' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const cookie = String(body.cookie || '').trim();
    if (!cookie) {
      throw new AppError('INVALID_COOKIE', '请粘贴 Cookie。', {
        hint: '从浏览器开发者工具的请求头中复制完整 Cookie。',
        status: 400,
      });
    }
    const state = await client.importCookies(cookie);
    sendJson(res, 200, { ok: true, ...state });
    return true;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    await readJsonBody(req);
    await client.close();
    sendJson(res, 200, { ok: true, ...client.getState() });
    return true;
  }

  if (pathname === '/api/search' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const keyword = normalizeKeyword(body.keyword);
    try {
      const result = await client.search(keyword);
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      const mapped = errorResponse(error);
      sendJson(res, mapped.status, { ...mapped.body, state: client.getState() });
    }
    return true;
  }

  return false;
}

function serveStatic(req, res, pathname) {
  let requested = pathname;
  if (requested === '/' || requested === '') requested = '/index.html';
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const resolved = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  if (stat.isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  const stream = fs.createReadStream(resolved);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Read error');
  });
  stream.pipe(res);
}

function openUi(url) {
  if (process.env.NO_OPEN === '1') return;
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 没有桌面环境时打不开浏览器，用户仍可手动访问控制台里的地址。
  }
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  let pathname;
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    pathname = url.pathname;
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '请求地址不正确。', hint: '' });
    return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        sendJson(res, 404, {
          ok: false,
          code: 'NOT_FOUND',
          message: '接口不存在。',
          hint: '请刷新页面后重试。',
        });
      }
    } catch (error) {
      if (res.headersSent) return;
      const mapped = errorResponse(error);
      if (mapped.status >= 500) {
        console.error(`[api] ${req.method} ${pathname} failed:`, error);
      }
      sendJson(res, mapped.status, {
        ...mapped.body,
        state: client.getState(),
      });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return;
  }
  serveStatic(req, res, pathname);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。`);
    console.error(`请关闭占用该端口的程序，或用 PORT=7799 换一个端口启动。\n`);
  } else {
    console.error('[server] error:', error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  闲鱼价尺 / Xianyu Price Ruler');
  console.log(`  ${url}`);
  console.log('');
  console.log('  闲鱼窗口默认隐藏，可在页面顶部开关显示。');
  console.log('  首次查询扫码登录后，登录状态会保存在 .data/browser-profile。');
  console.log('  按 Ctrl+C 停止。');
  console.log('');
  openUi(url);

  if (process.env.NO_RESTORE !== '1') {
    setTimeout(() => {
      client
        .restoreSession()
        .then((state) => {
          if (state.loggedIn) console.log('[auth] saved login restored in background');
        })
        .catch((error) => {
          console.error('[auth] background restore failed:', error.message);
        });
    }, 700);
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal}, closing...`);
  server.close();
  await client.close().catch(() => {});
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  console.error('[process] unhandled rejection:', error);
});
