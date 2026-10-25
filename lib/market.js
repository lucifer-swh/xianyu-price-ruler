'use strict';

const { analyze } = require('./analysis');
const { dedupeListings } = require('./normalize');

function buildMarketResult({
  keyword,
  listings,
  pagesFetched = 1,
  totalFound = null,
  warnings = [],
  fetcher = 'browser',
  trimOutliers = true,
}) {
  const all = Array.isArray(listings) ? listings : [];
  const { unique, duplicates } = dedupeListings(all);
  const nonAds = unique.filter((item) => !item.isAd);
  const adCount = unique.length - nonAds.length;

  const analysis = analyze(nonAds, { trimOutliers });
  const included = analysis.items.filter((item) => item.included);
  const usedIds = new Set(included.map((item) => item.id));
  const listingsOut = analysis.items
    .filter((item) => usedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      seller: item.seller,
      location: item.location,
      tags: item.tags,
      wants: item.wants,
      image: item.image,
      url: item.url,
      publishedAt: item.publishedAt,
    }));

  return {
    keyword,
    fetchedAt: new Date().toISOString(),
    source: {
      name: '闲鱼在售商品',
      fetcher,
      pagesFetched,
      totalFound: Number.isFinite(totalFound) ? totalFound : null,
    },
    stats: analysis.stats,
    confidence: analysis.stats ? analysis.stats.confidence : analysis.confidence,
    distribution: analysis.stats ? analysis.stats.distribution : null,
    tiers: analysis.stats ? analysis.stats.tiers : [],
    listings: listingsOut,
    quality: {
      rawCount: all.length,
      uniqueCount: unique.length,
      usedCount: included.length,
      duplicateCount: duplicates,
      adCount,
      outlierCount: analysis.outliers ? analysis.outliers.length : 0,
      pagesFetched,
      trimApplied: Boolean(analysis.outlierInfo && analysis.outlierInfo.applied),
      bounds: analysis.outlierInfo
        ? {
            lower: analysis.outlierInfo.lowerBound,
            upper: analysis.outlierInfo.upperBound,
          }
        : null,
    },
    warnings,
    empty: analysis.empty,
  };
}

module.exports = { buildMarketResult };
