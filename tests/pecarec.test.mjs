import assert from 'node:assert';
import { resolvePath, doubleAction, middleAction } from '../src/pecarec.js';

// ペカレコのフォルダからの相対パス
assert.strictEqual(resolvePath('PCRPlayer\\PCRPlayer.exe', 'C:\\Tools\\PeCaRecorder\\'), 'C:\\Tools\\PeCaRecorder\\PCRPlayer\\PCRPlayer.exe');
assert.strictEqual(resolvePath('D:\\x\\y.exe', 'C:\\Tools'), 'D:\\x\\y.exe');
assert.strictEqual(resolvePath('\\\\server\\share\\a.exe', 'C:\\Tools'), '\\\\server\\share\\a.exe');
assert.strictEqual(resolvePath('', 'C:\\Tools'), '');

// クリックの番号（サピオさんの設定：ダブル 0 = 再生、中 1 = コンタクトURL）
assert.strictEqual(doubleAction(0), 'play');
assert.strictEqual(doubleAction(1), 'record');
assert.strictEqual(middleAction(0), 'bbs');
assert.strictEqual(middleAction(1), 'contact');
assert.strictEqual(middleAction(9), 'none');

console.log('pecarec tests ok');
