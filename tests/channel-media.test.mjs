import assert from 'node:assert/strict';
import {channelMedia} from '../src/channel-media.js';
import {parseIndexTxt} from '../src/yp.js';

const fields = ['配信者', 'A'.repeat(32), '192.0.2.1:7144', 'https://example.com/bbs', 'Game', '配信詳細', '10', '2', '1000', 'FLV', 'https://images.example/icon.PNG?v=2', 'タイトル https://twitch.tv/example', 'アルバム https://youtu.be/abc', 'https://example.com/site?a=1&amp;b=2', 'encoded', '1:00', 'click', 'コメント', '1'];
const [ch] = parseIndexTxt(fields.join('<>'), {name:'test',url:'https://example.com/'});
assert.equal(ch.trackArtist, fields[10]);
assert.equal(ch.trackTitle, fields[11]);
assert.equal(ch.trackAlbum, fields[12]);
assert.equal(ch.trackUrl, 'https://example.com/site?a=1&b=2');
const media = channelMedia(ch);
assert.equal(media.artwork, 'https://images.example/icon.PNG?v=2');
assert.deepEqual(media.links.map(l=>l.label), ['Twitch','YouTube','example']);
assert.equal(media.text, 'タイトル · アルバム');
assert.deepEqual(channelMedia({}), {artwork:'',links:[],text:''});
assert.equal(channelMedia({trackTitle:'曲名',trackArtist:'歌手',trackAlbum:'アルバム'}).text, '曲名 · アルバム · 歌手');
assert.equal(channelMedia({trackTitle:'https://example.com/x https://example.com/x',trackUrl:'https://example.com/x'}).links.length,1);
assert.equal(channelMedia({trackUrl:'「ttps://twitch.tv/example」。'}).links[0].url,'https://twitch.tv/example');
assert.equal(channelMedia({trackArtist:'https://example.com/p.webp?size=100#icon'}).artwork,'https://example.com/p.webp?size=100#icon');
for(const url of ['javascript:alert(1)','data:image/png;base64,abc','file:///C:/icon.png','https://user:password@example.com/a.png']) {
 const result=channelMedia({trackUrl:url});assert.equal(result.artwork,'');assert.equal(result.links.length,0);
}
assert.equal(channelMedia({trackTitle:'<img src=x onerror=alert(1)>'}).text,'<img src=x onerror=alert(1)>');
console.log('channel media and track field mapping tests ok');

const many = Array.from({length:20}, (_,i)=>`https://example.com/${i}`);
assert.equal(channelMedia({trackUrl:many.join(' ')}).links.length,20);
assert.equal(channelMedia({trackArtist:'https://example.com/a.png https://example.com/b.jpg'}).artwork,'https://example.com/a.png');
const ips=channelMedia({trackUrl:'192.0.2.1:7244 192.0.2.1:25565 http://192.0.2.2:12345/ [2001:db8::1]:7244'});
assert.deepEqual(ips.links.map(l=>l.label),['おつまみ','25565ポート','12345ポート','おつまみ']);
assert.equal(ips.links[0].url,'http://192.0.2.1:7244/');
assert.equal(channelMedia({trackUrl:'999.999.999.999:7244 192.0.2.1:99999'}).links.length,0);

assert.equal(channelMedia({trackUrl:'https://www.example.com/very/long/path?a=1'}).links[0].label,'example');
assert.equal(channelMedia({trackUrl:'https://long-subdomain-name-for-website.example.com/'}).links[0].label.length,20);
