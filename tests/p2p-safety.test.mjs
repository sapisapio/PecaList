import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePublisherBlocks,artworkAllowed} from '../src/p2p-safety.js';
import {newIdentity} from '../p2p/catalog.mjs';
test('P2P画像は既存の画像ON設定にかかわらず初期取得しない',()=>{assert.equal(artworkAllowed({p2pOnly:true},{showDetailArtwork:true,showListArtwork:true}),false);assert.equal(artworkAllowed({p2pOnly:true},{p2pArtworkEnabled:true}),true);assert.equal(artworkAllowed({ypName:'SP',p2pSources:['x']},{}),true);});
test('掲載者ブロックは名前ではなく完全な鍵で正規化する',()=>{const a=newIdentity().publisher,b=newIdentity().publisher;const out=normalizePublisherBlocks([{publisher:a,name:'同名'},{publisher:a,name:'重複'},{publisher:b,name:'同名'},{publisher:'bad'}]);assert.equal(out.length,2);assert.notEqual(out[0].publisher,out[1].publisher);assert.equal(out[0].name,out[1].name);assert.deepEqual(normalizePublisherBlocks(null),[]);});
