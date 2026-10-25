'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const {
  AppError,
  BrowserUnavailableError,
  BusyError,
  LoginRequiredError,
  RiskControlError,
} = require('./errors');
const { normalizeSearchResponse } = require('./normalize');
const { buildMarketResult } = require('./market');

const APP_KEY = '34839810';
const HOME_URL = 'https://www.goofish.com/';
const LOGIN_URL =
  'https://passport.goofish.com/mini_login.htm?lang=zh_cn&appName=xianyu&appEntrance=web' +
  '&styleType=vertical&notKeepLogin=false&isMobile=false&qrCodeFirst=true' +
  '&fromSite=77&returnUrl=https%3A%2F%2Fwww.goofish.com%2F';
const SEARCH_API = 'mtop.taobao.idlemtopsearch.pc.search';
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 900;
const HIDDEN_LEFT = -32000;
const HIDDEN_TOP = -32000;
const LOGIN_COOKIE_NAMES = new Set([
  'unb',
  '_nk_',
  'tracknick',
  'havana_lgc2_77',
  'lgc',
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBrowserExecutable() {
  const candidates = [];
  if (process.env.XIANYU_BROWSER_PATH) {
    candidates.push({ path: process.env.XIANYU_BROWSER_PATH, name: '自定义浏览器' });
  }

  if (process.platform === 'win32') {
    candidates.push(
      { path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', name: 'Microsoft Edge' },
      { path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', name: 'Microsoft Edge' },
      { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome' },
      { path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome' },
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', name: 'Microsoft Edge' },
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Google Chrome' },
      { path: '/Applications/Chromium.app/Contents/MacOS/Chromium', name: 'Chromium' },
    );
  } else {
    candidates.push(
      { path: '/usr/bin/microsoft-edge', name: 'Microsoft Edge' },
      { path: '/usr/bin/google-chrome', name: 'Google Chrome' },
      { path: '/usr/bin/chromium', name: 'Chromium' },
      { path: '/usr/bin/chromium-browser', name: 'Chromium' },
    );
  }

  for (const candidate of candidates) {
    try {
      if (candidate.path && fs.existsSync(candidate.path)) return candidate;
    } catch {
      // 忽略无权限访问的路径，继续找下一个。
    }
  }

  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) {
      return { path: bundled, name: 'Chromium' };
    }
  } catch {
    // playwright-core 没有下载浏览器时会抛错，忽略。
  }
  return null;
}

function parseCookieHeader(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  let source = text;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed)
          .filter(([name, value]) => name && value !== undefined && value !== null)
          .map(([name, value]) => [name.trim(), String(value)]);
      }
    } catch {
      // 不是 JSON，继续按 Cookie 请求头解析。
    }
  }
  source = source.replace(/^cookie\s*:\s*/i, '');
  const pairs = [];
  for (const part of source.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && value) pairs.push([name, value]);
  }
  return pairs;
}

function extractUser(data) {
  const source = data && typeof data === 'object' ? data : {};
  const nested = source.user && typeof source.user === 'object' ? source.user : {};
  const nick =
    source.nick ||
    source.nickName ||
    source.nickname ||
    source.userNick ||
    nested.nick ||
    nested.nickName ||
    '闲鱼用户';
  const id =
    source.userId ||
    source.user_id ||
    source.id ||
    nested.userId ||
    nested.user_id ||
    nested.id ||
    '';
  const avatar =
    source.avatar ||
    source.avatarUrl ||
    source.headImg ||
    nested.avatar ||
    nested.avatarUrl ||
    '';
  return {
    nick: String(nick),
    id: id ? String(id) : '',
    avatar: avatar ? String(avatar) : '',
  };
}

class XianyuClient {
  constructor({ profileDir, logger = console } = {}) {
    this.profileDir = profileDir || path.resolve(process.cwd(), '.data', 'browser-profile');
    this.logger = logger;
    this.context = null;
    this.workPage = null;
    this.loginPage = null;
    this.user = null;
    this.loggedIn = false;
    this.loginExpired = false;
    this.lastError = null;
    this.launchPromise = null;
    this.verifyPromise = null;
    this.searching = false;
    this.lastVerifyAttempt = 0;
    this.windowVisible = false;
    this.restoring = false;
    this.windowAutoHideToken = 0;
    this.profileSaved = this._detectSavedProfile();
  }

  _detectSavedProfile() {
    try {
      const entries = fs.readdirSync(this.profileDir);
      return entries.some((name) => name === 'Default' || name === 'Local State');
    } catch {
      return false;
    }
  }

  getState() {
    return {
      browserOpen: Boolean(this.context),
      loggedIn: Boolean(this.loggedIn),
      user: this.user,
      loginWindowOpen: Boolean(this.loginPage && !this.loginPage.isClosed()),
      loginExpired: Boolean(this.loginExpired),
      verifying: Boolean(this.verifyPromise),
      windowVisible: Boolean(this.context && this.windowVisible),
      restoring: Boolean(this.restoring),
      profileSaved: Boolean(this.profileSaved),
      lastError: this.lastError
        ? {
            code: this.lastError.code || 'ERROR',
            message: this.lastError.message || String(this.lastError),
            hint: this.lastError.hint || '',
          }
        : null,
    };
  }

  async ensureBrowser() {
    if (this.context) return this.context;
    if (this.launchPromise) return this.launchPromise;
    this.launchPromise = this._launchBrowser();
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  async _launchBrowser() {
    const browser = findBrowserExecutable();
    if (!browser) {
      throw new BrowserUnavailableError(
        '没有找到可用的 Edge / Chrome 浏览器。',
        '请安装 Microsoft Edge，或设置环境变量 XIANYU_BROWSER_PATH 指向浏览器可执行文件。',
      );
    }

    fs.mkdirSync(this.profileDir, { recursive: true });
    this.logger.log(`[browser] launching ${browser.name}: ${browser.path}`);
    try {
      const context = await chromium.launchPersistentContext(this.profileDir, {
        executablePath: browser.path,
        headless: false,
        viewport: null,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        acceptDownloads: false,
        timeout: 45000,
        args: [
          `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
          `--window-position=${HIDDEN_LEFT},${HIDDEN_TOP}`,
          '--disable-blink-features=AutomationControlled',
          '--disable-session-crashed-bubble',
          '--hide-crash-restore-bubble',
          '--no-default-browser-check',
          '--no-first-run',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      context.on('close', () => this._onBrowserClosed());
      this.context = context;
      this.windowVisible = false;
      this.profileSaved = true;
      this.logger.log('[browser] ready (window hidden)');
      return context;
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      this.logger.error('[browser] launch failed:', message);
      if (/ProcessSingleton|user data directory is already in use|profile.*in use/i.test(message)) {
        throw new BrowserUnavailableError(
          '闲鱼登录浏览器已经在运行，或上次没有正常关闭。',
          '请关闭之前打开的浏览器窗口后重试；如果找不到窗口，重启电脑或删除 .data/browser-profile/SingletonLock。',
          error,
        );
      }
      throw new BrowserUnavailableError(
        `浏览器启动失败：${message.slice(0, 180)}`,
        '请确认浏览器可以正常打开，并允许本程序启动本机浏览器。',
        error,
      );
    }
  }

  _onBrowserClosed() {
    this.logger.log('[browser] closed');
    this.context = null;
    this.workPage = null;
    this.loginPage = null;
    this.user = null;
    this.loggedIn = false;
    this.loginExpired = false;
    this.lastError = null;
    this.verifyPromise = null;
    this.windowVisible = false;
    this.profileSaved = this._detectSavedProfile();
    this.windowAutoHideToken += 1;
  }

  async _getWorkPage() {
    await this.ensureBrowser();
    if (this.workPage && !this.workPage.isClosed()) return this.workPage;
    const page = await this.context.newPage();
    page.setDefaultTimeout(30000);
    this.workPage = page;
    page.on('close', () => {
      if (this.workPage === page) this.workPage = null;
    });
    return page;
  }

  _getExistingPage() {
    if (this.workPage && !this.workPage.isClosed()) return this.workPage;
    if (this.loginPage && !this.loginPage.isClosed()) return this.loginPage;
    if (!this.context) return null;
    return this.context.pages().find((page) => !page.isClosed()) || null;
  }

  async _applyWindowBounds(page, visible) {
    if (!this.context || !page || page.isClosed()) return false;
    let session = null;
    try {
      session = await this.context.newCDPSession(page);
      const { windowId } = await session.send('Browser.getWindowForTarget');
      if (visible) {
        let screen = { width: 1440, height: 900 };
        try {
          const measured = await page.evaluate(() => ({
            width: window.screen.availWidth || 1440,
            height: window.screen.availHeight || 900,
          }));
          if (measured.width > 0 && measured.height > 0) screen = measured;
        } catch {
          // 页面暂时不可用时使用保守尺寸。
        }
        const width = Math.max(700, Math.min(WINDOW_WIDTH, screen.width - 100));
        const height = Math.max(560, Math.min(WINDOW_HEIGHT, screen.height - 110));
        const left = Math.max(0, Math.round((screen.width - width) / 2));
        const top = Math.max(0, Math.round((screen.height - height) / 2));
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        });
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: { left, top, width, height, windowState: 'normal' },
        });
        await page.bringToFront().catch(() => {});
        this.windowVisible = true;
        this.logger.log('[window] shown');
      } else {
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        });
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            left: HIDDEN_LEFT,
            top: HIDDEN_TOP,
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            windowState: 'normal',
          },
        });
        this.windowVisible = false;
        this.logger.log('[window] hidden');
      }
      return true;
    } catch (error) {
      this.logger.warn('[window] bounds update failed:', error.message);
      if (visible) await page.bringToFront().catch(() => {});
      return false;
    } finally {
      if (session) await session.detach().catch(() => {});
    }
  }

  async showWindow() {
    await this.ensureBrowser();
    this.profileSaved = true;
    if (!this.loggedIn && (await this._hasLoginMarker())) {
      await this.verifyLogin().catch(() => false);
    }
    this.windowAutoHideToken += 1;
    if (!this.loggedIn) {
      if (this.loginPage && !this.loginPage.isClosed()) {
        await this._applyWindowBounds(this.loginPage, true);
        return this.getState();
      }
      return this.openLogin();
    }
    const page = await this._getWorkPage();
    if (!/^https:\/\/(www\.)?goofish\.com\//i.test(page.url())) {
      await this._gotoHome(page).catch(() => {});
    }
    await this._applyWindowBounds(page, true);
    return this.getState();
  }

  async hideWindow() {
    this.windowAutoHideToken += 1;
    if (!this.context) {
      this.windowVisible = false;
      return this.getState();
    }
    const page = this._getExistingPage();
    if (!page) {
      this.windowVisible = false;
      return this.getState();
    }
    await this._applyWindowBounds(page, false);
    return this.getState();
  }

  _scheduleAutoHide() {
    this.windowAutoHideToken += 1;
    const token = this.windowAutoHideToken;
    setTimeout(() => {
      if (token !== this.windowAutoHideToken || !this.loggedIn || !this.windowVisible) return;
      this.hideWindow().catch(() => {});
    }, 800);
  }

  async restoreSession() {
    if (this.context || !this.profileSaved) return this.getState();
    this.restoring = true;
    this.logger.log('[auth] restoring saved browser session');
    try {
      await this.ensureBrowser();
      const ok = await this.verifyLogin();
      if (!ok) {
        this.loginExpired = !this.lastError && (await this._hasLoginMarker());
        this.logger.log('[auth] saved session has no valid login');
      } else {
        this.logger.log('[auth] saved session restored');
      }
    } catch (error) {
      this.logger.warn('[auth] session restore failed:', error.message);
      this.lastError = error;
    } finally {
      this.restoring = false;
    }
    return this.getState();
  }

  async _hasLoginMarker() {
    if (!this.context) return false;
    try {
      const cookies = await this.context.cookies();
      return cookies.some((cookie) => {
        if (!LOGIN_COOKIE_NAMES.has(cookie.name) || !cookie.value) return false;
        const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
        return domain.endsWith('goofish.com') || domain.endsWith('taobao.com');
      });
    } catch {
      return false;
    }
  }

  async _waitForMtop(page) {
    try {
      await page.waitForFunction(
        () => Boolean(window.lib && window.lib.mtop && typeof window.lib.mtop.request === 'function'),
        { timeout: 20000 },
      );
      return;
    } catch {
      this.logger.warn('[browser] window.lib.mtop not ready, retrying once');
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForFunction(
      () => Boolean(window.lib && window.lib.mtop && typeof window.lib.mtop.request === 'function'),
      { timeout: 20000 },
    );
  }

  async _assertNotBlocked(page) {
    if (!page || page.isClosed()) {
      throw new AppError('BROWSER_ERROR', '浏览器页面已关闭。', {
        hint: '请重新点击查行情，程序会自动打开新的页面。',
        status: 500,
      });
    }
    const url = page.url();
    if (/_____tmd_____|\/punish|punish\?/i.test(url)) {
      await this._applyWindowBounds(page, true).catch(() => {});
      throw new RiskControlError(
        '闲鱼要求先完成安全验证。',
        '浏览器窗口已经打开，请在其中完成验证，然后重新查询。',
      );
    }
    const body = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
    if (/非法访问|使用正常浏览器访问/.test(body)) {
      await this._applyWindowBounds(page, true).catch(() => {});
      throw new AppError(
        'BLOCKED',
        '闲鱼拒绝了当前浏览器访问。',
        {
          hint: '请在弹出的浏览器窗口中打开闲鱼并完成验证；如果持续出现，请更新 Edge 后重试。',
          status: 409,
        },
      );
    }
  }

  async _gotoHome(page) {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this._assertNotBlocked(page);
    await this._waitForMtop(page);
  }

  async _requestLoginUser(page) {
    return page.evaluate(
      async ({ api, appKey }) => {
        try {
          return await window.lib.mtop.request({
            api,
            v: '1.0',
            type: 'POST',
            appKey,
            accountSite: 'xianyu',
            dataType: 'json',
            timeout: 15000,
            needLoginPC: false,
            showErrorToast: false,
            needLogin: false,
            sessionOption: 'AutoLoginOnly',
            ecode: 0,
            data: {},
          });
        } catch (error) {
          return { __error: String((error && error.message) || error) };
        }
      },
      { api: 'mtop.taobao.idlemessage.pc.loginuser.get', appKey: APP_KEY },
    );
  }

  async verifyLogin() {
    if (this.verifyPromise) return this.verifyPromise;
    this.verifyPromise = this._verifyLogin().finally(() => {
      this.verifyPromise = null;
    });
    return this.verifyPromise;
  }

  async _verifyLogin() {
    if (!this.context) return false;
    if (!(await this._hasLoginMarker())) {
      this.loggedIn = false;
      this.user = null;
      return false;
    }

    try {
      const page = await this._getWorkPage();
      if (!/^https:\/\/(www\.)?goofish\.com\//i.test(page.url())) {
        await this._gotoHome(page);
      } else {
        await this._waitForMtop(page);
      }
      await this._assertNotBlocked(page);
      const result = await this._requestLoginUser(page);
      const ret = Array.isArray(result && result.ret) ? result.ret.map(String) : [];
      const ok = ret.some((value) => value.toUpperCase().startsWith('SUCCESS'));
      if (!ok) {
        this.loggedIn = false;
        this.user = null;
        this.logger.warn('[auth] loginuser check failed:', ret.join(' | ') || (result && result.__error));
        return false;
      }
      this.loggedIn = true;
      this.loginExpired = false;
      this.user = extractUser(result.data);
      this.lastError = null;
      this.logger.log(`[auth] logged in as ${this.user.nick}`);
      this._closeLoginPageSoon();
      this._scheduleAutoHide();
      return true;
    } catch (error) {
      this.logger.warn('[auth] verify failed:', error.message);
      this.loggedIn = false;
      this.user = null;
      if (error instanceof RiskControlError || error instanceof BrowserUnavailableError) {
        this.lastError = error;
      }
      return false;
    }
  }

  _closeLoginPageSoon() {
    const page = this.loginPage;
    if (!page || page.isClosed()) return;
    setTimeout(() => {
      if (this.loginPage === page && !page.isClosed()) {
        page.close().catch(() => {});
      }
    }, 700);
  }

  async openLogin({ refresh = false } = {}) {
    await this.ensureBrowser();
    if (this.loggedIn) return this.getState();
    this.loginExpired = false;
    let page = this.loginPage;
    if (!page || page.isClosed()) {
      page = await this.context.newPage();
      page.setDefaultTimeout(30000);
      this.loginPage = page;
      page.on('close', () => {
        if (this.loginPage === page) this.loginPage = null;
      });
    }

    if (refresh || !page.url().startsWith('https://passport.goofish.com/')) {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    this.windowAutoHideToken += 1;
    await this._applyWindowBounds(page, true);
    await page.bringToFront().catch(() => {});
    const ready = await page
      .waitForSelector('text=手机扫码安全登录', { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (ready) this.logger.log('[auth] login page ready (QR shown)');
    else this.logger.warn('[auth] login page did not show the QR selector in time');
    this.lastError = null;
    return this.getState();
  }

  async refreshLogin() {
    if (!this.context) return this.openLogin({ refresh: true });
    if (!this.loginPage || this.loginPage.isClosed()) {
      return this.openLogin({ refresh: true });
    }
    await this.loginPage.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await this._applyWindowBounds(this.loginPage, true);
    await this.loginPage.bringToFront().catch(() => {});
    return this.getState();
  }

  async importCookies(cookieInput) {
    await this.ensureBrowser();
    const pairs = parseCookieHeader(cookieInput);
    if (!pairs.length) {
      throw new AppError('INVALID_COOKIE', '没有识别到有效的 Cookie。', {
        hint: '请粘贴形如 name=value; name2=value2 的 Cookie 请求头。',
        status: 400,
      });
    }
    const cookies = pairs.map(([name, value]) => ({
      name,
      value,
      domain: '.goofish.com',
      path: '/',
      secure: true,
      sameSite: 'Lax',
    }));
    let added = 0;
    let lastError = null;
    for (const cookie of cookies) {
      try {
        await this.context.addCookies([cookie]);
        added += 1;
      } catch (error) {
        lastError = error;
      }
    }
    if (added === 0) {
      throw new AppError('INVALID_COOKIE', 'Cookie 写入失败。', {
        hint: lastError ? String(lastError.message || lastError).slice(0, 200) : '没有可写入的 Cookie。',
        status: 400,
      });
    }
    this.loggedIn = false;
    this.user = null;
    this.loginExpired = false;
    this.lastVerifyAttempt = 0;
    const ok = await this.verifyLogin();
    if (!ok) {
      throw new LoginRequiredError(
        'Cookie 没有通过闲鱼的登录校验。',
        '请确认复制的是已登录闲鱼的完整 Cookie（包含 HttpOnly 的 unb 等字段），并且没有过期。',
      );
    }
    return this.getState();
  }

  async status({ autoVerify = true } = {}) {
    if (!this.context) return this.getState();
    if (this.verifyPromise) {
      await this.verifyPromise.catch(() => {});
      return this.getState();
    }
    if (!this.loggedIn && !this.loginExpired && autoVerify && (await this._hasLoginMarker())) {
      const now = Date.now();
      if (now - this.lastVerifyAttempt > 2500) {
        this.lastVerifyAttempt = now;
        try {
          await this.verifyLogin();
        } catch (error) {
          this.lastError = error;
        }
      }
    }
    return this.getState();
  }

  _buildSearchData(keyword, pageNumber) {
    return {
      pageNumber,
      keyword,
      fromFilter: false,
      rowsPerPage: 30,
      sortValue: '',
      sortField: '',
      customDistance: '',
      gps: '',
      propValueStr: { searchFilter: '' },
      customGps: '',
      searchReqFromPage: 'pcSearch',
      extraFilterValue: '{}',
      userPositionJson: '{}',
    };
  }

  async _requestSearch(page, keyword, pageNumber) {
    return page.evaluate(
      async ({ api, appKey, data }) => {
        try {
          return await window.lib.mtop.request({
            api,
            v: '1.0',
            type: 'POST',
            appKey,
            accountSite: 'xianyu',
            dataType: 'json',
            timeout: 20000,
            needLoginPC: false,
            showErrorToast: false,
            needLogin: false,
            sessionOption: 'AutoLoginOnly',
            ecode: 0,
            data,
          });
        } catch (error) {
          return { __error: String((error && error.message) || error) };
        }
      },
      { api: SEARCH_API, appKey: APP_KEY, data: this._buildSearchData(keyword, pageNumber) },
    );
  }

  async _captureInitialSearch(page, keyword) {
    const responsePromise = page
      .waitForResponse(
        (response) => {
          if (!response.url().includes(`/h5/${SEARCH_API}/`)) return false;
          if (response.url().includes('.shade') || response.url().includes('.activate')) return false;
          const postData = response.request().postData() || '';
          try {
            const params = new URLSearchParams(postData);
            const payload = JSON.parse(params.get('data') || '{}');
            return payload.keyword === keyword && Number(payload.pageNumber) === 1;
          } catch {
            return false;
          }
        },
        { timeout: 25000 },
      )
      .catch(() => null);

    const url = `${HOME_URL}search?q=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this._assertNotBlocked(page);
    const response = await responsePromise;
    if (!response) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async _handleFailedResponse(parsed, page) {
    if (parsed.code === 'LOGIN_REQUIRED') {
      this.loggedIn = false;
      this.user = null;
      this.loginExpired = true;
      await this.openLogin().catch(() => {});
      throw new LoginRequiredError(
        '闲鱼登录状态已失效。',
        '登录窗口已经打开，请重新扫码登录后再查询。',
      );
    }
    if (parsed.code === 'RISK_CONTROL') {
      await this._applyWindowBounds(page, true).catch(() => {});
      throw new RiskControlError(
        '闲鱼触发了访问验证。',
        '请在弹出的浏览器窗口中完成滑块或安全验证，然后重新查询。',
      );
    }
    throw new AppError('UPSTREAM_ERROR', '闲鱼搜索接口暂时不可用。', {
      hint: parsed.technicalMessage
        ? `接口返回：${String(parsed.technicalMessage).slice(0, 140)}`
        : '请稍后重试；如果持续失败，请重新登录闲鱼。',
      status: 502,
    });
  }

  async search(keyword, { pages = 2 } = {}) {
    if (this.searching) throw new BusyError();
    this.searching = true;
    try {
      await this.ensureBrowser();
      if (!this.loggedIn) {
        const ok = await this.verifyLogin();
        if (!ok) {
          await this.openLogin().catch((error) => {
            this.logger.warn('[auth] open login failed:', error.message);
          });
          throw new LoginRequiredError(
            '查询闲鱼行情需要先登录。',
            '登录窗口已经打开，请用闲鱼 App 扫码；登录成功后会自动继续。',
          );
        }
      }

      const page = await this._getWorkPage();
      this.logger.log(`[search] "${keyword}"`);
      let firstRaw = await this._captureInitialSearch(page, keyword);
      let firstParsed = normalizeSearchResponse(firstRaw);

      if (!firstRaw) {
        this.logger.warn('[search] initial response not captured, requesting page 1 directly');
        firstRaw = await this._requestSearch(page, keyword, 1);
        firstParsed = normalizeSearchResponse(firstRaw);
      }

      if (!firstParsed.ok) {
        await this._handleFailedResponse(firstParsed, page);
      }

      await this._waitForMtop(page);
      const responses = [firstParsed];
      let pagesFetched = 1;
      const warnings = [];

      if (firstParsed.items.length > 0 && pages > 1) {
        await delay(380);
        try {
          const secondRaw = await this._requestSearch(page, keyword, 2);
          const secondParsed = normalizeSearchResponse(secondRaw);
          if (secondParsed.ok) {
            responses.push(secondParsed);
            pagesFetched += 1;
          } else if (secondParsed.code === 'LOGIN_REQUIRED') {
            this.loggedIn = false;
            this.loginExpired = true;
            warnings.push('第二页返回登录失效，本次只统计了第一页。');
          } else if (secondParsed.code === 'RISK_CONTROL') {
            warnings.push('第二页触发了验证，本次只统计了第一页。');
          } else {
            warnings.push('第二页暂时没有加载成功，本次只统计了第一页。');
          }
        } catch (error) {
          warnings.push('第二页加载失败，本次只统计了第一页。');
          this.logger.warn('[search] page 2 failed:', error.message);
        }
      }

      const listings = responses.flatMap((response) => response.items);
      const totalFound = responses
        .map((response) => response.totalFound)
        .filter((value) => Number.isFinite(value))
        .reduce((max, value) => Math.max(max, value), 0);
      const result = buildMarketResult({
        keyword,
        listings,
        pagesFetched,
        totalFound: totalFound || listings.length,
        warnings,
      });
      this.lastError = null;
      this.logger.log(
        `[search] done: ${result.quality.usedCount} used / ${result.quality.uniqueCount} unique`,
      );
      return result;
    } catch (error) {
      this.lastError = error instanceof LoginRequiredError ? null : error;
      throw error;
    } finally {
      this.searching = false;
    }
  }

  async close() {
    const context = this.context;
    this.context = null;
    this.workPage = null;
    this.loginPage = null;
    this.loggedIn = false;
    this.user = null;
    this.loginExpired = false;
    this.lastError = null;
    this.windowVisible = false;
    this.restoring = false;
    this.windowAutoHideToken += 1;
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = {
  LOGIN_URL,
  XianyuClient,
  findBrowserExecutable,
  parseCookieHeader,
};
