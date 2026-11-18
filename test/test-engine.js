/*
 * report-engine.js のテスト。
 * 実行方法: npm install jsdom && node test/test-engine.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'build', 'report-engine.js'), 'utf8');

let pass = 0;
let fail = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

// 各テストごとに新しいDOM環境を作り、report-engine.jsを読み込んで実行する。
// jsdomのDOMContentLoaded/loadイベントは非同期に発火するため、
// report-engine.js の init()(メニューバー生成・contenteditable付与)が
// 完了するのを待ってから dom を返す。
function makeEnv(bodyHtml) {
  return new Promise((resolve) => {
    const dom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>',
      { runScripts: 'dangerously', pretendToBeVisual: true }
    );
    dom.window.addEventListener('load', () => resolve(dom));
    const scriptEl = dom.window.document.createElement('script');
    scriptEl.textContent = ENGINE_SRC;
    dom.window.document.body.appendChild(scriptEl);
  });
}

// ------------------------------------------------------------------
// 1. 見出し・段落・引用の変換
// ------------------------------------------------------------------
test('見出し(H1/H2)がMarkdownの#に変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>タイトル</h1><h2>小見出し</h2><p>本文です。</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.ok(markdown.includes('# タイトル'), 'H1が# になっていない: ' + markdown);
  assert.ok(markdown.includes('## 小見出し'), 'H2が## になっていない: ' + markdown);
  assert.ok(markdown.includes('本文です。'), '本文がそのまま含まれていない: ' + markdown);
});

test('blockquoteが引用(>)として出力される', async () => {
  const dom = await makeEnv('<div id="report-content"><blockquote>社外秘です</blockquote></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.ok(markdown.includes('> 社外秘です'), '引用が> で出力されていない: ' + markdown);
});

// ------------------------------------------------------------------
// 2. 一覧表形式(1行目が全てTH)
// ------------------------------------------------------------------
test('一覧表形式のテーブルが 第1階層=行頭TH / 第2階層=列見出し / 第3階層=値 で変換される', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>商品名</th><th>数量</th><th>金額</th></tr>' +
    '<tr><th>商品A</th><td>10</td><td>100000</td></tr>' +
    '<tr><th>商品B</th><td>5</td><td>50000</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { markdown, warnings } = dom.window.ReportEngine.containerToMarkdown(root);

  const expected = [
    '- 商品A',
    '  - 数量',
    '    - 10',
    '  - 金額',
    '    - 100000',
    '- 商品B',
    '  - 数量',
    '    - 5',
    '  - 金額',
    '    - 50000'
  ].join('\n');

  assert.strictEqual(markdown, expected, '実際の出力:\n' + markdown);
  assert.strictEqual(warnings.length, 0, '警告が出るべきではない: ' + warnings.join(', '));
});

test('theadやtbodyタグが無くても一覧表形式が動作する', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>ID</th><th>名前</th></tr>' +
    '<tr><th>001</th><td>山田</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '- 001\n  - 名前\n    - 山田');
});

// ------------------------------------------------------------------
// 3. 単票形式(1行目が全てTHではない)
// ------------------------------------------------------------------
test('単票形式のテーブルが 第1階層=TH / 第2階層=TD で変換される', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>部署名</th><td>営業部</td><th>作成者</th><td>山田太郎</td></tr>' +
    '<tr><th>作成日</th><td>2026-09-01</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { markdown, warnings } = dom.window.ReportEngine.containerToMarkdown(root);

  const expected = [
    '- 部署名',
    '  - 営業部',
    '- 作成者',
    '  - 山田太郎',
    '- 作成日',
    '  - 2026-09-01'
  ].join('\n');

  assert.strictEqual(markdown, expected, '実際の出力:\n' + markdown);
  assert.strictEqual(warnings.length, 0, '警告が出るべきではない: ' + warnings.join(', '));
});

// ------------------------------------------------------------------
// 4. エラー/警告検出
// ------------------------------------------------------------------
test('colspan/rowspanを含む表で警告が出る', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th colspan="2">見出し</th></tr>' +
    '<tr><td>a</td><td>b</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { warnings } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.ok(warnings.some(w => w.includes('結合セル')), '結合セルの警告が出ていない: ' + JSON.stringify(warnings));
});

test('空のテーブルで警告が出る', async () => {
  const html = '<div id="report-content"><table></table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { warnings } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.ok(warnings.some(w => w.includes('空の表')), '空の表の警告が出ていない: ' + JSON.stringify(warnings));
});

// ------------------------------------------------------------------
// 4b. 画像
// ------------------------------------------------------------------
test('imgタグがMarkdownの画像記法に変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><img src="data:image/png;base64,AAA" alt="ロゴ"></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '![ロゴ](data:image/png;base64,AAA)');
});

test('pタグ等でラップされたimgも変換される(中身が画像だけでも消えない)', async () => {
  const dom = await makeEnv('<div id="report-content"><p><img src="x.png" alt=""></p></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '![](x.png)');
});

test('readFileAsDataURLがFileをdata URLに変換する', async () => {
  const dom = await makeEnv('<div id="report-content"></div>');
  const file = new dom.window.File(['hello'], 'a.png', { type: 'image/png' });
  const dataUrl = await dom.window.ReportEngine.readFileAsDataURL(file);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'), 'data URLになっていない: ' + dataUrl);
});

test('画像ファイルを渡すとカーソル位置に挿入される(execCommandが正しい引数で呼ばれる)', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  let called = null;
  dom.window.document.execCommand = (cmd, ui, value) => { called = { cmd, ui, value }; return true; };

  const file = new dom.window.File(['hello'], 'a.png', { type: 'image/png' });
  await dom.window.ReportEngine.handleImageFile(file);

  assert.ok(called, 'execCommandが呼ばれていない');
  assert.strictEqual(called.cmd, 'insertImage');
  assert.ok(called.value.startsWith('data:image/png;base64,'), '挿入内容がdata URLになっていない: ' + called.value);
});

test('帳票エリアに画像を貼り付けると挿入される(paste イベント)', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  let called = null;
  dom.window.document.execCommand = (cmd, ui, value) => { called = { cmd, ui, value }; return true; };

  const root = dom.window.document.getElementById('report-content');
  const file = new dom.window.File(['hello'], 'clip.png', { type: 'image/png' });
  const ev = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] };

  const notCancelled = root.dispatchEvent(ev);
  assert.strictEqual(notCancelled, false, 'preventDefaultが呼ばれていない');

  // handleImageFile内のFileReaderの読み込み完了を待つ
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(called, '貼り付けでexecCommandが呼ばれていない');
  assert.strictEqual(called.cmd, 'insertImage');
});

test('メニューバーに「画像を挿入」ボタンと非表示のファイル選択inputがある', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const btn = dom.window.document.querySelector('.report-engine-bar button.insert-img');
  const input = dom.window.document.querySelector('.report-engine-bar input[type="file"]');
  assert.ok(btn && btn.textContent === '画像を挿入', '画像挿入ボタンが無い');
  assert.ok(input && input.accept === 'image/*', 'ファイル選択inputが正しくない');
});

// ------------------------------------------------------------------
// 5. HTML保存(CSS埋め込み・scriptタグ除去)
// ------------------------------------------------------------------
test('HTML保存でscriptタグが除去され、CSSが<style>に埋め込まれる', async () => {
  const dom = await makeEnv(
    '<style>#report-content{color:red;}</style>' +
    '<div id="report-content"><h1>タイトル</h1><script>window.__x=1;</script></div>'
  );
  const root = dom.window.document.getElementById('report-content');
  const { html, warnings } = dom.window.ReportEngine.containerToStandaloneHTML(root, 'タイトル');

  assert.ok(!/\<script\>/.test(html), 'scriptタグが除去されていない: ' + html);
  assert.ok(/color:\s*red/.test(html), 'CSSが埋め込まれていない: ' + html);
  assert.ok(!html.includes('contenteditable'), 'contenteditable属性が残っている');
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'DOCTYPE宣言がない');
  assert.strictEqual(warnings.length, 0);
});

// ------------------------------------------------------------------
// 6. UI: メニューバー / メッセージ欄 / ダイアログ
// ------------------------------------------------------------------
test('初期化時にメニューバー(保存ボタン+メッセージ欄)が生成される', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const bar = dom.window.document.querySelector('.report-engine-bar');
  const saveBtn = dom.window.document.querySelector('.report-engine-bar button.save');
  const msg = dom.window.document.querySelector('.report-engine-msg');
  assert.ok(bar, 'メニューバーが生成されていない');
  assert.ok(saveBtn && saveBtn.textContent === '保存', '保存ボタンが正しくない');
  assert.ok(msg, 'メッセージ欄が生成されていない');
});

test('#report-content が contenteditable になる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  assert.strictEqual(root.getAttribute('contenteditable'), 'true');
});

test('編集対象が無い場合はエラーメッセージが表示される', async () => {
  const dom = await makeEnv('<div id="not-the-right-id"></div>');
  const msg = dom.window.document.querySelector('.report-engine-msg');
  assert.ok(msg.textContent.includes('見つかりません'), 'エラーメッセージが表示されていない: ' + msg.textContent);
});

test('保存ボタンのクリックで形式選択ダイアログが開く', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const saveBtn = dom.window.document.querySelector('.report-engine-bar button.save');
  saveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const overlay = dom.window.document.querySelector('.report-engine-modal-overlay');
  assert.ok(overlay, 'ダイアログが開いていない');
  const buttons = overlay.querySelectorAll('.choices button');
  assert.strictEqual(buttons.length, 4, 'HTML/Markdown/PDF/一次保存の4択になっていない');
});

test('Ctrl+Sで形式選択ダイアログが開く(既定動作は抑止される)', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const ev = new dom.window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
  const notPrevented = dom.window.document.dispatchEvent(ev);
  assert.strictEqual(notPrevented, false, 'preventDefaultが呼ばれていない');
  const overlay = dom.window.document.querySelector('.report-engine-modal-overlay');
  assert.ok(overlay, 'Ctrl+Sでダイアログが開いていない');
});

test('ファイル名の候補としてH1の文字列が使われる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>月次売上報告書</h1></div>');
  const base = dom.window.ReportEngine._internal.getBaseFilename();
  assert.strictEqual(base, '月次売上報告書');
});

// ------------------------------------------------------------------
// 7. 保存フロー(downloadBlobをモックして検証)
// ------------------------------------------------------------------
test('Markdown保存でdownloadBlobが正しい引数(内容/ファイル名/MIME)で呼ばれる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1><p>本文</p></div>');
  let called = null;
  dom.window.ReportEngine.downloadBlob = (content, filename, mime) => { called = { content, filename, mime }; };

  dom.window.ReportEngine.performSave('markdown');

  assert.ok(called, 'downloadBlobが呼ばれていない');
  assert.strictEqual(called.filename, '報告書.md');
  assert.strictEqual(called.mime, 'text/markdown');
  assert.ok(called.content.includes('# 報告書'));
});

test('HTML保存でdownloadBlobが .html 拡張子・text/htmlで呼ばれる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1></div>');
  let called = null;
  dom.window.ReportEngine.downloadBlob = (content, filename, mime) => { called = { content, filename, mime }; };

  dom.window.ReportEngine.performSave('html');

  assert.strictEqual(called.filename, '報告書.html');
  assert.strictEqual(called.mime, 'text/html');
  assert.ok(called.content.includes('<!DOCTYPE html>'));
});

test('PDFライブラリ未読込の場合はエラーメッセージが表示され保存は行われない', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1></div>');
  dom.window.ReportEngine.performSave('pdf'); // html2pdf を定義しない = 未読込状態を再現
  const msg = dom.window.document.querySelector('.report-engine-msg');
  assert.ok(msg.textContent.includes('html2pdf.js'), 'PDFライブラリ未読込のエラーが表示されていない: ' + msg.textContent);
});

test('PDFライブラリが読み込まれていればhtml2pdfが正しいfilenameで呼ばれる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1></div>');
  let capturedOptions = null;
  const fakeChain = {
    set(opts) { capturedOptions = opts; return this; },
    from() { return this; },
    save() { this.saved = true; }
  };
  dom.window.html2pdf = () => fakeChain;

  dom.window.ReportEngine.performSave('pdf');

  assert.ok(capturedOptions, 'html2pdf().set()が呼ばれていない');
  assert.strictEqual(capturedOptions.filename, '報告書.pdf');
});

// ------------------------------------------------------------------
// 8. 一次保存(書きかけの内容をCSS/JSごとそのまま保存)
// ------------------------------------------------------------------
test('一次保存はscriptタグを保持し、contenteditableも残したまま書き出す', async () => {
  const dom = await makeEnv(
    '<style>#report-content{color:blue;}</style>' +
    '<div id="report-content"><h1>書きかけの報告書</h1><p>途中</p></div>' +
    '<script>window.__custom = 1;</script>'
  );
  const draftHtml = dom.window.ReportEngine.buildDraftHTML();

  assert.ok(draftHtml.startsWith('<!DOCTYPE html>'), 'DOCTYPE宣言がない');
  assert.ok(/\<script[\s>]/.test(draftHtml), 'scriptタグが失われている(そのまま残すべき)');
  assert.ok(draftHtml.includes('window.__custom'), '独自scriptの中身が失われている');
  assert.ok(draftHtml.includes('color:blue'), 'CSSが失われている');
  assert.ok(draftHtml.includes('contenteditable="true"'), 'contenteditable属性が失われている');
  assert.ok(draftHtml.includes('書きかけの報告書'), '編集中の本文が失われている');
});

test('一次保存はメニューバー自体(report-engine-bar)を二重生成しないよう除去する', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const draftHtml = dom.window.ReportEngine.buildDraftHTML();
  assert.ok(!draftHtml.includes('class="report-engine-bar"'), 'メニューバーのdiv要素が除去されていない(再度開くと二重表示になる)');
  assert.ok(draftHtml.includes('.report-engine-bar'), 'メニューバー用CSS自体は残っているべき(再度開いたときの見た目のため)');
});

test('保存フローで一次保存を選ぶと wip_(ファイル名).html で保存される', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1></div>');
  let called = null;
  dom.window.ReportEngine.downloadBlob = (content, filename, mime) => { called = { content, filename, mime }; };

  dom.window.ReportEngine.performSave('draft');

  assert.ok(called, 'downloadBlobが呼ばれていない');
  assert.strictEqual(called.filename, 'wip_報告書.html');
  assert.strictEqual(called.mime, 'text/html');
  assert.ok(/\<script[\s>]/.test(called.content), '一次保存でscriptタグが失われている');
});

// ------------------------------------------------------------------
// 9. 表のクラス分け(CSS用)・Tabキー操作
// ------------------------------------------------------------------

function setCaretIn(dom, cell) {
  const range = dom.window.document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function fakeTabEvent() {
  let prevented = false;
  return { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; }, get defaultPrevented() { return prevented; } };
}

test('一覧表形式の表にreport-table-list、単票形式の表にreport-table-formクラスが付く', async () => {
  const html = '<div id="report-content">' +
    '<table id="t1"><tr><th>商品名</th><th>数量</th></tr><tr><th>商品A</th><td>1</td></tr></table>' +
    '<table id="t2"><tr><th>氏名</th><td>山田</td></tr></table>' +
    '</div>';
  const dom = await makeEnv(html);
  const t1 = dom.window.document.getElementById('t1');
  const t2 = dom.window.document.getElementById('t2');
  assert.ok(t1.classList.contains('report-table-list'), '一覧表形式にreport-table-listが付いていない');
  assert.ok(t2.classList.contains('report-table-form'), '単票形式にreport-table-formが付いていない');
});

test('Tab: 行の途中のセルでは次のセルへ移動する(行は追加されない)', async () => {
  const html = '<div id="report-content"><table><tr><th>A</th><th>B</th><th>C</th></tr></table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');
  const cells = table.rows[0].cells;

  setCaretIn(dom, cells[0]);
  const ev = fakeTabEvent();
  dom.window.ReportEngine.handleTabInTable(ev, root);

  assert.ok(ev.defaultPrevented, 'preventDefaultが呼ばれていない');
  assert.strictEqual(table.rows.length, 1, '行数が変わってしまっている');
  const sel = dom.window.getSelection();
  assert.ok(cells[1].contains(sel.anchorNode), 'カーソルが次のセルに移動していない');
});

test('Tab: 行の最後のセルでは(最終行でなければ)次の行の先頭セルへ移動する', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>A</th><th>B</th></tr>' +
    '<tr><th>C</th><td>D</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');

  setCaretIn(dom, table.rows[0].cells[1]); // 1行目・最後のセル
  dom.window.ReportEngine.handleTabInTable(fakeTabEvent(), root);

  assert.strictEqual(table.rows.length, 2, '行が追加されてしまっている(最終行ではないため追加すべきでない)');
  const sel = dom.window.getSelection();
  assert.ok(table.rows[1].cells[0].contains(sel.anchorNode), 'カーソルが次の行の先頭セルに移動していない');
});

test('Tab: 一覧表形式の最終行・最終セルでは「TH+TD...TD」の新しい行が追加される', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>商品名</th><th>数量</th><th>金額</th></tr>' +
    '<tr><th>商品A</th><td>10</td><td>100</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');

  setCaretIn(dom, table.rows[1].cells[2]); // 最終行・最終セル
  dom.window.ReportEngine.handleTabInTable(fakeTabEvent(), root);

  assert.strictEqual(table.rows.length, 3, '新しい行が追加されていない');
  const newRow = table.rows[2];
  const tags = Array.from(newRow.cells).map((c) => c.tagName);
  assert.deepStrictEqual(tags, ['TH', 'TD', 'TD'], '新しい行のセル構成がTH+TD+TDになっていない: ' + tags);
  const sel = dom.window.getSelection();
  assert.ok(newRow.cells[0].contains(sel.anchorNode), 'カーソルが新しい行の先頭セルに移動していない');
});

test('Tab: 見出し行しか無い一覧表形式でも、新規行は(見出し行の複製ではなく)TH+TD...TDになる', async () => {
  const html = '<div id="report-content"><table><tr><th>商品名</th><th>数量</th></tr></table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');

  setCaretIn(dom, table.rows[0].cells[1]); // 見出し行しかない状態の最終セル
  dom.window.ReportEngine.handleTabInTable(fakeTabEvent(), root);

  assert.strictEqual(table.rows.length, 2, '新しい行が追加されていない');
  const tags = Array.from(table.rows[1].cells).map((c) => c.tagName);
  assert.deepStrictEqual(tags, ['TH', 'TD'], '見出し行がそのまま複製されてしまっている(TH+THはNG): ' + tags);
});

test('Tab: 単票形式の最終行・最終セルでは、その行のセル種別パターンを踏襲した新しい行が追加される', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>部署名</th><td>営業部</td><th>作成者</th><td>山田太郎</td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');

  setCaretIn(dom, table.rows[0].cells[3]); // 最終行・最終セル
  dom.window.ReportEngine.handleTabInTable(fakeTabEvent(), root);

  assert.strictEqual(table.rows.length, 2, '新しい行が追加されていない');
  const tags = Array.from(table.rows[1].cells).map((c) => c.tagName);
  assert.deepStrictEqual(tags, ['TH', 'TD', 'TH', 'TD'], '単票形式の新規行がTH/TDパターンを踏襲していない: ' + tags);
});

test('Tab: 表のセル外にカーソルがある場合は何もしない', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>タイトル</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  setCaretIn(dom, root.querySelector('h1'));
  const handled = dom.window.ReportEngine.handleTabInTable(fakeTabEvent(), root);
  assert.strictEqual(handled, false, '表のセル外なのに処理してしまっている');
});

test('style.cssに一覧表形式用のvertical-align:topとTH背景色ルールが含まれる', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'build', 'style.css'), 'utf8');
  assert.ok(css.includes('report-table-list'), 'report-table-listクラスのCSSが無い');
  assert.ok(/report-table-list[\s\S]{0,80}vertical-align:\s*top/.test(css), 'vertical-align:topが設定されていない');
  assert.ok(/report-table-list th\s*\{[^}]*background/.test(css), 'THの背景色ルールが無い');
});

// ------------------------------------------------------------------
// 10. ファイル添付(画像以外の任意ファイル)
// ------------------------------------------------------------------
test('handleAttachmentFileで添付チップ(a.report-attachment)が挿入される', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  dom.window.document.execCommand = (cmd, ui, value) => {
    if (cmd === 'insertHTML') {
      const div = dom.window.document.createElement('div');
      div.innerHTML = value;
      while (div.firstChild) root.appendChild(div.firstChild);
    }
    return true;
  };

  const file = new dom.window.File(['hello world'], '見積書.pdf', { type: 'application/pdf' });
  await dom.window.ReportEngine.handleAttachmentFile(file);

  const a = root.querySelector('a.report-attachment');
  assert.ok(a, '添付チップが挿入されていない');
  assert.strictEqual(a.getAttribute('download'), '見積書.pdf', 'download属性のファイル名が正しくない');
  assert.ok(a.getAttribute('href').startsWith('data:application/pdf;base64,'), 'hrefがdata URLになっていない: ' + a.getAttribute('href'));
  assert.ok(a.textContent.includes('見積書.pdf'), 'チップの表示テキストにファイル名が含まれていない');
  assert.strictEqual(a.getAttribute('contenteditable'), 'false', 'チップがcontenteditable=falseになっていない');
});

test('添付チップがMarkdownの [ラベル](href) 形式に変換される', async () => {
  const dom = await makeEnv(
    '<div id="report-content"><p><a class="report-attachment" href="data:application/pdf;base64,AAA" download="a.pdf">📎 a.pdf (1.0 KB)</a></p></div>'
  );
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '[📎 a.pdf (1.0 KB)](data:application/pdf;base64,AAA)');
});

test('大きい添付ファイルでは警告、小さいファイルでは警告が出ない', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  dom.window.document.execCommand = (cmd, ui, value) => {
    if (cmd === 'insertHTML') {
      const div = dom.window.document.createElement('div');
      div.innerHTML = value;
      while (div.firstChild) root.appendChild(div.firstChild);
    }
    return true;
  };

  const small = new dom.window.File(['x'], 'small.txt', { type: 'text/plain' });
  await dom.window.ReportEngine.handleAttachmentFile(small);
  let msg = dom.window.document.querySelector('.report-engine-msg');
  assert.strictEqual(msg.textContent, '', '小さいファイルなのに警告が出ている: ' + msg.textContent);

  const bigContent = 'a'.repeat(6 * 1024 * 1024); // 6MB > 5MBしきい値
  const big = new dom.window.File([bigContent], 'big.zip', { type: 'application/zip' });
  await dom.window.ReportEngine.handleAttachmentFile(big);
  msg = dom.window.document.querySelector('.report-engine-msg');
  assert.ok(msg.textContent.includes('big.zip'), '大きいファイルの警告が出ていない: ' + msg.textContent);
});

test('メニューバーに「ファイルを添付」ボタンと画像制限の無いファイル選択inputがある', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>t</h1></div>');
  const buttons = Array.from(dom.window.document.querySelectorAll('.report-engine-bar button.insert-img'));
  const attachBtn = buttons.find((b) => b.textContent === 'ファイルを添付');
  assert.ok(attachBtn, '「ファイルを添付」ボタンが無い');
  const inputs = Array.from(dom.window.document.querySelectorAll('.report-engine-bar input[type="file"]'));
  assert.strictEqual(inputs.length, 2, '画像用・添付用の2つのfile inputがあるべき');
  assert.ok(inputs.some((i) => i.accept === ''), '添付用inputはaccept制限が無いはず');
});

test('humanFileSizeが妥当な単位で整形する', async () => {
  const dom = await makeEnv('<div id="report-content"></div>');
  const f = dom.window.ReportEngine.humanFileSize;
  assert.strictEqual(f(500), '500 B');
  assert.strictEqual(f(2048), '2.0 KB');
  assert.strictEqual(f(5 * 1024 * 1024), '5.0 MB');
});

// ------------------------------------------------------------------
// 11. 選択範囲への書式ショートカット(Ctrl+B/I/L, Ctrl+ +/-, Ctrl+K)
// ------------------------------------------------------------------

function selectTextIn(dom, textNode, start, end) {
  const range = dom.window.document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

test('Ctrl+Shift+B/I/UはそれぞれexecCommand(bold/italic/underline)を呼ぶ', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const calls = [];
  dom.window.document.execCommand = (cmd) => { calls.push(cmd); return true; };

  const p = dom.window.document.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);

  ['b', 'y', 'u'].forEach((k) => {
    const ev = new dom.window.KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    dom.window.document.dispatchEvent(ev);
  });

  assert.deepStrictEqual(calls, ['bold', 'italic', 'underline']);
});

test('Shiftを押していないCtrl+Bは何もしない(Ctrl+Shift+Bのみ有効)', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const calls = [];
  dom.window.document.execCommand = (cmd) => { calls.push(cmd); return true; };
  const p = dom.window.document.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);

  const ev = new dom.window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(ev);

  assert.deepStrictEqual(calls, []);
});

test('選択範囲が無い状態でCtrl+Shift+ +を押しても文字サイズは変更されない', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const before = dom.window.document.getElementById('report-content').innerHTML;
  const ev = new dom.window.KeyboardEvent('keydown', { key: '+', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(ev);
  const after = dom.window.document.getElementById('report-content').innerHTML;
  assert.strictEqual(before, after, '選択が無いのにDOMが変わってしまっている');
});

test('adjustFontSizeで選択範囲が既定値+2ptのspanに包まれ、続けて押すとさらに+2ptされる', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello world</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');

  selectTextIn(dom, p.firstChild, 0, 5); // "hello"
  dom.window.ReportEngine.adjustFontSize(root, 2);
  let span = p.querySelector('span');
  assert.ok(span, 'spanが挿入されていない');
  assert.strictEqual(span.style.fontSize, '14pt', '既定12pt+2ptになっていない: ' + span.style.fontSize);

  // 選択範囲はadjustFontSize内で新しいspanの中身に更新されているはずなので、続けて押す
  dom.window.ReportEngine.adjustFontSize(root, 2);
  span = p.querySelector('span[style*="16pt"]');
  assert.ok(span, '2回目の適用で16ptになっていない: ' + p.innerHTML);
});

test('adjustFontSizeは最小値6ptを下回らない', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);
  for (let i = 0; i < 10; i++) dom.window.ReportEngine.adjustFontSize(root, -2);
  const span = p.querySelector('span');
  assert.strictEqual(span.style.fontSize, '6pt');
});

test('Ctrl+K: テキスト選択中に外部URLでリンク化すると target=_blank が付く', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);

  dom.window.ReportEngine.openLinkDialog(root);
  const modal = dom.window.document.querySelector('.report-engine-modal');
  assert.ok(modal, 'ダイアログが開いていない');
  assert.strictEqual(modal.querySelectorAll('input[type="text"]').length, 1, '選択中はURL欄のみのはず(見出しが無いため選択欄も無し)');

  const urlInput = modal.querySelector('.report-engine-input');
  urlInput.value = 'https://example.com/';
  modal.querySelectorAll('.choices button')[0].click();

  const a = p.querySelector('a');
  assert.ok(a, 'aタグが挿入されていない');
  assert.strictEqual(a.getAttribute('href'), 'https://example.com/');
  assert.strictEqual(a.getAttribute('target'), '_blank', '外部リンクにtarget=_blankが付いていない');
  assert.strictEqual(a.getAttribute('rel'), 'noopener');
  assert.strictEqual(a.textContent, 'hello', '選択していたテキストがリンクの中身になっていない');
  assert.ok(!dom.window.document.querySelector('.report-engine-modal-overlay'), 'ダイアログが閉じていない');
});

test('Ctrl+K: ページ内アンカー(#〜)へのリンクには target=_blank を付けない', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p><h2 id="h-1">見出し</h2></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);

  dom.window.ReportEngine.openLinkDialog(root);
  const modal = dom.window.document.querySelector('.report-engine-modal');
  const urlInput = modal.querySelector('input.report-engine-input');
  urlInput.value = '#h-1';
  modal.querySelectorAll('.choices button')[0].click();

  const a = p.querySelector('a');
  assert.ok(a, 'aタグが挿入されていない');
  assert.strictEqual(a.getAttribute('href'), '#h-1');
  assert.strictEqual(a.getAttribute('target'), null, 'ページ内アンカーなのにtarget=_blankが付いている');
  assert.strictEqual(a.getAttribute('rel'), null);
});

test('Ctrl+K: 見出しがあれば選択ドロップダウンが出て、選ぶとURL欄に#idが入りその見出しにidが振られる', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p><h1>導入</h1><h2>詳細</h2></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);

  dom.window.ReportEngine.openLinkDialog(root);
  const modal = dom.window.document.querySelector('.report-engine-modal');
  const select = modal.querySelector('select.report-engine-input');
  assert.ok(select, '見出しがあるのに選択ドロップダウンが無い');
  assert.strictEqual(select.querySelectorAll('option').length, 3, 'プレースホルダー含め3つの選択肢のはず(見出し2つ+プレースホルダー)');

  select.value = '1'; // 2番目の見出し("詳細")
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  const h2 = root.querySelector('h2');
  const urlInput = modal.querySelector('input.report-engine-input');
  assert.strictEqual(urlInput.value, '#' + h2.id, 'URL欄に見出しのidが自動入力されていない');
  assert.ok(h2.id, '見出しにidが振られていない');
});

test('Ctrl+K: 見出しが無ければ選択ドロップダウンは表示されない', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');
  selectTextIn(dom, p.firstChild, 0, 5);
  dom.window.ReportEngine.openLinkDialog(root);
  const modal = dom.window.document.querySelector('.report-engine-modal');
  assert.ok(!modal.querySelector('select'), '見出しが無いのにドロップダウンが出ている');
});

test('ensureHeadingIdは既にidがあればそれを維持し、無ければh-連番を振る', async () => {
  const dom = await makeEnv('<div id="report-content"><h1 id="custom">A</h1><h2>B</h2></div>');
  const root = dom.window.document.getElementById('report-content');
  const h1 = root.querySelector('h1');
  const h2 = root.querySelector('h2');
  assert.strictEqual(dom.window.ReportEngine.ensureHeadingId(root, h1), 'custom');
  assert.strictEqual(dom.window.ReportEngine.ensureHeadingId(root, h2), 'h-1');
});

test('#report-content内の要素にscroll-margin-top用CSS変数が設定される', async () => {
  const dom = await makeEnv('<div id="report-content"><h1 id="x">t</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  assert.ok(root, 'root取得失敗');
  const varValue = dom.window.document.documentElement.style.getPropertyValue('--report-engine-bar-h');
  assert.ok(varValue, '--report-engine-bar-h が設定されていない');
});

test('Ctrl+K: 選択なしの場合はURL欄と表示テキスト欄が出て、リンクがinsertHTMLで挿入される', async () => {
  const dom = await makeEnv('<div id="report-content"><p>hello</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const p = root.querySelector('p');
  // カーソルだけ置く(選択範囲なし)
  const range = dom.window.document.createRange();
  range.setStart(p.firstChild, 5);
  range.collapse(true);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let inserted = null;
  dom.window.document.execCommand = (cmd, ui, value) => {
    if (cmd === 'insertHTML') {
      inserted = value;
      const div = dom.window.document.createElement('div');
      div.innerHTML = value;
      while (div.firstChild) root.appendChild(div.firstChild);
    }
    return true;
  };

  dom.window.ReportEngine.openLinkDialog(root);
  const modal = dom.window.document.querySelector('.report-engine-modal');
  assert.strictEqual(modal.querySelectorAll('input[type="text"]').length, 2, '選択なしはURL欄+表示テキスト欄のはず');

  const inputs = modal.querySelectorAll('.report-engine-input');
  inputs[0].value = 'https://example.com/';
  inputs[1].value = '詳細はこちら';
  modal.querySelectorAll('.choices button')[0].click();

  assert.ok(inserted && inserted.includes('href="https://example.com/"'), 'hrefが正しく挿入されていない: ' + inserted);
  assert.ok(inserted.includes('詳細はこちら'), '表示テキストが挿入されていない: ' + inserted);
  const a = root.querySelector('a[href="https://example.com/"]');
  assert.ok(a, 'aタグが挿入されていない');
});

// ------------------------------------------------------------------
// 12. 行頭でのMarkdown風オートフォーマット
// ------------------------------------------------------------------

function setCaretAtEnd(dom, textNode) {
  const range = dom.window.document.createRange();
  range.setStart(textNode, textNode.length);
  range.collapse(true);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

test('"# "→H1、"## "→H2に変換される(行頭のみ)', async () => {
  const dom = await makeEnv('<div id="report-content"><div>#</div><div>##</div></div>');
  const root = dom.window.document.getElementById('report-content');
  const divs = root.querySelectorAll('div');

  setCaretAtEnd(dom, divs[0].firstChild);
  let handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);
  assert.ok(root.querySelector('h1'), '# がH1に変換されていない: ' + root.innerHTML);

  setCaretAtEnd(dom, divs[1].firstChild);
  handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);
  assert.ok(root.querySelector('h2'), '## がH2に変換されていない: ' + root.innerHTML);
});

test('"* " と "- " は箇条書き(ul>li)に変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><div>*</div></div>');
  const root = dom.window.document.getElementById('report-content');
  const div = root.querySelector('div');
  setCaretAtEnd(dom, div.firstChild);
  const handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);
  assert.ok(root.querySelector('ul > li'), '箇条書きに変換されていない: ' + root.innerHTML);
});

test('"1. " は番号付きリスト(ol>li)に変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><div>1.</div></div>');
  const root = dom.window.document.getElementById('report-content');
  const div = root.querySelector('div');
  setCaretAtEnd(dom, div.firstChild);
  const handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);
  assert.ok(root.querySelector('ol > li'), '番号付きリストに変換されていない: ' + root.innerHTML);
});

test('行頭以外での"#"や"*"はMarkdown変換の対象にならない', async () => {
  const dom = await makeEnv('<div id="report-content"><div>foo#</div></div>');
  const root = dom.window.document.getElementById('report-content');
  const div = root.querySelector('div');
  setCaretAtEnd(dom, div.firstChild);
  const handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, false, '行頭ではないのに変換されてしまっている');
});

test('"---" (3つ以上のハイフン)でEnterを押すとHRに変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><div>----</div></div>');
  const root = dom.window.document.getElementById('report-content');
  const div = root.querySelector('div');
  setCaretAtEnd(dom, div.firstChild);
  const handled = dom.window.ReportEngine.tryMarkdownEnterTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);
  assert.ok(root.querySelector('hr'), 'hrに変換されていない: ' + root.innerHTML);
});

test('"--" (2つのハイフン)ではHRに変換されない', async () => {
  const dom = await makeEnv('<div id="report-content"><div>--</div></div>');
  const root = dom.window.document.getElementById('report-content');
  const div = root.querySelector('div');
  setCaretAtEnd(dom, div.firstChild);
  const handled = dom.window.ReportEngine.tryMarkdownEnterTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, false);
});

test('リスト項目内でTabを押すとexecCommand(indent)、Shift+Tabでoutdentが呼ばれる', async () => {
  const dom = await makeEnv('<div id="report-content"><ul><li>item</li></ul></div>');
  const root = dom.window.document.getElementById('report-content');
  const li = root.querySelector('li');
  setCaretAtEnd(dom, li.firstChild);

  const calls = [];
  dom.window.document.execCommand = (cmd) => { calls.push(cmd); return true; };

  const tabEv = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(tabEv);
  const shiftTabEv = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(shiftTabEv);

  assert.deepStrictEqual(calls, ['indent', 'outdent']);
});

// ------------------------------------------------------------------
// 13. 書式付き内容のMarkdown書き出し(太字/斜体/下線/文字サイズ/リンク/ネストリスト/HR)
// ------------------------------------------------------------------

test('太字・斜体・下線・リンクがMarkdown(相当)に変換される', async () => {
  const dom = await makeEnv(
    '<div id="report-content"><p>これは<b>太字</b>と<i>斜体</i>と<u>下線</u>と<a href="https://x.com/">リンク</a>です</p></div>'
  );
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(
    markdown,
    'これは**太字**と*斜体*と<u>下線</u>と[リンク](https://x.com/)です'
  );
});

test('文字サイズ指定のspanはインラインHTMLとしてMarkdownに残る', async () => {
  const dom = await makeEnv('<div id="report-content"><p><span style="font-size:16pt">大きい文字</span></p></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '<span style="font-size:16pt">大きい文字</span>');
});

test('ネストした箇条書きがインデント付きMarkdownに変換される', async () => {
  const dom = await makeEnv(
    '<div id="report-content"><ul><li>親1<ul><li>子1</li><li>子2</li></ul></li><li>親2</li></ul></div>'
  );
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '- 親1\n  - 子1\n  - 子2\n- 親2');
});

test('番号付きリストは "1. " "2. " と連番になる', async () => {
  const dom = await makeEnv('<div id="report-content"><ol><li>いち</li><li>に</li></ol></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '1. いち\n2. に');
});

test('hrがMarkdownの --- に変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><p>上</p><hr><p>下</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '上\n\n---\n\n下');
});

test('表のセル内の太字もMarkdown変換に反映される', async () => {
  const html = '<div id="report-content"><table>' +
    '<tr><th>氏名</th><td><b>山田太郎</b></td></tr>' +
    '</table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '- 氏名\n  - **山田太郎**');
});

// ------------------------------------------------------------------
// 14. 表のセル内でのMarkdown風オートフォーマット(bullet/number list)
// ------------------------------------------------------------------

test('表のセル内で"* "を入力すると箇条書き(ul>li)に変換される(セル自体は壊れない)', async () => {
  const dom = await makeEnv('<div id="report-content"><table><tr><td>*</td></tr></table></div>');
  const root = dom.window.document.getElementById('report-content');
  const td = root.querySelector('td');
  setCaretAtEnd(dom, td.firstChild);

  const handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);

  // tdが残ったまま中身だけliに変わっていること(tdごと置き換わっていない)
  const tdAfter = root.querySelector('table tr td');
  assert.ok(tdAfter, 'tdが無くなってしまっている(表の構造が壊れている)');
  assert.ok(tdAfter.querySelector('ul > li'), 'セル内が箇条書きに変換されていない: ' + root.innerHTML);
});

test('表のセル内で"1. "を入力すると番号付きリスト(ol>li)に変換される', async () => {
  const dom = await makeEnv('<div id="report-content"><table><tr><th>1.</th></tr></table></div>');
  const root = dom.window.document.getElementById('report-content');
  const th = root.querySelector('th');
  setCaretAtEnd(dom, th.firstChild);

  const handled = dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);

  const thAfter = root.querySelector('table tr th');
  assert.ok(thAfter, 'thが無くなってしまっている(表の構造が壊れている)');
  assert.ok(thAfter.querySelector('ol > li'), 'セル内が番号付きリストに変換されていない: ' + root.innerHTML);
});

test('表のセル内で"# "を入力すると見出しに変換される(セルは維持)', async () => {
  const dom = await makeEnv('<div id="report-content"><table><tr><td>#</td></tr></table></div>');
  const root = dom.window.document.getElementById('report-content');
  const td = root.querySelector('td');
  setCaretAtEnd(dom, td.firstChild);

  dom.window.ReportEngine.tryMarkdownSpaceTrigger(fakeTabEvent(), root);
  const tdAfter = root.querySelector('table tr td');
  assert.ok(tdAfter, 'tdが無くなってしまっている');
  assert.ok(tdAfter.querySelector('h1'), 'セル内が見出しに変換されていない: ' + root.innerHTML);
});

test('表のセル内で"---"+Enterを押すとセル内にhrが挿入される(セルは維持)', async () => {
  const dom = await makeEnv('<div id="report-content"><table><tr><td>----</td></tr></table></div>');
  const root = dom.window.document.getElementById('report-content');
  const td = root.querySelector('td');
  setCaretAtEnd(dom, td.firstChild);

  const handled = dom.window.ReportEngine.tryMarkdownEnterTrigger(fakeTabEvent(), root);
  assert.strictEqual(handled, true);
  const tdAfter = root.querySelector('table tr td');
  assert.ok(tdAfter, 'tdが無くなってしまっている');
  assert.ok(tdAfter.querySelector('hr'), 'セル内にhrが挿入されていない: ' + root.innerHTML);
});

test('表のセル内に作った箇条書きの項目内でTabを押すとindent(表の行追加は起きない)', async () => {
  const html = '<div id="report-content"><table><tr><td><ul><li>item</li></ul></td></tr></table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');
  const li = root.querySelector('li');
  setCaretAtEnd(dom, li.firstChild);

  const calls = [];
  dom.window.document.execCommand = (cmd) => { calls.push(cmd); return true; };

  const tabEv = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(tabEv);

  assert.deepStrictEqual(calls, ['indent'], 'セル内のリストでTabがindentを呼んでいない');
  assert.strictEqual(table.rows.length, 1, '表に行が追加されてしまっている(indentが優先されるべき)');
});

test('通常どおり、リストが無いセルでのTabは引き続き表の行追加として動作する', async () => {
  const html = '<div id="report-content"><table><tr><th>商品名</th><th>数量</th></tr>' +
    '<tr><th>商品A</th><td>10</td></tr></table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const table = root.querySelector('table');
  const lastRow = table.rows[table.rows.length - 1];
  setCaretAtEnd(dom, lastRow.cells[lastRow.cells.length - 1].firstChild);

  const tabEv = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(tabEv);

  assert.strictEqual(table.rows.length, 3, '表の行追加が動作していない(通常のセルではTab=行追加のはず)');
});

test('セル内のリストはMarkdown変換時にインラインHTMLとして保持される(崩れない)', async () => {
  const html = '<div id="report-content"><table><tr><td><ul><li>りんご</li><li>みかん</li></ul></td></tr></table></div>';
  const dom = await makeEnv(html);
  const root = dom.window.document.getElementById('report-content');
  const { markdown } = dom.window.ReportEngine.containerToMarkdown(root);
  assert.strictEqual(markdown, '- <ul><li>りんご</li><li>みかん</li></ul>');
});

// ------------------------------------------------------------------
// 15. <title>/document.titleを最初のH1に同期
// ------------------------------------------------------------------

test('初期化時にdocument.titleが最初のH1の内容になる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>月次売上報告書</h1></div>');
  assert.strictEqual(dom.window.document.title, '月次売上報告書');
});

test('H1を編集(input発火)するとdocument.titleが追従する', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>旧タイトル</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  const h1 = root.querySelector('h1');
  h1.textContent = '新タイトル';
  root.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.strictEqual(dom.window.document.title, '新タイトル');
});

test('H1が無い場合はdocument.titleを変更しない', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文のみ</p></div>');
  const before = dom.window.document.title;
  dom.window.ReportEngine.syncTitleFromHeading(dom.window.document.getElementById('report-content'));
  assert.strictEqual(dom.window.document.title, before);
});

test('HTML保存の<title>タグは(ファイル名用の文字置換をしていない)生のH1テキストになる', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>Q1/Q2:報告書</h1></div>');
  const root = dom.window.document.getElementById('report-content');
  let called = null;
  dom.window.ReportEngine.downloadBlob = (content, filename, mime) => { called = { content, filename, mime }; };

  dom.window.ReportEngine.performSave('html');

  assert.ok(called.content.includes('<title>Q1/Q2:報告書</title>'), '<title>タグにH1の生テキストが使われていない: ' + called.content);
  assert.strictEqual(called.filename, 'Q1_Q2_報告書.html', 'ファイル名側は従来どおりサニタイズされているべき');
});

test('getHeadingTextはH1が無ければdocument.titleにフォールバックする', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  dom.window.document.title = '既定タイトル';
  const root = dom.window.document.getElementById('report-content');
  assert.strictEqual(dom.window.ReportEngine.getHeadingText(root), '既定タイトル');
});

// ------------------------------------------------------------------
// 保存ステータス([未保存]表示・離脱時の確認)
// ------------------------------------------------------------------
// MutationObserverのコールバックはマイクロタスクで呼ばれるため、変更後に一拍待つ
const flushMutations = () => new Promise((r) => setTimeout(r, 0));

function statusText(dom) {
  return dom.window.document.querySelector('.report-engine-bar .report-engine-status').textContent;
}

test('開いた直後は保存ステータスが空(未保存ではない)', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1><table><tr><th>A</th></tr></table></div>');
  await flushMutations();
  assert.strictEqual(statusText(dom), '');
  assert.strictEqual(dom.window.ReportEngine._internal.isDirty(), false);
});

test('帳票の内容を変更するとメニューバーに[未保存]が表示される', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  const p = dom.window.document.querySelector('#report-content p');
  p.firstChild.data = '本文を編集';
  await flushMutations();
  assert.strictEqual(statusText(dom), '[未保存]');
  assert.strictEqual(dom.window.ReportEngine._internal.isDirty(), true);
});

test('画像挿入などスクリプトによる要素追加でも[未保存]になる', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  const root = dom.window.document.getElementById('report-content');
  const img = dom.window.document.createElement('img');
  img.src = 'data:image/png;base64,AAAA';
  root.appendChild(img);
  await flushMutations();
  assert.strictEqual(statusText(dom), '[未保存]');
});

for (const format of ['html', 'markdown', 'draft']) {
  test('[未保存]の状態で' + format + '保存すると[未保存]が消える', async () => {
    const dom = await makeEnv('<div id="report-content"><h1>報告書</h1><table><tr><th>A</th><th>B</th></tr><tr><th>1</th><td>x</td></tr></table></div>');
    dom.window.ReportEngine.downloadBlob = () => {};
    dom.window.document.querySelector('#report-content h1').firstChild.data = '報告書2';
    await flushMutations();
    assert.strictEqual(statusText(dom), '[未保存]');

    dom.window.ReportEngine.performSave(format);
    await flushMutations(); // 保存時の表のクラス分け(class属性の変更)で再び[未保存]にならないこと
    assert.strictEqual(statusText(dom), '');
    assert.strictEqual(dom.window.ReportEngine._internal.isDirty(), false);
  });
}

test('PDF出力ライブラリが無くPDF保存に失敗した場合は[未保存]のまま', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  dom.window.document.querySelector('#report-content p').firstChild.data = '変更';
  await flushMutations();
  dom.window.ReportEngine.performSave('pdf');
  await flushMutations();
  assert.strictEqual(statusText(dom), '[未保存]');
});

test('見出しへのid自動付与(ページ内リンク用)だけでは[未保存]にならない', async () => {
  const dom = await makeEnv('<div id="report-content"><h1>報告書</h1><h2>小見出し</h2></div>');
  const root = dom.window.document.getElementById('report-content');
  dom.window.ReportEngine.ensureHeadingId(root, root.querySelector('h2'));
  await flushMutations();
  assert.strictEqual(statusText(dom), '');
});

test('一次保存のHTMLには保存ステータス表示が含まれない', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  dom.window.document.querySelector('#report-content p').firstChild.data = '変更';
  await flushMutations();
  const draftHtml = dom.window.ReportEngine.buildDraftHTML();
  // scriptタグ内の文字列には[未保存]が含まれるので、文字列検索ではなくDOMとして確認する
  const draftDoc = new JSDOM(draftHtml).window.document;
  assert.strictEqual(draftDoc.querySelector('.report-engine-status'), null, '一次保存に保存ステータス表示が残っている');
});

test('[未保存]のときだけbeforeunloadで離脱確認が要求される', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  const fire = () => {
    const ev = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  assert.strictEqual(fire(), false, '未変更なのに離脱確認が要求された');

  dom.window.document.querySelector('#report-content p').firstChild.data = '変更';
  await flushMutations();
  assert.strictEqual(fire(), true, '[未保存]なのに離脱確認が要求されていない');

  dom.window.ReportEngine.downloadBlob = () => {};
  dom.window.ReportEngine.performSave('html');
  await flushMutations();
  assert.strictEqual(fire(), false, '保存後も離脱確認が要求されている');
});

// ------------------------------------------------------------------
// 表の追加・編集(メニューの「一覧表」「単票」プルダウン)
// ------------------------------------------------------------------
function setCaret(dom, node, offset = 0) {
  const range = dom.window.document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// セルaの先頭からセルbの末尾までをドラッグ選択した状態にする
function selectCells(dom, a, b) {
  const range = dom.window.document.createRange();
  range.setStart(a, 0);
  range.setEnd(b, b.childNodes.length);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 表の構造を「th td* ...」のような文字列の配列にする(*n=colspan, ^n=rowspan, :文字=中身)
function layout(table) {
  return Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.cells).map((c) => {
    const cs = parseInt(c.getAttribute('colspan') || '1', 10);
    const rs = parseInt(c.getAttribute('rowspan') || '1', 10);
    const text = c.textContent.trim();
    return c.tagName.toLowerCase() + (cs > 1 ? '*' + cs : '') + (rs > 1 ? '^' + rs : '') + (text ? ':' + text : '');
  }).join(' '));
}

const LIST3 = '<div id="report-content"><p>前</p><table>' +
  '<tr><th>H1</th><th>H2</th><th>H3</th></tr>' +
  '<tr><th>a</th><td>b</td><td>c</td></tr>' +
  '<tr><th>d</th><td>e</td><td>f</td></tr>' +
  '</table><p>後</p></div>';
const FORM2 = '<div id="report-content"><table>' +
  '<tr><th>氏名</th><td>山田</td><th>所属</th><td>営業</td></tr>' +
  '<tr><th>日付</th><td>1/1</td><th>承認</th><td>佐藤</td></tr>' +
  '</table></div>';

function cellByText(dom, text) {
  return Array.from(dom.window.document.querySelectorAll('#report-content th, #report-content td'))
    .find((c) => c.textContent.trim() === text);
}

function errorText(dom) {
  return dom.window.document.querySelector('.report-engine-msg').textContent;
}

test('メニューバーに「一覧表」「単票」プルダウンがあり、指定どおりの項目が並ぶ', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  const menus = Array.from(dom.window.document.querySelectorAll('.report-engine-bar .report-engine-dropdown'));
  assert.deepStrictEqual(menus.map((m) => m.querySelector('button').textContent), ['一覧表 ▾', '単票 ▾']);
  const items = (m) => Array.from(m.querySelectorAll('.report-engine-dropdown-menu button')).map((b) => b.textContent);
  assert.deepStrictEqual(items(menus[0]), ['一覧表の追加', '列追加', '列削除', '行追加', '行削除', 'セルの結合']);
  assert.deepStrictEqual(items(menus[1]), ['単票の追加', '列追加', '列削除', '行追加', '行削除', 'タイトルセルに変更', 'データセルに変更']);
  assert.ok(menus.every((m) => m.querySelector('.report-engine-dropdown-menu').hidden), '最初は閉じているべき');
});

test('プルダウンはクリックで開閉し、項目を選ぶと閉じて操作が実行される', async () => {
  const dom = await makeEnv('<div id="report-content"><p>本文</p></div>');
  const doc = dom.window.document;
  const menu = doc.querySelector('.report-engine-dropdown[data-kind="list"]');
  const list = menu.querySelector('.report-engine-dropdown-menu');
  setCaret(dom, doc.querySelector('#report-content p').firstChild, 1);
  menu.querySelector('button').click();
  assert.strictEqual(list.hidden, false, 'クリックで開いていない');
  list.querySelector('button[data-command="insert"]').click();
  assert.strictEqual(list.hidden, true, '項目を選んだ後に閉じていない');
  assert.strictEqual(doc.querySelectorAll('#report-content table').length, 1, '表が追加されていない');
});

test('一覧表の追加: 1行目がタイトル行の5列×(タイトル行+データ3行)の表がカーソル位置の段落の直後に入る', async () => {
  const dom = await makeEnv('<div id="report-content"><p>前</p><p>後</p></div>');
  const doc = dom.window.document;
  setCaret(dom, doc.querySelector('#report-content p').firstChild, 1);
  assert.strictEqual(dom.window.ReportEngine.runTableCommand('list', 'insert'), true);
  const table = doc.querySelector('#report-content table');
  assert.deepStrictEqual(layout(table), [
    'th th th th th',
    'th td td td td',
    'th td td td td',
    'th td td td td'
  ]);
  assert.ok(table.classList.contains('report-table-list'), '一覧表のクラスが付いていない');
  assert.strictEqual(table.previousElementSibling.textContent, '前');
  assert.strictEqual(table.nextElementSibling.textContent, '後');
  assert.strictEqual(dom.window.getSelection().anchorNode.closest('th'), table.rows[0].cells[0], 'カーソルが先頭セルに移っていない');
  const { warnings } = dom.window.ReportEngine.containerToMarkdown(doc.getElementById('report-content'));
  assert.strictEqual(warnings.length, 0, '追加した一覧表のMarkdown変換で警告が出た: ' + warnings.join(' / '));
});

test('単票の追加: 6列×3行で、奇数列がタイトルセル・偶数列がデータセルになる', async () => {
  const dom = await makeEnv('<div id="report-content"><p>前</p></div>');
  const doc = dom.window.document;
  setCaret(dom, doc.querySelector('#report-content p').firstChild, 1);
  dom.window.ReportEngine.runTableCommand('form', 'insert');
  const table = doc.querySelector('#report-content table');
  assert.deepStrictEqual(layout(table), [
    'th td th td th td',
    'th td th td th td',
    'th td th td th td'
  ]);
  assert.ok(table.classList.contains('report-table-form'), '単票のクラスが付いていない');
  assert.ok(table.nextElementSibling && table.nextElementSibling.tagName === 'P', '表の後ろに続きを書く段落が無い');
});

test('表の中にカーソルがあるときに表を追加すると、その表の直後に入る(入れ子にならない)', async () => {
  const dom = await makeEnv(LIST3);
  const doc = dom.window.document;
  setCaret(dom, cellByText(dom, 'e').firstChild);
  dom.window.ReportEngine.runTableCommand('form', 'insert');
  const tables = doc.querySelectorAll('#report-content table');
  assert.strictEqual(tables.length, 2);
  assert.strictEqual(tables[1].parentNode.id, 'report-content', '表が入れ子になっている');
  assert.strictEqual(tables[0].nextElementSibling, tables[1]);
});

test('一覧表の列追加: カーソルのある列の右に追加され、タイトル行はTH・他はTDになる', async () => {
  const dom = await makeEnv(LIST3);
  setCaret(dom, cellByText(dom, 'b').firstChild);
  assert.strictEqual(dom.window.ReportEngine.runTableCommand('list', 'addColumn'), true);
  assert.deepStrictEqual(layout(dom.window.document.querySelector('table')), [
    'th:H1 th:H2 th th:H3',
    'th:a td:b td td:c',
    'th:d td:e td td:f'
  ]);
});

test('一覧表の行追加: カーソルのある行の下に「先頭TH+残りTD」の行が追加される', async () => {
  const dom = await makeEnv(LIST3);
  setCaret(dom, cellByText(dom, 'b').firstChild);
  dom.window.ReportEngine.runTableCommand('list', 'addRow');
  assert.deepStrictEqual(layout(dom.window.document.querySelector('table')), [
    'th:H1 th:H2 th:H3',
    'th:a td:b td:c',
    'th td td',
    'th:d td:e td:f'
  ]);
});

test('一覧表の列削除・行削除: カーソルのある列/行が消える', async () => {
  const dom = await makeEnv(LIST3);
  setCaret(dom, cellByText(dom, 'b').firstChild);
  dom.window.ReportEngine.runTableCommand('list', 'deleteColumn');
  assert.deepStrictEqual(layout(dom.window.document.querySelector('table')), [
    'th:H1 th:H3', 'th:a td:c', 'th:d td:f'
  ]);
  setCaret(dom, cellByText(dom, 'f').firstChild);
  dom.window.ReportEngine.runTableCommand('list', 'deleteRow');
  assert.deepStrictEqual(layout(dom.window.document.querySelector('table')), ['th:H1 th:H3', 'th:a td:c']);
});

test('一覧表のタイトル行・最後の1列は削除できずメッセージが出る', async () => {
  const dom = await makeEnv('<div id="report-content"><table><tr><th>H</th></tr><tr><th>a</th></tr></table></div>');
  setCaret(dom, cellByText(dom, 'H').firstChild);
  assert.strictEqual(dom.window.ReportEngine.runTableCommand('list', 'deleteRow'), false);
  assert.ok(errorText(dom).includes('タイトル行は削除できません'), errorText(dom));
  assert.strictEqual(dom.window.ReportEngine.runTableCommand('list', 'deleteColumn'), false);
  assert.ok(errorText(dom).includes('最後の1列は削除できません'), errorText(dom));
  assert.strictEqual(dom.window.document.querySelectorAll('tr').length, 2);
});

test('一覧表のセルの結合: ドラッグで選んだ範囲が1つのセルになり、中身は左上にまとまる', async () => {
  const dom = await makeEnv(LIST3);
  selectCells(dom, cellByText(dom, 'b'), cellByText(dom, 'f'));
  assert.strictEqual(dom.window.ReportEngine.runTableCommand('list', 'merge'), true);
  const table = dom.window.document.querySelector('table');
  assert.deepStrictEqual(layout(table), ['th:H1 th:H2 th:H3', 'th:a td*2^2:bcef', 'th:d']);
  assert.strictEqual(table.rows[1].cells[1].querySelectorAll('br').length, 3, '結合した中身が改行で区切られていない');
});

test('セルの結合は1セルだけ選んでいるとメッセージが出て何もしない', async () => {
  const dom = await makeEnv(LIST3);
  setCaret(dom, cellByText(dom, 'b').firstChild);
  assert.strictEqual(dom.window.ReportEngine.runTableCommand('list', 'merge'), false);
  assert.ok(errorText(dom).includes('2つ以上選択'), errorText(dom));
});

test('結合セルがある表でも列追加・行追加・行削除で位置がずれない', async () => {
  const dom = await makeEnv(LIST3);
  const RE = dom.window.ReportEngine;
  selectCells(dom, cellByText(dom, 'b'), cellByText(dom, 'f'));
  RE.runTableCommand('list', 'merge');
  const table = dom.window.document.querySelector('table');

  // 結合セルの中から列追加 → 結合セルの右(最後の列)に追加される
  setCaret(dom, table.rows[1].cells[1].firstChild);
  RE.runTableCommand('list', 'addColumn');
  assert.deepStrictEqual(layout(table), ['th:H1 th:H2 th:H3 th', 'th:a td*2^2:bcef td', 'th:d td']);

  // H2の列(結合セルの左半分)から列追加 → 結合セルをまたぐので結合が1列広がる
  setCaret(dom, cellByText(dom, 'H2').firstChild);
  RE.runTableCommand('list', 'addColumn');
  assert.deepStrictEqual(layout(table), ['th:H1 th:H2 th th:H3 th', 'th:a td*3^2:bcef td', 'th:d td']);

  // aの行から行追加 → 結合セルをまたぐので結合が1行伸びる
  setCaret(dom, cellByText(dom, 'a').firstChild);
  RE.runTableCommand('list', 'addRow');
  assert.deepStrictEqual(layout(table), ['th:H1 th:H2 th th:H3 th', 'th:a td*3^3:bcef td', 'th td', 'th:d td']);

  // 結合セルが始まる行を削除 → 結合セルは次の行に移って1行縮む
  setCaret(dom, cellByText(dom, 'a').firstChild);
  RE.runTableCommand('list', 'deleteRow');
  assert.deepStrictEqual(layout(table), ['th:H1 th:H2 th th:H3 th', 'th td*3^2:bcef td', 'th:d td']);
  const g = RE.buildTableGrid(table);
  assert.ok(g.grid.every((row) => row.length === 5 && row.every(Boolean)), '格子に穴やずれがある');
});

test('単票の行追加: 上の行のTH/TDの並びを引き継いだ行が下に追加される', async () => {
  const dom = await makeEnv(FORM2);
  setCaret(dom, cellByText(dom, '山田').firstChild);
  dom.window.ReportEngine.runTableCommand('form', 'addRow');
  assert.deepStrictEqual(layout(dom.window.document.querySelector('table')), [
    'th:氏名 td:山田 th:所属 td:営業',
    'th td th td',
    'th:日付 td:1/1 th:承認 td:佐藤'
  ]);
});

test('単票の列追加・列削除: カーソルのある列の右にデータセルの列が入り、列削除で消える', async () => {
  const dom = await makeEnv(FORM2);
  const RE = dom.window.ReportEngine;
  setCaret(dom, cellByText(dom, '山田').firstChild);
  RE.runTableCommand('form', 'addColumn');
  const table = dom.window.document.querySelector('table');
  assert.deepStrictEqual(layout(table), [
    'th:氏名 td:山田 td th:所属 td:営業',
    'th:日付 td:1/1 td th:承認 td:佐藤'
  ]);
  setCaret(dom, cellByText(dom, '所属').firstChild);
  RE.runTableCommand('form', 'deleteColumn');
  assert.deepStrictEqual(layout(table), ['th:氏名 td:山田 td td:営業', 'th:日付 td:1/1 td td:佐藤']);
});

test('単票のタイトルセル/データセル切り替え: 選択したセルのTH/TDが変わり、中身とカーソル位置は保たれる', async () => {
  const dom = await makeEnv(FORM2);
  const RE = dom.window.ReportEngine;
  const yamada = cellByText(dom, '山田').firstChild;
  setCaret(dom, yamada, 1);
  RE.runTableCommand('form', 'toTitle');
  const table = dom.window.document.querySelector('table');
  assert.deepStrictEqual(layout(table)[0], 'th:氏名 th:山田 th:所属 td:営業');
  const sel = dom.window.getSelection();
  assert.strictEqual(sel.anchorNode, yamada, 'カーソルが元のテキストに戻っていない');
  assert.strictEqual(sel.anchorOffset, 1);

  // 複数セルをドラッグで選択して一括でデータセルに
  selectCells(dom, cellByText(dom, '日付'), cellByText(dom, '承認'));
  RE.runTableCommand('form', 'toData');
  assert.deepStrictEqual(layout(table)[1], 'td:日付 td:1/1 td:承認 td:佐藤');

  // 行をまたいだ選択は、最初と最後のセルを対角とする長方形が対象(途中の行の左端は含まない)
  selectCells(dom, cellByText(dom, '所属'), cellByText(dom, '1/1'));
  RE.runTableCommand('form', 'toTitle');
  assert.deepStrictEqual(layout(table), ['th:氏名 th:山田 th:所属 td:営業', 'td:日付 th:1/1 th:承認 td:佐藤']);
});

test('選択の終わりが隣のセルの先頭に接しているだけなら、そのセルは対象にしない', async () => {
  const dom = await makeEnv(FORM2);
  const a = cellByText(dom, '氏名');
  const b = cellByText(dom, '山田');
  const range = dom.window.document.createRange();
  range.setStart(a.firstChild, 0);
  range.setEnd(b, 0);
  const sel = dom.window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const cells = dom.window.ReportEngine.getSelectedCells(dom.window.document.getElementById('report-content'));
  assert.strictEqual(cells.length, 1);
  assert.strictEqual(cells[0], a);
});

test('メニューと表の種類が違う場合や、表の外にカーソルがある場合はメッセージを出して何もしない', async () => {
  const dom = await makeEnv(FORM2.replace('</table></div>', '</table><p>外</p></div>'));
  const RE = dom.window.ReportEngine;
  const before = dom.window.document.querySelector('table').outerHTML;
  setCaret(dom, cellByText(dom, '山田').firstChild);
  assert.strictEqual(RE.runTableCommand('list', 'addRow'), false);
  assert.ok(errorText(dom).includes('カーソル位置の表は単票です'), errorText(dom));

  setCaret(dom, dom.window.document.querySelector('#report-content p').firstChild);
  assert.strictEqual(RE.runTableCommand('form', 'addRow'), false);
  assert.ok(errorText(dom).includes('表のセル内にカーソルを置いて'), errorText(dom));
  assert.strictEqual(dom.window.document.querySelector('table').outerHTML, before, '表が変更されてしまった');
});

test('表の操作でも[未保存]になる', async () => {
  const dom = await makeEnv(LIST3);
  setCaret(dom, cellByText(dom, 'b').firstChild);
  dom.window.ReportEngine.runTableCommand('list', 'addRow');
  await flushMutations();
  assert.strictEqual(statusText(dom), '[未保存]');
});

// ------------------------------------------------------------------
(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      pass++;
      console.log('  OK  ' + name);
    } catch (e) {
      fail++;
      console.log(' FAIL ' + name);
      console.log('       ' + e.message);
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
