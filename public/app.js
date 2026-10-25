'use strict';

const $ = (id) => document.getElementById(id);

const dom = {
  statusPill: $('statusPill'),
  statusText: $('statusText'),
  windowToggle: $('windowToggle'),
  helpBtn: $('helpBtn'),
  hero: $('hero'),
  searchForm: $('searchForm'),
  keyword: $('keyword'),
  searchBtn: $('searchBtn'),
  suggestions: document.querySelector('.suggestions'),
  historyRow: $('historyRow'),
  historyItems: $('historyItems'),
  welcome: $('welcome'),
  loadingPanel: $('loadingPanel'),
  loadingTitle: $('loadingTitle'),
  loadingText: $('loadingText'),
  errorPanel: $('errorPanel'),
  errorTitle: $('errorTitle'),
  errorMessage: $('errorMessage'),
  errorHint: $('errorHint'),
  errorRetryBtn: $('errorRetryBtn'),
  errorLoginBtn: $('errorLoginBtn'),
  emptyPanel: $('emptyPanel'),
  emptyMessage: $('emptyMessage'),
  resultSection: $('resultSection'),
  resultTitle: $('resultTitle'),
  resultMeta: $('resultMeta'),
  copyBtn: $('copyBtn'),
  refreshBtn: $('refreshBtn'),
  exportBtn: $('exportBtn'),
  rangePrice: $('rangePrice'),
  rangeLow: $('rangeLow'),
  rangeHigh: $('rangeHigh'),
  medianChip: $('medianChip'),
  sampleChip: $('sampleChip'),
  confidenceChip: $('confidenceChip'),
  rangeNote: $('rangeNote'),
  chartHint: $('chartHint'),
  histogram: $('histogram'),
  rangeRailFill: $('rangeRailFill'),
  rangeRailMedian: $('rangeRailMedian'),
  railLow: $('railLow'),
  railMedian: $('railMedian'),
  railHigh: $('railHigh'),
  axisMin: $('axisMin'),
  axisMax: $('axisMax'),
  statsRow: $('statsRow'),
  tierRow: $('tierRow'),
  qualityText: $('qualityText'),
  qualityMeter: $('qualityMeter'),
  qualityFoot: $('qualityFoot'),
  warnings: $('warnings'),
  listCount: $('listCount'),
  sortSelect: $('sortSelect'),
  listings: $('listings'),
  listingsMore: $('listingsMore'),
  listToggleBtn: $('listToggleBtn'),
  listingsFoot: $('listingsFoot'),
  loginDialog: $('loginDialog'),
  loginCloseBtn: $('loginCloseBtn'),
  loginTitle: $('loginTitle'),
  loginLead: $('loginLead'),
  loginStatusBox: $('loginStatusBox'),
  loginStatusTitle: $('loginStatusTitle'),
  loginStatusText: $('loginStatusText'),
  openLoginBtn: $('openLoginBtn'),
  checkLoginBtn: $('checkLoginBtn'),
  refreshLoginBtn: $('refreshLoginBtn'),
  disconnectBtn: $('disconnectBtn'),
  cookieInput: $('cookieInput'),
  cookieSubmitBtn: $('cookieSubmitBtn'),
  cookieHint: $('cookieHint'),
  helpDialog: $('helpDialog'),
  helpCloseBtn: $('helpCloseBtn'),
  helpGotItBtn: $('helpGotItBtn'),
  toast: $('toast'),
};

const state = {
  status: {
    browserOpen: false,
    loggedIn: false,
    loginWindowOpen: false,
    loginExpired: false,
    user: null,
    lastError: null,
  },
  statusKnown: false,
  statusFetching: false,
  loading: false,
  result: null,
  keyword: '',
  pendingSearch: null,
  sort: 'price-asc',
  listExpanded: false,
  loginPoll: null,
  loginHandled: false,
  windowBusy: false,
  loadingTicker: null,
  searchStartedAt: 0,
  toastTimer: null,
  loginCloseTimer: null,
};

const HISTORY_KEY = 'xianyu-ruler-history-v1';
const LIST_PREVIEW = 12;
const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return numberFormatter.format(Number(value));
}

function formatPrice(value) {
  return `¥${formatNumber(value)}`;
}

function formatRange(low, high) {
  if (!Number.isFinite(Number(low)) || !Number.isFinite(Number(high))) return '—';
  if (Number(low) === Number(high)) return formatPrice(low);
  return `${formatPrice(low)} – ${formatPrice(high)}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatShortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace('/', '-');
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setHidden(node, hidden) {
  if (node) node.hidden = hidden;
}

function showToast(message, duration = 2400) {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  state.toastTimer = setTimeout(() => {
    dom.toast.classList.remove('is-visible');
    state.toastTimer = null;
  }, duration);
}

async function api(path, { method = 'GET', body = null } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error('无法连接本机服务。');
    error.code = 'NETWORK_ERROR';
    error.hint = '请确认程序仍在运行，然后刷新页面。';
    throw error;
  }

  let payload = {};
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => ({}));
  } else {
    payload = { message: await response.text().catch(() => '') };
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `请求失败（${response.status}）`);
    error.code = payload.code || 'HTTP_ERROR';
    error.hint = payload.hint || '';
    error.status = response.status;
    error.state = payload.state || null;
    throw error;
  }
  return payload;
}

function updateStatusUI() {
  const status = state.status;
  let mode = 'offline';
  let label = '未连接闲鱼';
  let title = '连接闲鱼';

  if (status.restoring && !status.loggedIn) {
    mode = 'connecting';
    label = '恢复登录…';
    title = '正在用本机保存的登录状态连接闲鱼';
  } else if (state.loading && !status.loggedIn) {
    mode = 'connecting';
    label = '连接闲鱼…';
    title = '正在启动本机浏览器';
  } else if (status.loggedIn) {
    mode = 'online';
    const nick = status.user && status.user.nick;
    const narrow = window.matchMedia('(max-width: 520px)').matches;
    label = nick ? (narrow ? '已连接' : `已连接 · ${nick}`) : '已连接闲鱼';
    title = `已连接闲鱼${nick ? `：${nick}` : ''}`;
  } else if (status.loginExpired && !status.loginWindowOpen) {
    mode = 'error';
    label = '登录已失效';
    title = '需要重新登录闲鱼';
  } else if (status.browserOpen && status.loginWindowOpen) {
    mode = 'pending';
    label = '等待扫码';
    title = '登录窗口已打开';
  } else if (status.browserOpen) {
    mode = 'pending';
    label = '待登录';
    title = '浏览器已打开，等待登录';
  } else if (status.lastError) {
    mode = 'error';
    label = '连接异常';
    title = status.lastError.message || '连接异常';
  }

  dom.statusPill.dataset.state = mode;
  dom.statusText.textContent = label;
  dom.statusPill.title = title;

  const windowVisible = Boolean(status.windowVisible);
  dom.windowToggle.setAttribute('aria-checked', String(windowVisible));
  dom.windowToggle.setAttribute(
    'aria-label',
    windowVisible ? '隐藏闲鱼窗口' : status.browserOpen ? '显示闲鱼窗口' : '打开闲鱼窗口',
  );
  const switchAction = windowVisible ? '隐藏' : status.browserOpen ? '显示' : '打开';
  dom.windowToggle.title = `${switchAction}闲鱼窗口（登录状态会保持）`;
  dom.windowToggle.disabled = state.windowBusy;
  dom.windowToggle.classList.toggle('is-busy', state.windowBusy);
}

async function refreshStatus({ quiet = true } = {}) {
  if (state.statusFetching) return state.status;
  state.statusFetching = true;
  try {
    const status = await api('/api/status');
    state.status = status;
    state.statusKnown = true;
    updateStatusUI();
    if (state.loginDialog && dom.loginDialog.open) {
      if (status.loggedIn) {
        handleLoginSuccess();
      } else {
        updateLoginUIFromStatus(status);
      }
    }
    return status;
  } catch (error) {
    if (!quiet) showToast(error.message || '无法读取连接状态');
    if (dom.loginDialog && dom.loginDialog.open) {
      setLoginUI('error', '读不到连接状态', error.hint || error.message);
    }
    return state.status;
  } finally {
    state.statusFetching = false;
  }
}

/* ---------- login ---------- */

function setLoginUI(mode, title, text) {
  dom.loginStatusBox.dataset.state = mode;
  dom.loginStatusTitle.textContent = title;
  dom.loginStatusText.textContent = text;
}

function setLoginButtonsBusy(busy) {
  dom.openLoginBtn.disabled = busy;
  dom.checkLoginBtn.disabled = busy;
  dom.refreshLoginBtn.disabled = busy;
  dom.cookieSubmitBtn.disabled = busy;
}

function updateLoginUIFromStatus(status) {
  if (!dom.loginDialog.open) return;
  if (status.loggedIn) {
    handleLoginSuccess();
    return;
  }
  if (status.browserOpen && status.loginWindowOpen) {
    setLoginUI(
      'waiting',
      '登录窗口已打开',
      '请用闲鱼 App 扫码，并在手机上点「确认登录」。成功后窗口会自动隐藏。',
    );
    dom.openLoginBtn.textContent = '显示登录窗口';
    return;
  }
  if (status.lastError) {
    setLoginUI(
      'error',
      status.lastError.message || '连接遇到问题',
      status.lastError.hint || '请在浏览器窗口中检查闲鱼页面，然后重试。',
    );
    return;
  }
  if (status.browserOpen) {
    setLoginUI(
      'waiting',
      '闲鱼窗口已准备好',
      '如果还没看到扫码页，点「打开登录窗口」，或检查任务栏里是否有新窗口。',
    );
    dom.openLoginBtn.textContent = '打开登录窗口';
    return;
  }
  setLoginUI(
    'idle',
    '等待打开登录窗口',
    '登录窗口会短暂出现，扫码成功后自动隐藏，登录状态保存在本机。',
  );
  dom.openLoginBtn.textContent = '打开登录窗口';
}

function startLoginPolling() {
  stopLoginPolling();
  state.loginPoll = setInterval(async () => {
    if (!dom.loginDialog.open) {
      stopLoginPolling();
      return;
    }
    if (state.loginHandled || state.windowBusy) return;
    await refreshStatus({ quiet: true });
  }, 2800);
}

function stopLoginPolling() {
  if (state.loginPoll) {
    clearInterval(state.loginPoll);
    state.loginPoll = null;
  }
}

function openLoginDialog({ reason = 'manual', keyword = null } = {}) {
  if (keyword) state.pendingSearch = keyword;
  state.loginHandled = false;
  updateStatusUI();

  if (reason === 'search') {
    dom.loginTitle.textContent = '先登录，再继续查行情';
    dom.loginLead.textContent =
      '闲鱼不允许未登录查询。登录窗口扫码成功后会隐藏，并自动继续刚才的查询。登录状态会保留，下次不用再扫。';
  } else if (reason === 'expired') {
    dom.loginTitle.textContent = '闲鱼登录过期了';
    dom.loginLead.textContent =
      '重新扫码登录一次即可。成功后窗口会自动隐藏，登录状态会重新保存在本机。';
  } else {
    dom.loginTitle.textContent = '先和闲鱼打个招呼';
    dom.loginLead.textContent =
      '闲鱼不允许未登录查询。登录窗口会短暂出现，扫码成功后自动隐藏；登录状态只保存在本机。';
  }

  const status = state.status;
  if (status.loggedIn) {
    setLoginUI(
      'success',
      '已经连接闲鱼',
      status.user && status.user.nick ? `当前账号：${status.user.nick}` : '登录状态有效。',
    );
  } else if (status.loginWindowOpen) {
    setLoginUI(
      'waiting',
      '登录窗口已打开',
      '请用闲鱼 App 扫码，确认后窗口会自动隐藏，并继续查询。',
    );
    dom.openLoginBtn.textContent = '显示登录窗口';
  } else if (status.lastError) {
    setLoginUI(
      'error',
      status.lastError.message || '连接遇到问题',
      status.lastError.hint || '请重试，或检查浏览器窗口。',
    );
  } else {
    setLoginUI('waiting', '准备打开登录窗口', '首次启动浏览器需要几秒钟，请稍候。');
  }

  if (!dom.loginDialog.open) {
    dom.loginDialog.showModal();
  }
  startLoginPolling();
  setTimeout(() => dom.openLoginBtn.focus(), 60);
}

function handleLoginSuccess() {
  if (!dom.loginDialog.open || state.loginHandled) return;
  state.loginHandled = true;
  stopLoginPolling();
  const nick = state.status.user && state.status.user.nick;
  setLoginUI(
    'success',
    `已连接${nick ? `：${nick}` : '闲鱼'}`,
    '登录成功，闲鱼窗口会自动隐藏，正在继续…',
  );
  dom.openLoginBtn.textContent = '已连接';
  state.status.windowVisible = false;
  updateStatusUI();
  const pending = state.pendingSearch;
  state.pendingSearch = null;
  if (state.loginCloseTimer) clearTimeout(state.loginCloseTimer);
  state.loginCloseTimer = setTimeout(() => {
    if (dom.loginDialog.open) dom.loginDialog.close();
    setTimeout(() => refreshStatus({ quiet: true }), 1400);
    if (pending && !state.loading) {
      runSearch(pending);
    }
  }, 760);
}

async function handleOpenLogin() {
  setLoginButtonsBusy(true);
  setLoginUI('waiting', '正在打开浏览器…', '首次启动会慢几秒，请留意任务栏和桌面。');
  try {
    const status = await api('/api/login', { method: 'POST', body: {} });
    state.status = status;
    state.statusKnown = true;
    updateStatusUI();
    updateLoginUIFromStatus(status);
    showToast('登录窗口已打开，扫码成功后会自动隐藏');
  } catch (error) {
    if (error.state) state.status = error.state;
    updateStatusUI();
    setLoginUI('error', '浏览器没有打开', error.hint || error.message);
    showToast(error.message || '浏览器启动失败');
  } finally {
    setLoginButtonsBusy(false);
  }
}

async function handleCheckLogin() {
  setLoginButtonsBusy(true);
  setLoginUI('waiting', '正在检查登录状态…', '确认手机上已经点了「确认登录」。');
  try {
    const status = await refreshStatus({ quiet: false });
    if (!status.loggedIn) {
      setLoginUI(
        'waiting',
        '还没检测到登录',
        '请确认浏览器里已经扫码，并在手机上完成了确认；稍等几秒会自动再试。',
      );
    }
  } finally {
    setLoginButtonsBusy(false);
  }
}

async function handleRefreshLogin() {
  setLoginButtonsBusy(true);
  setLoginUI('waiting', '正在刷新登录页…', '二维码会重新生成。');
  try {
    const status = await api('/api/login/refresh', { method: 'POST', body: {} });
    state.status = status;
    updateStatusUI();
    updateLoginUIFromStatus(status);
    showToast('登录页已刷新');
  } catch (error) {
    if (error.state) state.status = error.state;
    setLoginUI('error', '刷新失败', error.hint || error.message);
  } finally {
    setLoginButtonsBusy(false);
  }
}

async function handleCookieLogin() {
  const cookie = dom.cookieInput.value.trim();
  if (!cookie) {
    showToast('请先粘贴 Cookie');
    dom.cookieInput.focus();
    return;
  }
  setLoginButtonsBusy(true);
  setLoginUI('waiting', '正在验证 Cookie…', '程序会用它访问一次闲鱼，确认登录态是否有效。');
  try {
    const status = await api('/api/cookie', { method: 'POST', body: { cookie } });
    state.status = status;
    dom.cookieInput.value = '';
    updateStatusUI();
    handleLoginSuccess();
  } catch (error) {
    if (error.state) state.status = error.state;
    updateStatusUI();
    setLoginUI('error', 'Cookie 没有通过校验', error.hint || error.message);
  } finally {
    setLoginButtonsBusy(false);
  }
}

async function handleDisconnect() {
  dom.disconnectBtn.disabled = true;
  try {
    const status = await api('/api/logout', { method: 'POST', body: {} });
    state.status = status;
    state.pendingSearch = null;
    updateStatusUI();
    stopLoginPolling();
    if (dom.loginDialog.open) dom.loginDialog.close();
    showToast('已关闭后台浏览器，登录状态仍会保留');
  } catch (error) {
    showToast(error.message || '断开失败');
  } finally {
    dom.disconnectBtn.disabled = false;
  }
}

async function handleWindowToggle() {
  if (state.windowBusy) return;
  const wantVisible = !state.status.windowVisible;
  state.windowBusy = true;
  updateStatusUI();
  if (wantVisible) {
    showToast(state.status.browserOpen ? '正在显示闲鱼窗口…' : '正在打开闲鱼窗口…', 2000);
  }
  try {
    const status = await api('/api/window', {
      method: 'POST',
      body: { visible: wantVisible },
    });
    state.status = status;
    state.statusKnown = true;
    updateStatusUI();
    if (dom.loginDialog.open) {
      if (status.loggedIn) handleLoginSuccess();
      else updateLoginUIFromStatus(status);
    }
    if (status.windowVisible === wantVisible) {
      showToast(
        wantVisible
          ? '已显示闲鱼窗口'
          : '已隐藏闲鱼窗口，登录状态会继续保持',
      );
    } else {
      showToast('窗口没有切换成功，请再试一次');
    }
  } catch (error) {
    if (error.state) {
      state.status = error.state;
      updateStatusUI();
    }
    showToast(error.hint || error.message || '窗口操作失败');
  } finally {
    state.windowBusy = false;
    updateStatusUI();
  }
}

/* ---------- search state ---------- */

function showWelcome() {
  setHidden(dom.welcome, false);
  setHidden(dom.loadingPanel, true);
  setHidden(dom.errorPanel, true);
  setHidden(dom.emptyPanel, true);
  setHidden(dom.resultSection, true);
  document.body.classList.remove('has-result');
}

function hideAllPanels() {
  setHidden(dom.welcome, true);
  setHidden(dom.loadingPanel, true);
  setHidden(dom.errorPanel, true);
  setHidden(dom.emptyPanel, true);
  setHidden(dom.resultSection, true);
}

function startLoadingTicker() {
  if (state.loadingTicker) clearInterval(state.loadingTicker);
  state.searchStartedAt = Date.now();
  dom.loadingTitle.textContent = '正在连接闲鱼…';
  dom.loadingText.textContent = '如果是首次使用，弹出浏览器后请扫码登录。';
  state.loadingTicker = setInterval(() => {
    if (!state.loading) return;
    const elapsed = Date.now() - state.searchStartedAt;
    if (elapsed > 9000 && !state.status.loggedIn) {
      dom.loadingTitle.textContent = '浏览器打开了吗？';
      dom.loadingText.textContent = '请在弹出的窗口里扫码登录，登录成功后会自动继续查询。';
    } else if (elapsed > 3200) {
      dom.loadingTitle.textContent = '正在翻闲鱼…';
      dom.loadingText.textContent = '读取当前在售商品，剔除异常价，计算主流区间。';
    }
  }, 1000);
}

function stopLoadingTicker() {
  if (state.loadingTicker) {
    clearInterval(state.loadingTicker);
    state.loadingTicker = null;
  }
}

function setSearchBusy(busy) {
  state.loading = busy;
  dom.searchBtn.disabled = busy;
  dom.searchBtn.classList.toggle('is-loading', busy);
  dom.searchBtn.querySelector('.search-button__label').textContent = busy ? '查价中' : '查行情';
  updateStatusUI();
}

function scrollToPanel(element) {
  if (!element) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, 60);
}

async function runSearch(rawKeyword) {
  if (state.loading) return;
  const keyword = String(rawKeyword || '').replace(/\s+/g, ' ').trim();
  if (!keyword) {
    showToast('先输入一个产品名称');
    dom.keyword.focus();
    return;
  }
  if (keyword.length > 60) {
    showToast('产品名称请控制在 60 个字符以内');
    return;
  }

  state.keyword = keyword;
  dom.keyword.value = keyword;
  state.result = null;
  state.pendingSearch = null;
  state.listExpanded = false;
  hideAllPanels();
  setHidden(dom.loadingPanel, false);
  setSearchBusy(true);
  startLoadingTicker();
  scrollToPanel(dom.loadingPanel);

  try {
    const payload = await api('/api/search', { method: 'POST', body: { keyword } });
    state.result = payload.result;
    stopLoadingTicker();
    setHidden(dom.loadingPanel, true);
    setSearchBusy(false);
    if (!payload.result || !payload.result.stats || !payload.result.listings.length) {
      renderEmpty(payload.result);
    } else {
      renderResult(payload.result, { scroll: true });
    }
  } catch (error) {
    stopLoadingTicker();
    setHidden(dom.loadingPanel, true);
    setSearchBusy(false);
    if (error.state) {
      state.status = error.state;
      state.statusKnown = true;
      updateStatusUI();
    }
    if (error.code === 'LOGIN_REQUIRED') {
      showWelcome();
      openLoginDialog({ reason: 'search', keyword });
      showToast('登录成功后会自动继续查询');
      return;
    }
    showError(error);
  }
}

/* ---------- result rendering ---------- */

function renderResult(result, { scroll = true } = {}) {
  state.result = result;
  setHidden(dom.welcome, true);
  setHidden(dom.loadingPanel, true);
  setHidden(dom.errorPanel, true);
  setHidden(dom.emptyPanel, true);
  setHidden(dom.resultSection, false);
  document.body.classList.add('has-result');

  const stats = result.stats;
  const quality = result.quality;
  const distribution = result.distribution;

  clearNode(dom.resultTitle);
  const titleKeyword = document.createElement('span');
  titleKeyword.textContent = `“${result.keyword}”`;
  const titleSuffix = document.createElement('span');
  titleSuffix.className = 'nowrap';
  titleSuffix.textContent = ' 的闲鱼行情';
  dom.resultTitle.append(titleKeyword, titleSuffix);
  dom.resultMeta.textContent = `${formatTime(result.fetchedAt)} 更新 · 抓取 ${quality.pagesFetched} 页 · 原始 ${quality.rawCount} 条 · 纳入 ${quality.usedCount} 条`;
  document.title = `${result.keyword} 闲鱼行情 · 闲鱼价尺`;

  const single = stats.rangeLow === stats.rangeHigh;
  dom.rangePrice.classList.toggle('is-single', single);
  dom.rangeLow.textContent = formatNumber(stats.rangeLow);
  dom.rangeHigh.textContent = formatNumber(stats.rangeHigh);
  dom.medianChip.textContent = `中位价 ${formatPrice(stats.median)}`;
  dom.sampleChip.textContent = `${stats.count} 条样本`;
  dom.confidenceChip.textContent = result.confidence.label;
  dom.confidenceChip.dataset.level = result.confidence.level;
  dom.confidenceChip.title = result.confidence.note;

  if (quality.outlierCount > 0) {
    dom.rangeNote.textContent = `已剔除 ${quality.outlierCount} 条异常价 · 用剩余 ${stats.count} 条在售挂牌价计算`;
  } else {
    dom.rangeNote.textContent = `未发现极端价 · 直接使用 ${stats.count} 条在售挂牌价计算`;
  }

  renderChart(distribution, stats);
  renderStats(stats);
  renderTiers(result.tiers);
  renderQuality(quality, result.confidence);
  renderWarnings(result.warnings);
  renderListings();

  if (result.keyword) {
    dom.listCount.textContent = String(stats.count);
    const params = new URLSearchParams(window.location.search);
    params.set('q', result.keyword);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }

  saveHistory(result);
  if (scroll) scrollToPanel(dom.resultSection);
}

function renderChart(distribution, stats) {
  clearNode(dom.histogram);
  if (!distribution || !distribution.bins.length) {
    dom.chartHint.textContent = '暂无可绘制的分布';
    return;
  }

  const bins = distribution.bins;
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const min = distribution.min;
  const max = distribution.max;
  const span = max - min;
  const p25Pos = span > 0 ? ((distribution.p25 - min) / span) * 100 : 0;
  const p75Pos = span > 0 ? ((distribution.p75 - min) / span) * 100 : 100;
  const medianPos = span > 0 ? ((distribution.median - min) / span) * 100 : 50;

  bins.forEach((bin, index) => {
    const bar = document.createElement('div');
    bar.className = `histogram__bar${bin.inRange ? ' is-inrange' : ''}`;
    bar.title = `${formatPrice(Math.round(bin.from))} – ${formatPrice(Math.round(bin.to))}：${bin.count} 条`;
    const count = document.createElement('span');
    count.className = 'histogram__count';
    count.textContent = String(bin.count);
    const fill = document.createElement('span');
    fill.className = 'histogram__fill';
    const height = bin.count === 0 ? 3 : Math.max(6, (bin.count / maxCount) * 88);
    fill.style.height = `${height}%`;
    fill.style.animationDelay = `${Math.min(index * 38, 280)}ms`;
    bar.appendChild(count);
    bar.appendChild(fill);
    dom.histogram.appendChild(bar);
  });

  dom.histogram.setAttribute(
    'aria-label',
    `共 ${stats.count} 条价格样本，主流区间 ${formatPrice(stats.rangeLow)} 到 ${formatPrice(stats.rangeHigh)}`,
  );
  dom.chartHint.textContent = `${stats.count} 条 · 黄色为中间 50%`;
  dom.rangeRailFill.style.left = `${p25Pos}%`;
  dom.rangeRailFill.style.width = `${Math.max(0.5, p75Pos - p25Pos)}%`;
  dom.rangeRailMedian.style.left = `${medianPos}%`;
  dom.railLow.textContent = `P25 ${formatPrice(Math.round(distribution.p25))}`;
  dom.railMedian.textContent = '中位';
  dom.railHigh.textContent = `P75 ${formatPrice(Math.round(distribution.p75))}`;
  dom.axisMin.textContent = formatPrice(Math.round(min));
  dom.axisMax.textContent = formatPrice(Math.round(max));
}

function renderStats(stats) {
  clearNode(dom.statsRow);
  const cells = [
    { label: '中位价', value: formatPrice(stats.median), sub: '市场中间值，均衡参考' },
    { label: '最低样本', value: formatPrice(stats.min), sub: '剔除异常价后的最低挂牌' },
    { label: '最高样本', value: formatPrice(stats.max), sub: '剔除异常价后的最高挂牌' },
    { label: '平均价', value: formatPrice(stats.mean), sub: '算术平均，容易被高价拉动' },
  ];
  for (const cell of cells) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const label = document.createElement('p');
    label.className = 'stat-card__label';
    label.textContent = cell.label;
    const value = document.createElement('p');
    value.className = 'stat-card__value';
    value.textContent = cell.value;
    const sub = document.createElement('p');
    sub.className = 'stat-card__sub';
    sub.textContent = cell.sub;
    card.append(label, value, sub);
    dom.statsRow.appendChild(card);
  }
}

function renderTiers(tiers) {
  clearNode(dom.tierRow);
  if (!Array.isArray(tiers)) return;
  tiers.forEach((tier, index) => {
    const card = document.createElement('div');
    card.className = `tier${index === 1 ? ' tier--featured' : ''}`;
    const label = document.createElement('p');
    label.className = 'tier__label';
    label.textContent = tier.label;
    const hint = document.createElement('p');
    hint.className = 'tier__hint';
    hint.textContent = tier.hint;
    const price = document.createElement('p');
    price.className = 'tier__price';
    price.textContent = formatPrice(tier.price);
    card.append(label, hint, price);
    dom.tierRow.appendChild(card);
  });
}

function renderQuality(quality, confidence) {
  const parts = [
    `本轮读取 ${quality.rawCount} 条`,
    quality.duplicateCount ? `去重 ${quality.duplicateCount} 条` : null,
    quality.adCount ? `过滤广告 ${quality.adCount} 条` : null,
    `最终 ${quality.usedCount} 条进入统计`,
  ].filter(Boolean);
  dom.qualityText.textContent = `${parts.join('，')}。${confidence.note}`;

  clearNode(dom.qualityMeter);
  const filled = Math.min(10, Math.max(0, Math.round(quality.usedCount / 4)));
  for (let index = 0; index < 10; index += 1) {
    const segment = document.createElement('span');
    segment.className = `quality-card__segment${index < filled ? ' is-filled' : ''}`;
    dom.qualityMeter.appendChild(segment);
  }

  const trimState = quality.trimApplied
    ? `IQR × 1.5 已启用 · 剔除 ${quality.outlierCount} 条`
    : quality.usedCount < 12
      ? '样本不足 12 条，未启用异常价剔除'
      : `未发现异常价${quality.outlierCount ? ` · 剔除 ${quality.outlierCount} 条` : ''}`;
  dom.qualityFoot.textContent = `${trimState} · ${confidence.label}`;
}

function renderWarnings(warnings) {
  clearNode(dom.warnings);
  if (!Array.isArray(warnings) || !warnings.length) {
    setHidden(dom.warnings, true);
    return;
  }
  const list = document.createElement('ul');
  warnings.forEach((warning) => {
    const item = document.createElement('li');
    item.textContent = warning;
    list.appendChild(item);
  });
  dom.warnings.appendChild(list);
  setHidden(dom.warnings, false);
}

function sortedListings() {
  const source = state.result ? state.result.listings.slice() : [];
  switch (state.sort) {
    case 'price-desc':
      return source.sort((a, b) => b.price - a.price);
    case 'wants':
      return source.sort((a, b) => b.wants - a.wants || a.price - b.price);
    case 'newest':
      return source.sort((a, b) => {
        const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return bt - at || a.price - b.price;
      });
    case 'price-asc':
    default:
      return source.sort((a, b) => a.price - b.price);
  }
}

function renderListings() {
  clearNode(dom.listings);
  if (!state.result) return;
  const all = sortedListings();
  const items = state.listExpanded ? all : all.slice(0, LIST_PREVIEW);
  const conditionPattern = /(全新|99新|98新|95新|9成新|8成新|成色|未拆|拆封|在保|过保|国行|港版|美版|日版|有锁|无锁|轻微|划痕|磕碰|自用)/;

  for (const item of items) {
    const row = document.createElement(item.url ? 'a' : 'div');
    row.className = 'listing';
    if (item.url && /^https:\/\/www\.goofish\.com\/item\?id=/.test(item.url)) {
      row.href = item.url;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
      row.setAttribute('aria-label', `${item.title}，${formatPrice(item.price)}`);
    }

    const thumb = document.createElement('div');
    thumb.className = 'listing__thumb';
    if (item.image) {
      const image = document.createElement('img');
      image.src = item.image;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        image.remove();
        thumb.classList.add('is-fallback');
        thumb.textContent = '闲鱼';
      });
      thumb.appendChild(image);
    } else {
      thumb.classList.add('is-fallback');
      thumb.textContent = '闲鱼';
    }

    const main = document.createElement('div');
    main.className = 'listing__main';
    const title = document.createElement('p');
    title.className = 'listing__title';
    title.textContent = item.title;

    if (item.tags && item.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'listing__tags';
      const sortedTags = [...item.tags].sort((a, b) => {
        const aCondition = conditionPattern.test(a) ? 0 : 1;
        const bCondition = conditionPattern.test(b) ? 0 : 1;
        return aCondition - bCondition;
      });
      sortedTags.slice(0, 4).forEach((tagText) => {
        const tag = document.createElement('span');
        tag.className = `listing__tag${conditionPattern.test(tagText) ? ' is-condition' : ''}`;
        tag.textContent = tagText;
        tags.appendChild(tag);
      });
      main.append(title, tags);
    } else {
      main.appendChild(title);
    }

    const meta = document.createElement('div');
    meta.className = 'listing__meta';
    const metaBits = [item.seller, item.location];
    if (item.wants > 0) metaBits.push(`${formatNumber(item.wants)} 人想要`);
    if (item.publishedAt) metaBits.push(formatShortDate(item.publishedAt));
    metaBits.filter(Boolean).forEach((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      meta.appendChild(span);
    });
    main.appendChild(meta);

    const price = document.createElement('div');
    price.className = 'listing__price';
    const currency = document.createElement('small');
    currency.textContent = '¥';
    price.append(currency, document.createTextNode(formatNumber(item.price)));

    row.append(thumb, main, price);
    dom.listings.appendChild(row);
  }

  dom.listCount.textContent = String(all.length);
  if (all.length > LIST_PREVIEW) {
    setHidden(dom.listingsMore, false);
    dom.listToggleBtn.textContent = state.listExpanded
      ? '收起，只看前 12 条'
      : `展开全部 ${all.length} 条`;
  } else {
    setHidden(dom.listingsMore, true);
  }
  dom.listingsFoot.textContent = state.listExpanded
    ? `已展示全部 ${all.length} 条纳入统计的在售样本。点击商品可跳转闲鱼原链接。`
    : `当前展示 ${Math.min(LIST_PREVIEW, all.length)} 条，共 ${all.length} 条纳入统计。点击商品可跳转闲鱼原链接。`;
}

function renderEmpty(result) {
  setHidden(dom.welcome, true);
  setHidden(dom.loadingPanel, true);
  setHidden(dom.errorPanel, true);
  setHidden(dom.resultSection, true);
  setHidden(dom.emptyPanel, false);
  document.body.classList.remove('has-result');
  const rawCount = result && result.quality ? result.quality.rawCount : 0;
  if (rawCount === 0) {
    dom.emptyMessage.textContent =
      '闲鱼没有返回在售商品。试试更具体的型号、容量或版本，例如把「iPhone」换成「iPhone 15 Pro 256G」。';
  } else {
    dom.emptyMessage.textContent = `一共读取了 ${rawCount} 条，但没有可用于统计的有效价格。可以换一个更具体的名称，或稍后重试。`;
  }
  scrollToPanel(dom.emptyPanel);
}

function errorTitleFor(code) {
  switch (code) {
    case 'LOGIN_REQUIRED':
      return '先登录闲鱼';
    case 'RISK_CONTROL':
      return '闲鱼要验证一下';
    case 'BROWSER_ERROR':
    case 'BROWSER_CLOSED':
      return '浏览器没启动';
    case 'BLOCKED':
      return '当前访问被拦截';
    case 'TIMEOUT':
      return '闲鱼响应有点慢';
    case 'BUSY':
      return '上一条还在查';
    case 'NETWORK_ERROR':
      return '连不上本机服务';
    default:
      return '这次没查成';
  }
}

function showError(error) {
  setHidden(dom.welcome, true);
  setHidden(dom.loadingPanel, true);
  setHidden(dom.emptyPanel, true);
  setHidden(dom.resultSection, true);
  setHidden(dom.errorPanel, false);
  document.body.classList.remove('has-result');

  dom.errorTitle.textContent = errorTitleFor(error.code);
  dom.errorMessage.textContent = error.message || '查询没有完成，请稍后再试。';
  dom.errorHint.textContent = error.hint || '';
  setHidden(dom.errorHint, !error.hint);
  const showLogin = error.code === 'LOGIN_REQUIRED';
  setHidden(dom.errorLoginBtn, !showLogin);
  scrollToPanel(dom.errorPanel);
}

/* ---------- copy / export ---------- */

function summaryText(result) {
  const stats = result.stats;
  const range = formatRange(stats.rangeLow, stats.rangeHigh);
  return [
    `「${result.keyword}」闲鱼行情`,
    `主流挂牌区间：${range}`,
    `中位价：${formatPrice(stats.median)}｜有效样本：${stats.count} 条`,
    `抓取时间：${formatTime(result.fetchedAt)}`,
    '数据来自闲鱼在售挂牌价，不是成交价，仅供参考。',
  ].join('\n');
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('复制失败');
}

async function handleCopy() {
  if (!state.result || !state.result.stats) return;
  try {
    await copyText(summaryText(state.result));
    showToast('行情简报已复制');
  } catch {
    showToast('复制失败，请手动选择文本');
  }
}

function csvValue(value, { protectFormula = true } = {}) {
  let text = value === null || value === undefined ? '' : String(value);
  if (protectFormula && /^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function handleExport() {
  if (!state.result || !state.result.stats) return;
  const rows = sortedListings();
  const header = ['标题', '价格(元)', '卖家', '地区', '标签', '想要人数', '发布时间', '商品链接'];
  const lines = [header.map((cell) => csvValue(cell)).join(',')];
  for (const item of rows) {
    lines.push(
      [
        csvValue(item.title),
        csvValue(item.price, { protectFormula: false }),
        csvValue(item.seller),
        csvValue(item.location),
        csvValue((item.tags || []).join(' / ')),
        csvValue(item.wants, { protectFormula: false }),
        csvValue(formatShortDate(item.publishedAt)),
        csvValue(item.url),
      ].join(','),
    );
  }
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const safeKeyword = state.result.keyword.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  anchor.href = url;
  anchor.download = `闲鱼行情_${safeKeyword}_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已导出 ${rows.length} 条样本`);
}

/* ---------- history ---------- */

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.keyword === 'string' && item.keyword.trim())
      .slice(0, 6);
  } catch {
    return [];
  }
}

function saveHistory(result) {
  if (!result || !result.stats) return;
  const entry = {
    keyword: result.keyword,
    low: result.stats.rangeLow,
    high: result.stats.rangeHigh,
    median: result.stats.median,
    at: new Date().toISOString(),
  };
  const existing = loadHistory().filter(
    (item) => item.keyword.toLowerCase() !== entry.keyword.toLowerCase(),
  );
  const next = [entry, ...existing].slice(0, 6);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 隐身模式或禁用 localStorage 时，历史记录只是不可用，不影响查价。
  }
  renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  clearNode(dom.historyItems);
  if (!history.length) {
    setHidden(dom.historyRow, true);
    return;
  }
  history.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip chip--history';
    button.dataset.query = item.keyword;
    const price = Number.isFinite(Number(item.low)) && Number.isFinite(Number(item.high))
      ? ` ${formatRange(item.low, item.high)}`
      : '';
    button.textContent = `${item.keyword}${price}`;
    dom.historyItems.appendChild(button);
  });
  setHidden(dom.historyRow, false);
}

/* ---------- events ---------- */

function bindEvents() {
  dom.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(dom.keyword.value);
  });

  dom.suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-query]');
    if (!button) return;
    dom.keyword.value = button.dataset.query;
    runSearch(button.dataset.query);
  });

  dom.historyItems.addEventListener('click', (event) => {
    const button = event.target.closest('[data-query]');
    if (!button) return;
    dom.keyword.value = button.dataset.query;
    runSearch(button.dataset.query);
  });

  dom.statusPill.addEventListener('click', () => {
    if (state.loading) return;
    if (state.status.loggedIn) {
      const nick = state.status.user && state.status.user.nick;
      showToast(nick ? `已连接闲鱼：${nick}` : '已连接闲鱼');
      return;
    }
    openLoginDialog({ reason: state.status.loginExpired ? 'expired' : 'manual' });
  });

  dom.windowToggle.addEventListener('click', handleWindowToggle);

  dom.helpBtn.addEventListener('click', () => dom.helpDialog.showModal());
  dom.helpCloseBtn.addEventListener('click', () => dom.helpDialog.close());
  dom.helpGotItBtn.addEventListener('click', () => dom.helpDialog.close());

  dom.loginCloseBtn.addEventListener('click', () => dom.loginDialog.close());
  dom.openLoginBtn.addEventListener('click', handleOpenLogin);
  dom.checkLoginBtn.addEventListener('click', handleCheckLogin);
  dom.refreshLoginBtn.addEventListener('click', handleRefreshLogin);
  dom.disconnectBtn.addEventListener('click', handleDisconnect);
  dom.cookieSubmitBtn.addEventListener('click', handleCookieLogin);

  dom.loginDialog.addEventListener('close', () => {
    stopLoginPolling();
    if (state.loginCloseTimer) {
      clearTimeout(state.loginCloseTimer);
      state.loginCloseTimer = null;
    }
    if (!state.status.loggedIn) {
      state.pendingSearch = null;
    }
    state.loginHandled = false;
  });

  for (const dialog of [dom.loginDialog, dom.helpDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  dom.copyBtn.addEventListener('click', handleCopy);
  dom.exportBtn.addEventListener('click', handleExport);
  dom.refreshBtn.addEventListener('click', () => {
    if (state.keyword) runSearch(state.keyword);
  });
  dom.sortSelect.addEventListener('change', () => {
    state.sort = dom.sortSelect.value;
    state.listExpanded = false;
    renderListings();
  });

  dom.listToggleBtn.addEventListener('click', () => {
    state.listExpanded = !state.listExpanded;
    renderListings();
    if (!state.listExpanded) {
      scrollToPanel(document.querySelector('.listings-section'));
    }
  });

  dom.errorRetryBtn.addEventListener('click', () => {
    if (state.keyword) runSearch(state.keyword);
  });
  dom.errorLoginBtn.addEventListener('click', () => {
    openLoginDialog({ reason: 'expired', keyword: state.keyword || null });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      event.preventDefault();
      dom.keyword.focus();
      dom.keyword.select();
    }
  });

  window.addEventListener('resize', updateStatusUI);
}

/* ---------- init ---------- */

function init() {
  bindEvents();
  renderHistory();
  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (initialQuery) dom.keyword.value = initialQuery;
  updateStatusUI();
  refreshStatus({ quiet: true });

  setTimeout(() => refreshStatus({ quiet: true }), 1500);
  setTimeout(() => refreshStatus({ quiet: true }), 4000);
  setInterval(() => {
    if (document.hidden || state.windowBusy) return;
    refreshStatus({ quiet: true });
  }, 6000);
}

init();
