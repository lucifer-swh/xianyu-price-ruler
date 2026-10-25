'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyze, detectOutliers, histogram, quantile } = require('../lib/analysis');
const { buildMarketResult } = require('../lib/market');

function makeItems(prices, prefix = 'item') {
  return prices.map((price, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
    price,
    seller: '卖家',
    location: '上海',
    tags: ['95新'],
    wants: index,
    image: null,
    url: `https://www.goofish.com/item?id=${index}`,
    publishedAt: new Date(1700000000000 + index * 1000).toISOString(),
    isAd: false,
  }));
}

test('quantile uses linear interpolation', () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(quantile(values, 0), 10);
  assert.equal(quantile(values, 1), 50);
  assert.equal(quantile(values, 0.25), 20);
  assert.equal(quantile(values, 0.5), 30);
  assert.equal(quantile(values, 0.75), 40);
  assert.equal(quantile([10, 20], 0.5), 15);
});

test('detectOutliers removes extreme values with IQR', () => {
  const prices = [];
  for (let index = 0; index < 30; index += 1) prices.push(1500 + index * 50);
  prices.push(50, 80, 100);
  const result = detectOutliers(prices, { trimOutliers: true });
  assert.equal(result.applied, true);
  assert.equal(result.outliers.length >= 2, true);
  assert.equal(result.kept.length < prices.length, true);
});

test('detectOutliers is skipped for small samples', () => {
  const result = detectOutliers([10, 20, 30, 1000], { trimOutliers: true });
  assert.equal(result.applied, false);
  assert.equal(result.kept.length, 4);
});

test('analyze returns robust range and marks outliers', () => {
  const normal = Array.from({ length: 35 }, (_, index) => 3000 + index * 50);
  const items = makeItems([30, 40, 80, ...normal]);
  const result = analyze(items);
  assert.equal(result.empty, false);
  assert.equal(result.stats.count > 30, true);
  assert.equal(result.stats.rangeLow > 100, true);
  assert.equal(result.stats.rangeHigh < 6000, true);
  assert.equal(result.items.filter((item) => !item.included).length, 3);
  assert.equal(result.stats.distribution.bins.reduce((sum, bin) => sum + bin.count, 0), result.stats.count);
});

test('analyze handles identical prices without inventing a spread', () => {
  const result = analyze(makeItems([1000, 1000, 1000, 1000]));
  assert.equal(result.stats.rangeLow, 1000);
  assert.equal(result.stats.rangeHigh, 1000);
});

test('histogram accounts for every price', () => {
  const bins = histogram([10, 20, 30, 40, 50, 60], 10, 60, 5);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 6);
  assert.equal(bins[0].from, 10);
  assert.equal(bins[bins.length - 1].to, 60);
});

test('buildMarketResult filters ads, duplicates and outliers', () => {
  const normal = Array.from({ length: 30 }, (_, index) => 2000 + index * 100);
  const items = makeItems([80, 100, ...normal]);
  const duplicates = items.slice(0, 2).map((item) => ({ ...item }));
  const adItems = makeItems([9999], 'ad').map((item) => ({ ...item, isAd: true }));
  const result = buildMarketResult({
    keyword: '测试商品',
    listings: [...items, ...duplicates, ...adItems],
    pagesFetched: 2,
    totalFound: 999,
  });

  assert.equal(result.empty, false);
  assert.equal(result.quality.adCount, 1);
  assert.equal(result.quality.duplicateCount, 2);
  assert.equal(result.quality.usedCount, result.stats.count);
  assert.equal(result.quality.usedCount, result.listings.length);
  assert.equal(result.source.pagesFetched, 2);
  assert.equal(result.source.totalFound, 999);
  assert.equal(result.tiers.length, 3);
  assert.equal(result.listings.some((item) => item.isAd), false);
});

test('buildMarketResult exposes empty stats when nothing is usable', () => {
  const result = buildMarketResult({ keyword: '不存在', listings: [] });
  assert.equal(result.empty, true);
  assert.equal(result.stats, null);
  assert.deepEqual(result.listings, []);
});
