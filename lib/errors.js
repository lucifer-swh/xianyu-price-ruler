'use strict';

class AppError extends Error {
  constructor(code, message, { hint = '', status = 500, cause = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = hint;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

class LoginRequiredError extends AppError {
  constructor(message = '需要登录闲鱼后才能查询。', hint = '点击「打开登录窗口」，用闲鱼 App 扫码登录后再试。') {
    super('LOGIN_REQUIRED', message, { hint, status: 401 });
    this.name = 'LoginRequiredError';
  }
}

class RiskControlError extends AppError {
  constructor(message = '闲鱼触发了访问验证。', hint = '请在弹出的浏览器窗口中完成滑块或验证，然后回来重试。') {
    super('RISK_CONTROL', message, { hint, status: 409 });
    this.name = 'RiskControlError';
  }
}

class BrowserUnavailableError extends AppError {
  constructor(message = '无法启动本机浏览器。', hint = '请确认已安装 Microsoft Edge 或 Google Chrome。', cause = null) {
    super('BROWSER_ERROR', message, { hint, status: 500, cause });
    this.name = 'BrowserUnavailableError';
  }
}

class BusyError extends AppError {
  constructor() {
    super('BUSY', '上一条查询还在进行中。', { hint: '请等它完成，通常只需要几秒。', status: 429 });
    this.name = 'BusyError';
  }
}

module.exports = {
  AppError,
  BrowserUnavailableError,
  BusyError,
  LoginRequiredError,
  RiskControlError,
};
