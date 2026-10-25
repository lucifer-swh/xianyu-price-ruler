'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { buildMarketResult } = require('../lib/market');

const OUT = path.resolve('docs');
fs.mkdirSync(OUT, { recursive: true });

const titles = [
  'iPhone 15 Pro 256G 国行 电池92 无拆修',
  '自用 iPhone 15 Pro 256 蓝色 全套带票',
  'iPhone 15 Pro 256G 原色钛金属 在保',
  '15 Pro 256G 国行 成色很好 可小刀',
  'iPhone 15 Pro 256G 无锁 换过电池',
  '自用一手的 15 Pro 256G 黑色 配件齐',
  'iPhone 15 Pro 256G 美版无锁 99新',
  '15 Pro 256G 国行 电池100 仅拆封',
  'iPhone 15 Pro 256G 白色 轻微使用痕迹',
  '15 Pro 256G 国行 全套 支持验货',
  'iPhone 15 Pro 256G 蓝色 自提优先',
  '15 Pro 256G 港版 双卡 成色好',
];
const tagsPool = [
  ['95新', '国行', '验货宝'],
  ['99新', '在保', '包邮'],
  ['9成新', '无拆修', '自提'],
  ['95新', '全套', '可小刀'],
  ['全新', '仅拆封', '国行'],
  ['9成新', '换过电池', '无锁'],
];

function placeholder(index) {
  const hue = 35 + ((index * 47) % 180);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 32% 84%)"/>
      <stop offset="1" stop-color="hsl(${hue + 28} 28% 66%)"/>
    </linearGradient></defs>
    <rect width="160" height="160" fill="url(#g)"/>
    <rect x="49" y="25" width="62" height="112" rx="13" fill="rgba(255,255,255,.72)" stroke="rgba(23,25,20,.35)" stroke-width="2"/>
    <rect x="57" y="38" width="46" height="76" rx="4" fill="rgba(23,25,20,.13)"/>
    <circle cx="80" cy="124" r="3" fill="rgba(23,25,20,.35)"/>
    <circle cx="62" cy="18" r="15" fill="rgba(255,225,75,.8)"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeMock() {
  const listings = [];
  const base = [3280, 3499, 3680, 3750, 3880, 3999, 4080, 4150, 4200, 4260, 4320, 4380];
  for (let i = 0; i < 42; i += 1) {
    const price = base[i % base.length] + Math.floor(i / base.length) * 65;
    listings.push({
      id: `mock-${i}`,
      title: titles[i % titles.length],
      price,
      seller: ['海边的风', '数码小铺', '一只柠檬', '老王自用', '橙色星球'][i % 5],
      location: ['上海', '杭州', '北京', '深圳', '成都', '南京'][i % 6],
      tags: tagsPool[i % tagsPool.length],
      wants: 12 + ((i * 17) % 90),
      image: placeholder(i),
      url: `https://www.goofish.com/item?id=mock${i}`,
      publishedAt: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      isAd: false,
    });
  }
  const accessories = [39, 58, 88].map((price, index) => ({
    id: `acc-${index}`,
    title: 'iPhone 15 Pro 手机壳 透明防摔',
    price,
    seller: '配件小铺',
    location: '广州',
    tags: ['包邮', '全新'],
    wants: 5,
    image: placeholder(80 + index),
    url: `https://www.goofish.com/item?id=acc${index}`,
    publishedAt: new Date().toISOString(),
    isAd: false,
  }));
  const ads = [9999, 8888].map((price, index) => ({
    id: `ad-${index}`,
    title: 'iPhone 15 Pro 全新 官方正品',
    price,
    seller: '广告商家',
    location: '杭州',
    tags: ['全新'],
    wants: 0,
    image: placeholder(100 + index),
    url: `https://www.goofish.com/item?id=ad${index}`,
    publishedAt: new Date().toISOString(),
    isAd: true,
  }));
  const duplicates = listings.slice(0, 2).map((item) => ({ ...item }));

  return buildMarketResult({
    keyword: 'iPhone 15 Pro 256G',
    listings: [...listings, ...accessories, ...ads, ...duplicates],
    pagesFetched: 2,
    totalFound: 428,
    warnings: ['第二页只加载到 27 条，本次统计以已抓取样本为准。'],
  });
}

async function mockLoggedIn(page) {
  let windowVisible = false;
  const statusPayload = () => ({
    ok: true,
    browserOpen: true,
    loggedIn: true,
    user: { nick: '海边的风', id: '1', avatar: '' },
    loginWindowOpen: false,
    loginExpired: false,
    verifying: false,
    windowVisible,
    restoring: false,
    profileSaved: true,
    lastError: null,
  });
  await page.route('**/api/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusPayload()),
    }),
  );
  await page.route('**/api/window', (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || '{}');
    } catch {
      body = {};
    }
    windowVisible = Boolean(body.visible);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusPayload()),
    });
  });
  await page.route('**/api/search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: makeMock() }),
    }),
  );
}

async function mockLoginRequired(page) {
  await page.route('**/api/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        browserOpen: true,
        loggedIn: false,
        user: null,
        loginWindowOpen: true,
        loginExpired: false,
        verifying: false,
        windowVisible: true,
        restoring: false,
        profileSaved: true,
        lastError: null,
      }),
    }),
  );
  await page.route('**/api/search', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'LOGIN_REQUIRED',
        message: '查询闲鱼行情需要先登录。',
        hint: '登录窗口已经打开，请用闲鱼 App 扫码；登录成功后会自动继续。',
        state: {
          browserOpen: true,
          loggedIn: false,
          user: null,
          loginWindowOpen: true,
          loginExpired: false,
          verifying: false,
          windowVisible: true,
          restoring: false,
          profileSaved: true,
          lastError: null,
        },
      }),
    }),
  );
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const errors = [];

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  desktop.on('pageerror', (error) => errors.push(`desktop pageerror: ${error.message}`));
  desktop.on('console', (message) => {
    if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`);
  });
  await mockLoggedIn(desktop);
  await desktop.goto('http://127.0.0.1:7788', { waitUntil: 'networkidle' });
  await desktop.waitForTimeout(500);
  await desktop.screenshot({ path: path.join(OUT, 'preview-landing.png'), fullPage: true });

  await desktop.fill('#keyword', 'iPhone 15 Pro 256G');
  await desktop.click('#searchBtn');
  await desktop.waitForSelector('#resultSection:not([hidden])', { timeout: 15000 });
  await desktop.waitForTimeout(1100);
  await desktop.screenshot({ path: path.join(OUT, 'preview-result-viewport.png') });

  console.log('desktop scroll width:', await desktop.evaluate(() => [document.body.scrollWidth, window.innerWidth]));
  console.log('desktop listings shown:', await desktop.locator('.listing').count());
  console.log('desktop range:', (await desktop.locator('#rangePrice').innerText()).replace(/\n/g, ' '));
  console.log('desktop result height:', await desktop.locator('#resultSection').evaluate((el) => el.scrollHeight));

  const initialSwitch = await desktop.locator('#windowToggle').getAttribute('aria-checked');
  await desktop.click('#windowToggle');
  await desktop.waitForFunction(
    () => document.querySelector('#windowToggle').getAttribute('aria-checked') === 'true',
  );
  const shownSwitch = await desktop.locator('#windowToggle').getAttribute('aria-checked');
  await desktop.click('#windowToggle');
  await desktop.waitForFunction(
    () => document.querySelector('#windowToggle').getAttribute('aria-checked') === 'false',
  );
  const hiddenSwitch = await desktop.locator('#windowToggle').getAttribute('aria-checked');
  console.log('window switch:', initialSwitch, shownSwitch, hiddenSwitch);

  await desktop.click('#listToggleBtn');
  await desktop.waitForFunction(() => document.querySelectorAll('.listing').length === 42);
  const expandedCount = await desktop.locator('.listing').count();
  const expandedLabel = await desktop.locator('#listToggleBtn').innerText();
  await desktop.click('#listToggleBtn');
  await desktop.waitForFunction(() => document.querySelectorAll('.listing').length === 12);
  const collapsedCount = await desktop.locator('.listing').count();
  console.log('list toggle:', expandedCount, expandedLabel, collapsedCount);

  await desktop.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:7788',
  });
  await desktop.click('#copyBtn');
  await desktop.waitForTimeout(400);
  const clipboard = await desktop.evaluate(() => navigator.clipboard.readText());
  console.log('clipboard starts:', clipboard.split('\n')[0]);

  const downloadPromise = desktop.waitForEvent('download', { timeout: 8000 });
  await desktop.click('#exportBtn');
  const download = await downloadPromise;
  console.log('download:', download.suggestedFilename());

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  mobile.on('pageerror', (error) => errors.push(`mobile pageerror: ${error.message}`));
  await mockLoggedIn(mobile);
  await mobile.goto('http://127.0.0.1:7788', { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(500);
  await mobile.fill('#keyword', 'iPhone 15 Pro 256G');
  await mobile.click('#searchBtn');
  await mobile.waitForSelector('#resultSection:not([hidden])', { timeout: 15000 });
  await mobile.waitForTimeout(1000);
  console.log('mobile scroll width:', await mobile.evaluate(() => [document.body.scrollWidth, window.innerWidth]));
  console.log('mobile switch:', await mobile.locator('#windowToggle').getAttribute('aria-checked'));

  const login = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  login.on('pageerror', (error) => errors.push(`login pageerror: ${error.message}`));
  await mockLoginRequired(login);
  await login.goto('http://127.0.0.1:7788', { waitUntil: 'networkidle' });
  await login.fill('#keyword', 'Switch OLED');
  await login.click('#searchBtn');
  await login.waitForSelector('#loginDialog[open]', { timeout: 8000 });
  await login.waitForTimeout(500);
  await login.screenshot({ path: path.join(OUT, 'preview-login.png') });

  console.log('errors:', JSON.stringify(errors, null, 2));
  await browser.close();
})();
