import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePerplContext } from '../server/perplAdapter.js';
import { normalizeN1Markets } from '../server/n1Adapter.js';
import { normalizeBulletMarkets } from '../server/bulletAdapter.js';
import { getActiveProtocols } from '../server/protocolRegistry.js';

test('Perpl converts scaled collateral volume and base OI using market metadata', () => {
  const context = { instances:[{id:1,collateral_token_id:2}], tokens:[{id:2,decimals:6}], markets:[
    {id:1,instance_id:1,perpetual_id:1,config:{is_open:true,size_decimals:5,price_decimals:1},state:{dva:'8500000000',oi:100000,mrk:850000}},
    {id:2,instance_id:1,perpetual_id:2,config:{is_open:false,size_decimals:2,price_decimals:2},state:{dva:'999999999',oi:999,mrk:999}},
  ]};
  assert.deepEqual(normalizePerplContext(context),{volume:8500,openInterest:85000,marketsCount:1});
  context.markets.push({...context.markets[0]});
  assert.equal(normalizePerplContext(context).marketsCount,1);
  context.markets[0].state.oi=null;
  assert.equal(normalizePerplContext(context).openInterest,null);
  assert.equal(normalizePerplContext(context).volume,8500);
});

test('N1 /info IDs select active live perps and human quote volume and base OI', () => {
  const info={markets:[{marketId:7,symbol:'BTCUSD',regime:'normal',priceDecimals:1,sizeDecimals:5},{marketId:8,symbol:'SOLUSD',regime:'normal'},{marketId:9,symbol:'OLDUSD',regime:'closed'}]};
  const live={markets:[{marketId:7,perpetuals:{markPrice:85000,openInterest:2},historical:{volumeQuote24h:1000000}},{marketId:8,frozen:true,perpetuals:{markPrice:100,openInterest:1},historical:{volumeQuote24h:1000}},{marketId:9,perpetuals:{markPrice:1,openInterest:1},historical:{volumeQuote24h:1000}}]};
  assert.deepEqual(normalizeN1Markets(info,live),{volume:1000000,openInterest:170000,marketsCount:1});
  live.markets[0].historical.volumeQuote24h=null;
  assert.equal(normalizeN1Markets(info,live).volume,null);
  assert.equal(normalizeN1Markets(info,live).openInterest,170000);
});

test('Bullet filters active perp symbols and converts base OI with mark price', () => {
  const info={symbols:[{symbol:'BTC-USD',status:'TRADING',contractType:'CryptoPerp'},{symbol:'GOLD-USD',status:'TRADING',contractType:'RwaPerp'},{symbol:'BTC-USD',status:'TRADING',contractType:'CryptoPerp'},{symbol:'SPOT',status:'TRADING',contractType:'Spot'},{symbol:'OLD',status:'BREAK',contractType:'CryptoPerp'}]};
  const tickers=[{symbol:'BTC-USD',quoteVolume:'1000000'},{symbol:'GOLD-USD',quoteVolume:'20000'}];
  const interests=[{symbol:'BTC-USD',openInterest:'2'},{symbol:'GOLD-USD',openInterest:'10'}];
  const prices=[{symbol:'BTC-USD',markPrice:'85000'},{symbol:'GOLD-USD',markPrice:'4000'}];
  assert.deepEqual(normalizeBulletMarkets(info,tickers,interests,prices),{volume:1020000,openInterest:210000,marketsCount:2});
  interests[1].openInterest='broken';
  assert.equal(normalizeBulletMarkets(info,tickers,interests,prices).openInterest,null);
  assert.equal(normalizeBulletMarkets(info,tickers,interests,prices).volume,1020000);
});

test('only independent active venues enter the aggregate registry', () => {
  const slugs=new Set(getActiveProtocols().map((protocol)=>protocol.slug));
  assert.ok(slugs.has('perpl'));
  assert.ok(slugs.has('bullet'));
  assert.ok(slugs.has('01-exchange'));
  for(const slug of ['truenorth','tread-fi','entropy','bullpen']) assert.ok(!slugs.has(slug));
});
