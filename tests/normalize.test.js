'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyResponseRet,
  dedupeListings,
  normalizeListing,
  normalizeSearchResponse,
  parsePriceFromComponents,
  parsePriceText,
} = require('../lib/normalize');

test('parsePriceText handles yuan, commas and wan', () => {
  assert.equal(parsePriceText('¥ 3,200'), 3200);
  assert.equal(parsePriceText('￥1299.00'), 1299);
  assert.equal(parsePriceText('1.2万'), 12000);
  assert.equal(parsePriceText('面议'), null);
  assert.equal(parsePriceText('0'), null);
});

test('parsePriceFromComponents joins rich price parts', () => {
  assert.equal(
    parsePriceFromComponents([
      { type: 'symbol', text: '¥' },
      { type: 'integer', text: '3' },
      { type: 'integer', text: '299' },
    ]),
    3299,
  );
  assert.equal(
    parsePriceFromComponents([
      { type: 'integer', text: '1' },
      { type: 'decimal', text: '.2' },
      { type: 'unit', text: '万' },
    ]),
    12000,
  );
});

test('normalizeListing extracts title, price, tags and URL', () => {
  const row = {
    data: {
      item: {
        main: {
          clickParam: { args: { publishTime: 1700000000000 } },
          exContent: {
            itemId: '123456',
            title: 'iPhone 15 Pro 256G 国行',
            area: '上海',
            userNickName: '测试卖家',
            want: '23人想要',
            picUrl: '//img.alicdn.com/a.jpg',
            isAliMaMaAD: false,
            price: [
              { type: 'symbol', text: '¥' },
              { type: 'integer', text: '4' },
              { type: 'integer', text: '599' },
            ],
            fishTags: {
              r1: { tagList: [{ data: { content: '95新' } }, { data: { content: '验货宝' } }] },
              r2: { tagList: [{ data: { content: '95新' } }] },
            },
          },
        },
      },
    },
  };

  const item = normalizeListing(row);
  assert.equal(item.id, '123456');
  assert.equal(item.title, 'iPhone 15 Pro 256G 国行');
  assert.equal(item.price, 4599);
  assert.equal(item.seller, '测试卖家');
  assert.equal(item.location, '上海');
  assert.equal(item.wants, 23);
  assert.equal(item.image, 'https://img.alicdn.com/a.jpg');
  assert.equal(item.url, 'https://www.goofish.com/item?id=123456');
  assert.deepEqual(item.tags, ['95新', '验货宝']);
  assert.equal(item.publishedAt, '2023-11-14T22:13:20.000Z');
});

test('normalizeListing drops entries without usable price', () => {
  const row = {
    data: {
      item: {
        main: {
          exContent: {
            itemId: '1',
            title: '只换不卖',
            price: [{ type: 'text', text: '面议' }],
          },
        },
      },
    },
  };
  assert.equal(normalizeListing(row), null);
});

test('classifyResponseRet distinguishes success, login and risk', () => {
  assert.equal(classifyResponseRet(['SUCCESS::调用成功']).ok, true);
  assert.equal(
    classifyResponseRet(['FAIL_SYS_SESSION_EXPIRED::Session过期']).code,
    'LOGIN_REQUIRED',
  );
  assert.equal(
    classifyResponseRet(['RGV587_ERROR::SM::被挤爆啦']).code,
    'RISK_CONTROL',
  );
  assert.equal(classifyResponseRet(['FAIL_SYS_UNKNOWN::未知']).code, 'UPSTREAM_ERROR');
});

test('normalizeSearchResponse parses resultList and total', () => {
  const response = {
    ret: ['SUCCESS::调用成功'],
    data: {
      resultInfo: { searchResControlFields: { numFound: 128 } },
      resultList: [
        {
          data: {
            item: {
              main: {
                exContent: {
                  itemId: '9',
                  title: 'Switch OLED',
                  price: [{ type: 'integer', text: '1550' }],
                  area: '杭州',
                  userNickName: 'A',
                },
              },
            },
          },
        },
        {
          data: {
            item: {
              main: {
                exContent: {
                  itemId: '10',
                  title: '没有价格',
                  price: [],
                },
              },
            },
          },
        },
      ],
    },
  };

  const parsed = normalizeSearchResponse(response);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].price, 1550);
  assert.equal(parsed.totalFound, 128);
});

test('normalizeSearchResponse marks login URL as login required', () => {
  const parsed = normalizeSearchResponse({
    ret: ['RGV587_ERROR::SM::被挤爆啦'],
    data: { url: 'https://passport.goofish.com/mini_login.htm?x=1' },
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'LOGIN_REQUIRED');
});

test('dedupeListings keeps first occurrence', () => {
  const { unique, duplicates } = dedupeListings([
    { id: 'a', price: 10 },
    { id: 'a', price: 20 },
    { id: 'b', price: 30 },
  ]);
  assert.equal(unique.length, 2);
  assert.equal(unique[0].price, 10);
  assert.equal(duplicates, 1);
});
