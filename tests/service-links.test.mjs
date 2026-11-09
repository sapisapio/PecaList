import assert from 'node:assert/strict';
import {linkService} from '../src/links.js';
for(const url of ['https://twitch.tv/test','https://www.twitch.tv/test','https://clips.twitch.tv/example'])assert.equal(linkService(url)?.id,'twitch');
for(const url of ['https://youtube.com/watch?v=x','https://www.youtube.com/@test','https://m.youtube.com/shorts/x','https://youtu.be/test'])assert.equal(linkService(url)?.id,'youtube');
for(const url of ['https://youtube.com.evil.invalid/x','https://twitch.tv@evil.invalid/x','https://notyoutube.com/x','javascript:alert(1)','https://example.com/youtube.com','bad'])assert.equal(linkService(url),null);
console.log('service link host tests ok');

for(const url of ['https://x.com/example','https://twitter.com/example','https://mobile.twitter.com/example'])assert.equal(linkService(url)?.id,'x');
for(const url of ['https://discord.gg/abc','https://discord.com/invite/abc','https://www.discordapp.com/channels/1'])assert.equal(linkService(url)?.id,'discord');
for(const url of ['https://x.com.evil.invalid/name','https://discord.gg.evil.invalid/abc','https://user:pw@x.com/name'])assert.equal(linkService(url),null);
assert.deepEqual(linkService('http://192.0.2.1:7244/'),{id:'ip',label:'おつまみ'});
assert.deepEqual(linkService('http://192.0.2.1:25565/'),{id:'ip',label:'25565ポート'});
assert.deepEqual(linkService('http://[2001:db8::1]:7244/'),{id:'ip',label:'おつまみ'});
assert.deepEqual(linkService('http://example.com:7244/'),{id:'ip',label:'おつまみ'});

const addedServices = {
  kick: ['https://kick.com/example', 'https://www.kick.com/example'],
  tiktok: ['https://www.tiktok.com/@example', 'https://vm.tiktok.com/example', 'https://vt.tiktok.com/example'],
  instagram: ['https://instagram.com/example', 'https://www.instagram.com/p/example', 'https://instagr.am/example'],
  bluesky: ['https://bsky.app/profile/example.bsky.social', 'https://bsky.social/'],
  steam: ['https://steamcommunity.com/id/example', 'https://store.steampowered.com/app/1', 'https://s.team/p/example'],
  niconico: ['https://www.nicovideo.jp/watch/sm1', 'https://live.nicovideo.jp/watch/lv1', 'https://nico.ms/sm1'],
};
for (const [id,urls] of Object.entries(addedServices)) {
  for (const value of urls) {
    assert.equal(linkService(value)?.id,id,value);
    const url=new URL(value);
    assert.equal(linkService(`https://${url.hostname}.evil.invalid/path`),null);
    assert.equal(linkService(`https://evil.invalid/?url=${value}`),null);
    assert.equal(linkService(`https://user:password@${url.hostname}/`),null);
  }
}
