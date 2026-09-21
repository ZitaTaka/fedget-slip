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
