'use strict';

/**
 * 价格区间算法。
 *
 * 采用稳健统计：
 * 1. 只在样本 >= 12 时做 IQR（Tukey 1.5 倍）异常值剔除；
 * 2. 用剩余样本的 P25 ~ P75 作为主流挂牌区间；
 * 3. 中位数作为均衡参考价。
 *
 * 注意：这些都是在售挂牌价，不是成交价。
 */

function quantile(sortedValues, q) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (q <= 0) return sortedValues[0];
  if (q >= 1) return sortedValues[sortedValues.length - 1];
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function priceStep(value) {
  if (value < 100) return 1;
  if (value < 1000) return 10;
  if (value < 5000) return 50;
  if (value < 10000) return 100;
  if (value < 50000) return 500;
  return 1000;
}

function roundDown(value, step) {
  return Math.floor(value / step) * step;
}

function roundUp(value, step) {
  return Math.ceil(value / step) * step;
}

function detectOutliers(prices, { trimOutliers = true } = {}) {
  const sorted = [...prices].sort((a, b) => a - b);
  if (!trimOutliers || sorted.length < 12) {
    return {
      applied: false,
      lowerBound: sorted.length ? sorted[0] : null,
      upperBound: sorted.length ? sorted[sorted.length - 1] : null,
      outliers: [],
      kept: sorted,
    };
  }

  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerBound = Math.max(0, q1 - 1.5 * iqr);
  const upperBound = q3 + 1.5 * iqr;
  const outliers = sorted.filter((price) => price < lowerBound || price > upperBound);
  const kept = sorted.filter((price) => price >= lowerBound && price <= upperBound);

  // 防御：极端分布下不要把样本几乎清空。若剩余样本少于 4 条，则放弃剔除。
  if (kept.length < 4) {
    return {
      applied: false,
      lowerBound: sorted[0],
      upperBound: sorted[sorted.length - 1],
      outliers: [],
      kept: sorted,
    };
  }

  return {
    applied: true,
    lowerBound,
    upperBound,
    outliers,
    kept,
  };
}

function histogram(prices, min, max, binCount) {
  if (!prices.length) return [];
  if (max <= min) {
    return [{ from: min, to: max, count: prices.length, inRange: true }];
  }
  const count = Math.max(1, binCount);
  const width = (max - min) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    from: min + index * width,
    to: index === count - 1 ? max : min + (index + 1) * width,
    count: 0,
    inRange: false,
  }));
  for (const price of prices) {
    let index = Math.floor((price - min) / width);
    if (index < 0) index = 0;
    if (index >= count) index = count - 1;
    bins[index].count += 1;
  }
  return bins;
}

function confidenceFor(n) {
  if (n >= 40) {
    return {
      level: 'high',
      label: '样本较充足',
      note: '区间稳定性较好，可结合成色与配件微调。',
    };
  }
  if (n >= 20) {
    return {
      level: 'medium',
      label: '样本够用',
      note: '适合作为定价起点，建议再对照几条具体商品。',
    };
  }
  if (n >= 8) {
    return {
      level: 'low',
      label: '样本偏少',
      note: '价格受个别商品影响较大，请把区间当作粗略参考。',
    };
  }
  return {
    level: 'low',
    label: '仅供参考',
    note: '有效样本较少，建议在商品名中补充型号、容量或成色。',
  };
}

function analyze(items, { trimOutliers = true } = {}) {
  if (!Array.isArray(items)) throw new TypeError('items 必须是数组');
  const priced = items
    .filter((item) => Number.isFinite(item.price) && item.price > 0)
    .map((item) => ({ ...item }));
  const prices = priced.map((item) => item.price);
  const outlierInfo = detectOutliers(prices, { trimOutliers });
  const outlierSet = new Set(outlierInfo.outliers);

  const enriched = priced.map((item) => ({
    ...item,
    included: !outlierSet.has(item.price),
  }));

  const used = enriched.filter((item) => item.included);
  const usedPrices = used.map((item) => item.price).sort((a, b) => a - b);

  if (usedPrices.length === 0) {
    return {
      items: enriched,
      used: [],
      outliers: [],
      empty: true,
      stats: null,
      confidence: confidenceFor(0),
    };
  }

  const p25 = quantile(usedPrices, 0.25);
  const median = quantile(usedPrices, 0.5);
  const p75 = quantile(usedPrices, 0.75);
  const step = priceStep(p75);
  const rangeLow = roundDown(p25, step);
  const rangeHigh = Math.max(rangeLow, roundUp(p75, step));
  const average = mean(usedPrices);
  const min = usedPrices[0];
  const max = usedPrices[usedPrices.length - 1];

  const binCount = Math.min(9, Math.max(4, Math.ceil(Math.sqrt(usedPrices.length))));
  const bins = histogram(usedPrices, min, max, binCount).map((bin) => {
    const midpoint = (bin.from + bin.to) / 2;
    return {
      ...bin,
      inRange: midpoint >= p25 && midpoint <= p75,
    };
  });

  return {
    items: enriched,
    used,
    outliers: enriched.filter((item) => !item.included),
    empty: false,
    stats: {
      count: usedPrices.length,
      min,
      max,
      median: Math.round(median),
      mean: Math.round(average),
      p25: Math.round(p25),
      p75: Math.round(p75),
      rangeLow,
      rangeHigh,
      rangeMedian: Math.round(median),
      step,
      confidence: confidenceFor(usedPrices.length),
      distribution: {
        min,
        max,
        p25,
        p75,
        median,
        bins,
      },
      tiers: [
        { key: 'quick', label: '想快出', hint: '贴近区间下沿', price: rangeLow },
        { key: 'balanced', label: '均衡挂价', hint: '接近市场中间', price: Math.round(median) },
        { key: 'patient', label: '不着急', hint: '可尝试区间上沿', price: rangeHigh },
      ],
    },
    outlierInfo,
  };
}

module.exports = {
  analyze,
  confidenceFor,
  detectOutliers,
  histogram,
  priceStep,
  quantile,
};
