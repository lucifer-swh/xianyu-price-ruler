'use strict';

/**
 * 闲鱼搜索结果的清洗与归一化。
 * 输入是 mtop.taobao.idlemtopsearch.pc.search 返回的原始 JSON，
 * 输出只包含本工具需要的字段，避免把整包数据传到前端。
 */

const LOGIN_ERROR_MARKERS = [
  'SESSION_EXPIRED',
  'TOKEN_EMPTY',
  'TOKEN_EXPIRED',
  'NOT_LOGIN',
  'LOGIN_REQUIRED',
  'USER_NOT_LOGIN',
];

const RISK_ERROR_MARKERS = [
  'RGV587',
  'ILLEGAL_ACCESS',
  'USER_VALIDATE',
  'BXRISK',
  'PUNISH',
  'CAPTCHA',
];

function normalizeImageUrl(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://')) return `https://${value.slice(7)}`;
  if (value.startsWith('https://')) return value;
  return null;
}

function parsePriceText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/[,，\s]/g, '')
    .replace(/[¥￥]/g, '');
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(万)?/);
  if (!match) return null;
  let price = Number(match[1]);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (match[2]) price *= 10000;
  // 闲鱼价格最多两位小数；避免出现浮点噪声。
  return Math.round(price * 100) / 100;
}

function parsePriceFromComponents(parts) {
  if (Array.isArray(parts)) {
    const text = parts
      .map((part) => {
        if (typeof part === 'string' || typeof part === 'number') return String(part);
        return part && typeof part.text === 'string' ? part.text : '';
      })
      .join('');
    return parsePriceText(text);
  }
  return parsePriceText(parts);
}

function parseInteger(value) {
  if (value === null || value === undefined || value === '') return 0;
  const match = String(value).replace(/[,，]/g, '').match(/\d+/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : 0;
}

function extractTags(exContent) {
  const tags = [];
  const groups = exContent && exContent.fishTags;
  if (!groups || typeof groups !== 'object') return tags;
  for (const key of ['r1', 'r2', 'r3', 'r4', 'r5']) {
    const group = groups[key];
    if (!group || !Array.isArray(group.tagList)) continue;
    for (const tag of group.tagList) {
      const content = tag && tag.data && tag.data.content;
      if (typeof content === 'string') {
        const clean = content.trim();
        if (clean && !tags.includes(clean)) tags.push(clean);
      }
    }
  }
  return tags.slice(0, 8);
}

function parsePublishTime(value) {
  if (value === null || value === undefined || value === '') return null;
  let number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number < 1e12) number *= 1000;
  const date = new Date(number);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeListing(row) {
  if (!row || typeof row !== 'object') return null;
  const main = (row.data && row.data.item && row.data.item.main) || {};
  const ex = main.exContent || {};
  const clickArgs = (main.clickParam && main.clickParam.args) || {};
  const itemId = String(
    ex.itemId ||
    (ex.detailParams && ex.detailParams.itemId) ||
    clickArgs.item_id ||
    clickArgs.itemId ||
    clickArgs.id ||
    '',
  ).trim();
  const title = String(ex.title || (ex.detailParams && ex.detailParams.title) || '').trim();
  const price = parsePriceFromComponents(ex.price);
  if (!title || !Number.isFinite(price) || price <= 0) return null;

  const seller = String(ex.userNickName || ex.userNick || clickArgs.userNick || '').trim();
  const location = String(ex.area || '').trim();
  const wants = parseInteger(ex.want);
  const isAd = Boolean(ex.isAliMaMaAD);
  const publishedAt = parsePublishTime(clickArgs.publishTime || clickArgs.publish_time);
  const url = itemId
    ? `https://www.goofish.com/item?id=${encodeURIComponent(itemId)}`
    : null;

  return {
    id: itemId || `${title}|${price}|${location}`,
    title,
    price,
    seller: seller || '闲鱼用户',
    location: location || '地区未标注',
    tags: extractTags(ex),
    wants,
    image: normalizeImageUrl(ex.picUrl),
    url,
    publishedAt,
    isAd,
    rawPrice: ex.price,
  };
}

function dedupeListings(listings) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const item of listings) {
    const key = item.id || `${item.title}|${item.price}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return { unique, duplicates };
}

function classifyResponseRet(ret) {
  const values = Array.isArray(ret) ? ret.map(String) : [];
  const joined = values.join(' | ').toUpperCase();
  if (values.some((value) => value.toUpperCase().startsWith('SUCCESS'))) {
    return { ok: true, code: null, ret: values };
  }
  if (LOGIN_ERROR_MARKERS.some((marker) => joined.includes(marker))) {
    return { ok: false, code: 'LOGIN_REQUIRED', ret: values };
  }
  if (RISK_ERROR_MARKERS.some((marker) => joined.includes(marker))) {
    return { ok: false, code: 'RISK_CONTROL', ret: values };
  }
  return { ok: false, code: 'UPSTREAM_ERROR', ret: values };
}

function normalizeSearchResponse(response) {
  if (!response || typeof response !== 'object') {
    return {
      ok: false,
      code: 'UPSTREAM_ERROR',
      ret: [],
      items: [],
      totalFound: 0,
      loginUrl: null,
      technicalMessage: '闲鱼返回了空响应',
    };
  }

  if (response.__error) {
    return {
      ok: false,
      code: 'UPSTREAM_ERROR',
      ret: [],
      items: [],
      totalFound: 0,
      loginUrl: null,
      technicalMessage: String(response.__error),
    };
  }

  const ret = Array.isArray(response.ret) ? response.ret.map(String) : [];
  const classified = classifyResponseRet(ret);
  const data = response.data && typeof response.data === 'object' ? response.data : {};
  const loginUrl = typeof data.url === 'string' && data.url.includes('passport.goofish.com')
    ? data.url
    : null;

  if (!classified.ok) {
    let code = classified.code;
    if (loginUrl) code = 'LOGIN_REQUIRED';
    return {
      ok: false,
      code,
      ret,
      items: [],
      totalFound: 0,
      loginUrl,
      technicalMessage: ret.join(' | ') || '闲鱼接口调用失败',
    };
  }

  const list = Array.isArray(data.resultList) ? data.resultList : [];
  const items = list.map(normalizeListing).filter(Boolean);
  const control = (data.resultInfo && data.resultInfo.searchResControlFields) || {};
  const totalFound = Number(control.numFound);
  return {
    ok: true,
    code: null,
    ret,
    items,
    totalFound: Number.isFinite(totalFound) ? totalFound : items.length,
    loginUrl: null,
    technicalMessage: null,
  };
}

module.exports = {
  classifyResponseRet,
  dedupeListings,
  extractTags,
  normalizeImageUrl,
  normalizeListing,
  normalizeSearchResponse,
  parsePriceFromComponents,
  parsePriceText,
};
