// PDF 导出功能：日报和收藏夹
// 关键：必须使用页面中真实的 DOM 元素（不能用 clone），
// 因为 html2canvas 需要计算样式，脱离 DOM 的节点样式全部丢失会导出空白。
// 做法：临时隐藏不需要导出的元素，生成完再恢复。

function _hideEls(selectors) {
  var saved = [];
  selectors.forEach(function(sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      saved.push({ el: els[i], display: els[i].style.display });
      els[i].style.display = 'none';
    }
  });
  return saved;
}

function _restoreEls(saved) {
  saved.forEach(function(s) { s.el.style.display = s.display; });
}

function _makeOpt(filename) {
  return {
    margin: 10,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };
}

function exportDailyPDF() {
  var btn = document.querySelector('.export-pdf-btn');
  var loading = document.getElementById('pdf-loading');
  if (!btn || !loading) return;

  btn.disabled = true;
  btn.textContent = '⏳ 正在生成...';
  loading.style.display = 'block';

  // 临时隐藏不需要导出的部分
  var hidden = _hideEls([
    '.fav-bar', '.export-pdf-btn', '.pdf-loading',
    '.archive', 'footer', '.fav-btn'
  ]);

  var wrap = document.querySelector('.wrap');
  var date = document.title.replace('AI 日报雷达 · ', '');
  var filename = 'AI日报雷达_' + date + '.pdf';

  html2pdf().set(_makeOpt(filename)).from(wrap).save().then(function() {
    _restoreEls(hidden);
    btn.disabled = false;
    btn.textContent = '📄 导出当日日报为 PDF';
    loading.style.display = 'none';
  }).catch(function(err) {
    console.error('PDF export failed:', err);
    _restoreEls(hidden);
    btn.disabled = false;
    btn.textContent = '❌ 导出失败，请重试';
    loading.style.display = 'none';
    setTimeout(function() {
      btn.textContent = '📄 导出当日日报为 PDF';
    }, 2000);
  });
}

function exportFavoritesPDF() {
  var btn = document.querySelector('.export-pdf-btn');
  var loading = document.getElementById('pdf-loading');
  if (!btn || !loading) return;

  btn.disabled = true;
  btn.textContent = '⏳ 正在生成...';
  loading.style.display = 'block';

  // 临时隐藏按钮和辅助元素（收藏夹内容保留原样）
  var hidden = _hideEls([
    '.export-pdf-btn', '.pdf-loading', '.fav-btn',
    '.fav-toolbar', '.fav-link-box', '.copy-btn'
  ]);

  var wrap = document.querySelector('.wrap');
  var filename = 'AI日报雷达_收藏夹.pdf';

  html2pdf().set(_makeOpt(filename)).from(wrap).save().then(function() {
    _restoreEls(hidden);
    btn.disabled = false;
    btn.textContent = '📄 导出收藏夹为 PDF';
    loading.style.display = 'none';
  }).catch(function(err) {
    console.error('PDF export failed:', err);
    _restoreEls(hidden);
    btn.disabled = false;
    btn.textContent = '❌ 导出失败，请重试';
    loading.style.display = 'none';
    setTimeout(function() {
      btn.textContent = '📄 导出收藏夹为 PDF';
    }, 2000);
  });
}
