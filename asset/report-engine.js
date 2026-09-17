/*!
 * report-engine.js
 * ------------------------------------------------------------
 * 帳票フォーム用の contentEditable 編集 + 保存(HTML/Markdown/PDF)エンジン。
 *
 * 使い方:
 *   1. HTML側に <div id="report-content"> ... 帳票の枠(見出し/段落/引用/表) ... </div>
 *      を用意する(枠の中身は自由。h1〜h6, p, blockquote, table などが使える)。
 *   2. report-engine.js を script 要素(src="report-engine.js")で body の最後に読み込む。
 *   3. 読み込むと自動的に #report-content が編集可能になり、画面上部に
 *      メニューバー(保存ボタン + メッセージ欄)が表示される。
 *   4. Ctrl+S または保存ボタンで、保存形式(HTML/Markdown/PDF/一次保存)の選択ダイアログが開く。
 *      「一次保存」は書きかけの内容をそのまま(CSS・JavaScriptも含めて)保存し、
 *      後でそのファイルを開けば編集を再開できる。それ以外の3形式は完成品としての書き出し。
 *   5. 「画像を挿入」ボタン、またはカーソル位置への貼り付け(Ctrl+V)で画像を追加できる。
 *      画像はbase64のdata URLとして埋め込まれるため、追加ファイル無しで自己完結する。
 *
 * 表 → Markdown 変換ルール:
 *   ・1行目の全セルがTHの場合 = 「一覧表形式」
 *       2行目以降: 行頭がTHなら第1階層、各列の値は
 *       「第2階層: 1行目の見出し(TH)」「第3階層: そのセル(TD)の値」
 *   ・1行目にTD以外(TH以外)が混ざる場合 = 「単票形式」
 *       行内を先頭から走査し、THを第1階層、直後に続くTDを第2階層として出力
 *   ・THEAD/TBODY/TFOOTタグの有無に関わらず動作する(<tr>を直接走査)
 *
 * PDF保存は html2pdf.js (CDN) を利用する。html2pdf.js が読み込めない
 * (オフライン等)場合は、その旨をメッセージ欄にエラー表示して保存を中止する。
 */
(function (global, document) {
  'use strict';

  var CONTAINER_ID = 'report-content';
  var STYLE_ID = 'report-engine-style';

  var ReportEngine = {};

  // ==============================================================
  // ユーティリティ
  // ==============================================================

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  // 選択範囲がコンテナ外(未フォーカス)の場合は、コンテナ末尾にカーソルを置く
  function focusContainer(root) {
    var sel = global.getSelection();
    var insideContainer = sel && sel.anchorNode && root.contains(sel.anchorNode);
    if (!insideContainer) {
      root.focus();
      var range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function insertImageDataUrl(root, dataUrl) {
    focusContainer(root);
    document.execCommand('insertImage', false, dataUrl);
  }

  function sanitizeFilename(name) {
    var cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    return cleaned || 'report';
  }

  // ==============================================================
  // 表 → Markdown 変換
  // ==============================================================

  // theadやtbodyの有無に関わらず、tableの下のtrを出現順にすべて取得する
  function getDirectRows(table) {
    return Array.from(table.querySelectorAll('tr'));
  }

  function tableToMarkdown(table, warnings) {
    var rows = getDirectRows(table);
    if (rows.length === 0) {
      warnings.push('空の表があります(変換をスキップしました)。');
      return '';
    }

    var hasSpan = rows.some(function (row) {
      return Array.from(row.cells).some(function (c) {
        return (c.colSpan && c.colSpan > 1) || (c.rowSpan && c.rowSpan > 1);
      });
    });
    if (hasSpan) {
      warnings.push('結合セル(colspan/rowspan)を含む表があります。変換結果をご確認ください。');
    }

    var firstRowCells = Array.from(rows[0].cells);
    var isListFormat = firstRowCells.length > 0 && firstRowCells.every(function (c) {
      return c.tagName.toLowerCase() === 'th';
    });

    var lines = [];

    if (isListFormat) {
      // ---- 一覧表形式: 1行目=見出し行、2行目以降=各レコード ----
      var headers = firstRowCells.map(textOf);
      for (var i = 1; i < rows.length; i++) {
        var cells = Array.from(rows[i].cells);
        if (cells.length === 0) continue;

        var offset = 0;
        if (cells[0].tagName.toLowerCase() === 'th') {
          lines.push('- ' + textOf(cells[0]));
          offset = 1;
        } else {
          warnings.push('一覧表形式の' + (i + 1) + '行目の先頭列がTHではありません。');
        }

        for (var j = offset; j < cells.length; j++) {
          var header = headers[j];
          if (header === undefined) {
            warnings.push('表の' + (i + 1) + '行目 ' + (j + 1) + '列目に対応する見出し(TH)がありません。');
            header = '(列' + (j + 1) + ')';
          }
          var indent = offset ? '  ' : '';
          lines.push(indent + '- ' + header);
          lines.push(indent + '  - ' + textOf(cells[j]));
        }
      }
    } else {
      // ---- 単票形式: TH→TD のペアを先頭から走査 ----
      rows.forEach(function (row, rIdx) {
        var pendingTH = null;
        Array.from(row.cells).forEach(function (cell, cIdx) {
          var tag = cell.tagName.toLowerCase();
          var text = textOf(cell);
          if (tag === 'th') {
            lines.push('- ' + text);
            pendingTH = text;
          } else {
            if (pendingTH === null) {
              warnings.push('単票形式の' + (rIdx + 1) + '行目 ' + (cIdx + 1) + '列目のTDに対応するTHがありません。');
              lines.push('- ' + text);
            } else {
              lines.push('  - ' + text);
            }
          }
        });
      });
    }

    return lines.join('\n');
  }

  function nodeToMarkdown(node, lines, warnings) {
    if (node.nodeType === 3) { // TEXT_NODE
      var t = textOf(node);
      if (t) lines.push(t);
      return;
    }
    if (node.nodeType !== 1) return; // ELEMENT_NODEのみ処理

    var tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      lines.push('#'.repeat(Number(tag[1])) + ' ' + textOf(node));
      lines.push('');
      return;
    }
    if (tag === 'blockquote') {
      var quoted = textOf(node).split(/\n+/).map(function (l) { return '> ' + l; }).join('\n');
      lines.push(quoted);
      lines.push('');
      return;
    }
    if (tag === 'table') {
      lines.push(tableToMarkdown(node, warnings));
      lines.push('');
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      Array.from(node.children).forEach(function (li, idx) {
        lines.push((tag === 'ul' ? '- ' : (idx + 1) + '. ') + textOf(li));
      });
      lines.push('');
      return;
    }
    if (tag === 'br') { lines.push(''); return; }
    if (tag === 'script' || tag === 'style') { return; }
    if (tag === 'img') {
      var alt = node.getAttribute('alt') || '';
      var src = node.getAttribute('src') || '';
      lines.push('![' + alt + '](' + src + ')');
      lines.push('');
      return;
    }

    // 見出し/表/引用/リスト/画像を子に含む場合は再帰、それ以外は本文としてそのまま出力
    var hasBlockChild = Array.from(node.children).some(function (c) {
      var t2 = c.tagName.toLowerCase();
      return /^h[1-6]$/.test(t2) || ['table', 'blockquote', 'ul', 'ol', 'img'].indexOf(t2) !== -1;
    });
    if (hasBlockChild) {
      Array.from(node.childNodes).forEach(function (child) { nodeToMarkdown(child, lines, warnings); });
    } else {
      var text = textOf(node);
      if (text) { lines.push(text); lines.push(''); }
    }
  }

  function containerToMarkdown(root) {
    var warnings = [];
    var lines = [];
    Array.from(root.childNodes).forEach(function (n) { nodeToMarkdown(n, lines, warnings); });
    var md = lines.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
    return { markdown: md, warnings: warnings };
  }

  // ==============================================================
  // HTML変換(CSS埋め込み・scriptタグ除去)
  // ==============================================================

  function collectCSS() {
    var cssText = '';
    var warnings = [];
    Array.from(document.styleSheets).forEach(function (sheet) {
      if (sheet.ownerNode && sheet.ownerNode.id === STYLE_ID) return; // 本エンジンのUI用CSSは除外
      try {
        var rules = sheet.cssRules || sheet.rules || [];
        Array.from(rules).forEach(function (r) { cssText += r.cssText + '\n'; });
      } catch (e) {
        warnings.push('スタイルシートを読み込めませんでした: ' + (sheet.href || 'inline'));
      }
    });
    return { cssText: cssText, warnings: warnings };
  }

  function containerToStandaloneHTML(root, title) {
    var clone = root.cloneNode(true);
    Array.from(clone.querySelectorAll('script')).forEach(function (s) { s.remove(); });
    clone.removeAttribute('contenteditable');
    Array.from(clone.querySelectorAll('[contenteditable]')).forEach(function (el) {
      el.removeAttribute('contenteditable');
    });

    var css = collectCSS();
    var html = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n' +
      '<title>' + escapeHtml(title) + '</title>\n<style>\n' + css.cssText + '</style>\n</head>\n<body>\n' +
      clone.outerHTML + '\n</body>\n</html>\n';
    return { html: html, warnings: css.warnings };
  }

  // 一次保存: 書きかけの内容を、CSS/JavaScriptを含めて今の状態のまま書き出す。
  // (このファイルを開けば、そのまま編集を再開できる)
  // メニューバーなど本エンジンが動的に生成したUI要素だけは、再度開いたときに
  // 二重生成されないよう取り除く(scriptタグ自体は残すので、開けば自動的に作り直される)。
  function buildDraftHTML() {
    var docClone = document.documentElement.cloneNode(true);
    var bar = docClone.querySelector('.report-engine-bar');
    if (bar) bar.remove();
    var overlay = docClone.querySelector('.report-engine-modal-overlay');
    if (overlay) overlay.remove();
    var bodyEl = docClone.querySelector('body');
    if (bodyEl) bodyEl.style.paddingTop = '';
    return '<!DOCTYPE html>\n' + docClone.outerHTML + '\n';
  }

  // ==============================================================
  // ダウンロード
  // ==============================================================

  ReportEngine.downloadBlob = function (content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  function getBaseFilename() {
    var root = document.getElementById(CONTAINER_ID);
    var h1 = root && root.querySelector('h1');
    return sanitizeFilename((h1 && textOf(h1)) || document.title);
  }

  // ==============================================================
  // PDF出力 (html2pdf.js を利用)
  // ==============================================================

  function exportPDF(root, filename, onError) {
    if (typeof global.html2pdf === 'undefined') {
      onError('PDF出力ライブラリ(html2pdf.js)を読み込めませんでした。インターネット接続を確認してください。');
      return;
    }
    var clone = root.cloneNode(true);
    clone.removeAttribute('contenteditable');
    global.html2pdf().set({
      filename: filename,
      margin: 10,
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(clone).save();
  }

  // ==============================================================
  // UI: メニューバー / メッセージ欄 / 保存形式選択ダイアログ
  // ==============================================================

  var els = {};

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.report-engine-bar{position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'display:flex;align-items:center;gap:12px;padding:10px 16px;' +
      'background:#20293a;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.2);}' +
      '.report-engine-bar button.save{cursor:pointer;border:none;border-radius:6px;padding:6px 16px;' +
      'background:#3b6fd6;color:#fff;font-size:14px;flex-shrink:0;}' +
      '.report-engine-bar button.save:hover{background:#2f5bb3;}' +
      '.report-engine-bar button.insert-img{cursor:pointer;border-radius:6px;padding:6px 16px;' +
      'background:transparent;color:#fff;font-size:14px;flex-shrink:0;border:1px solid #4b5a70;}' +
      '.report-engine-bar button.insert-img:hover{background:#2c374a;}' +
      '.report-engine-msg{flex:1;min-height:1.2em;font-size:13px;color:#cbd3e1;}' +
      '.report-engine-msg.error{color:#ffb4b4;}' +
      '.report-engine-msg .close-msg{margin-left:8px;cursor:pointer;background:none;border:none;' +
      'color:inherit;font-size:13px;text-decoration:underline;padding:0;}' +
      '.report-engine-modal-overlay{position:fixed;inset:0;background:rgba(15,20,30,.45);' +
      'display:flex;align-items:center;justify-content:center;z-index:10000;}' +
      '.report-engine-modal{background:#fff;border-radius:10px;padding:24px;min-width:260px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.25);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}' +
      '.report-engine-modal h2{margin:0 0 16px;font-size:15px;color:#111827;font-weight:600;}' +
      '.report-engine-modal .choices{display:flex;flex-direction:column;gap:8px;}' +
      '.report-engine-modal .choices button{padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;' +
      'background:#f9fafb;font-size:14px;cursor:pointer;text-align:left;}' +
      '.report-engine-modal .choices button:hover{background:#eef2ff;border-color:#6366f1;}' +
      '.report-engine-modal .cancel{margin-top:14px;background:none;border:none;color:#6b7280;' +
      'cursor:pointer;font-size:13px;padding:0;}';
    document.head.appendChild(style);
  }

  function buildMenuBar() {
    var bar = document.createElement('div');
    bar.className = 'report-engine-bar';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', openFormatChooser);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) handleImageFile(file);
    });

    var imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'insert-img';
    imgBtn.textContent = '画像を挿入';
    imgBtn.addEventListener('click', function () { fileInput.click(); });

    var msg = document.createElement('span');
    msg.className = 'report-engine-msg';

    bar.appendChild(saveBtn);
    bar.appendChild(imgBtn);
    bar.appendChild(fileInput);
    bar.appendChild(msg);
    document.body.insertBefore(bar, document.body.firstChild);

    // 本文がバーの下に隠れないよう余白を確保
    document.body.style.paddingTop = bar.offsetHeight + 'px';

    els.bar = bar;
    els.saveBtn = saveBtn;
    els.imgBtn = imgBtn;
    els.msg = msg;
  }

  function handleImageFile(file) {
    var root = document.getElementById(CONTAINER_ID);
    if (!root) return Promise.resolve();
    return readFileAsDataURL(file).then(function (dataUrl) {
      insertImageDataUrl(root, dataUrl);
    }).catch(function () {
      showMessage('画像の読み込みに失敗しました。', 'error');
    });
  }

  function showMessage(text, type) {
    els.msg.innerHTML = '';
    els.msg.className = 'report-engine-msg' + (type === 'error' ? ' error' : '');
    var span = document.createElement('span');
    span.textContent = text;
    els.msg.appendChild(span);
    if (type === 'error') {
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'close-msg';
      close.textContent = '閉じる';
      close.addEventListener('click', clearMessage);
      els.msg.appendChild(close);
    }
  }

  function clearMessage() {
    els.msg.textContent = '';
    els.msg.className = 'report-engine-msg';
  }

  function openFormatChooser() {
    var overlay = document.createElement('div');
    overlay.className = 'report-engine-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'report-engine-modal';

    var heading = document.createElement('h2');
    heading.textContent = '保存形式を選択してください';
    modal.appendChild(heading);

    var choices = document.createElement('div');
    choices.className = 'choices';
    [
      ['html', 'HTML (.html) - 完成版'],
      ['markdown', 'Markdown (.md)'],
      ['pdf', 'PDF (.pdf)'],
      ['draft', '一次保存 (.html) - 編集を続ける用']
    ].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.format = pair[0];
      b.textContent = pair[1];
      b.addEventListener('click', function () {
        document.body.removeChild(overlay);
        performSave(pair[0]);
      });
      choices.appendChild(b);
    });
    modal.appendChild(choices);

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = 'キャンセル';
    cancel.addEventListener('click', function () { document.body.removeChild(overlay); });
    modal.appendChild(cancel);

    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

  function performSave(format) {
    var root = document.getElementById(CONTAINER_ID);
    if (!root) {
      showMessage('編集対象(#' + CONTAINER_ID + ')が見つかりません。', 'error');
      return;
    }
    var base = getBaseFilename();

    if (format === 'markdown') {
      var mdRes = containerToMarkdown(root);
      ReportEngine.downloadBlob(mdRes.markdown, base + '.md', 'text/markdown');
      mdRes.warnings.length ? showMessage(mdRes.warnings.join(' / '), 'error') : clearMessage();
      return;
    }
    if (format === 'html') {
      var htmlRes = containerToStandaloneHTML(root, base);
      ReportEngine.downloadBlob(htmlRes.html, base + '.html', 'text/html');
      htmlRes.warnings.length ? showMessage(htmlRes.warnings.join(' / '), 'error') : clearMessage();
      return;
    }
    if (format === 'pdf') {
      exportPDF(root, base + '.pdf', function (msg) { showMessage(msg, 'error'); });
      return;
    }
    if (format === 'draft') {
      var draftHtml = buildDraftHTML();
      ReportEngine.downloadBlob(draftHtml, base + '_下書き.html', 'text/html');
      clearMessage();
    }
  }

  // ==============================================================
  // 初期化
  // ==============================================================

  function init() {
    injectStyle();
    buildMenuBar();

    var root = document.getElementById(CONTAINER_ID);
    if (root) {
      root.setAttribute('contenteditable', 'true');
    } else {
      showMessage('編集対象(#' + CONTAINER_ID + ')が見つかりません。id="' + CONTAINER_ID + '" の要素を用意してください。', 'error');
    }

    document.addEventListener('keydown', function (e) {
      var key = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        openFormatChooser();
      }
    });

    // 帳票エリア内での画像貼り付け(スクリーンショット等)に対応
    document.addEventListener('paste', function (e) {
      var container = document.getElementById(CONTAINER_ID);
      if (!container || !container.contains(e.target)) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (!file) continue;
          e.preventDefault();
          handleImageFile(file);
          break;
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ==============================================================
  // 公開API(テスト・拡張用)
  // ==============================================================
  ReportEngine.containerToMarkdown = containerToMarkdown;
  ReportEngine.tableToMarkdown = tableToMarkdown;
  ReportEngine.containerToStandaloneHTML = containerToStandaloneHTML;
  ReportEngine.buildDraftHTML = buildDraftHTML;
  ReportEngine.performSave = performSave;
  ReportEngine.openFormatChooser = openFormatChooser;
  ReportEngine.readFileAsDataURL = readFileAsDataURL;
  ReportEngine.insertImageDataUrl = insertImageDataUrl;
  ReportEngine.handleImageFile = handleImageFile;
  ReportEngine._internal = {
    showMessage: showMessage,
    clearMessage: clearMessage,
    getBaseFilename: getBaseFilename,
    exportPDF: exportPDF,
    els: els
  };

  global.ReportEngine = ReportEngine;
})(window, document);
