// PDF 导出功能：日报和收藏夹
// 使用 html2canvas + jsPDF 直接生成，不使用 html2pdf 封装
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

function _expandDetails() {
  var saved = [];
  var details = document.querySelectorAll('details');
  for (var i = 0; i < details.length; i++) {
    saved.push({ el: details[i], wasOpen: details[i].hasAttribute('open') });
    details[i].setAttribute('open', '');
  }
  var summaries = document.querySelectorAll('summary');
  for (var j = 0; j < summaries.length; j++) {
    saved.push({ el: summaries[j], display: summaries[j].style.display, _isSummary: true });
    summaries[j].style.display = 'none';
  }
  return saved;
}

function _restoreDetails(saved) {
  saved.forEach(function(s) {
    if (s._isSummary) {
      s.el.style.display = s.display;
    } else {
      if (!s.wasOpen) s.el.removeAttribute('open');
    }
  });
}

function _generatePDF(wrap, filename) {
  return html2canvas(wrap, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    letterRendering: true
  }).then(function(canvas) {
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    var pageWidth = pdf.internal.pageSize.getWidth();
    var pageHeight = pdf.internal.pageSize.getHeight();
    var margin = 10;
    var imgWidth = pageWidth - margin * 2;
    var imgHeight = (canvas.height / canvas.width) * imgWidth;

    var imgData = canvas.toDataURL('image/png');

    var heightLeft = imgHeight;
    var position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - margin * 2);

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - margin * 2);
    }

    pdf.save(filename);
  });
}


// Get today summary full content and inject into DOM
function _injectSummaryContent() {
  var summaryCards = document.querySelectorAll('#fav-list .card');
  var promises = [];
  
  summaryCards.forEach(function(card) {
    var title = card.querySelector('h2');
    if (!title) return;
    var titleText = title.textContent || '';
    
    if (titleText.indexOf('今日总结') !== -1) {
      var dateMatch = titleText.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        var date = dateMatch[1];
        var prefix = window.location.pathname.indexOf('/archive/') >= 0 ? '../' : '';
        var p = fetch(prefix + 'summaries.json').then(function(res) {
          return res.json();
        }).then(function(data) {
          if (data[date]) {
            var summary = data[date];
            var contentDiv = document.createElement('div');
            contentDiv.className = 'summary-full-content';
            contentDiv.style.cssText = 'margin-top:12px;padding:12px;background:#f7fbfc;border-radius:8px;font-size:13px;';
            
            if (summary.overview) {
              contentDiv.innerHTML += '<p><b>概述:</b> ' + summary.overview + '</p>';
            }
            if (summary.conclusions) {
              contentDiv.innerHTML += '<p><b>结论:</b> ' + summary.conclusions.join('; ') + '</p>';
            }
            if (summary.top_picks) {
            var picks = summary.top_picks;
            if (Array.isArray(picks)) picks = picks.map(function(p) { return p.title || ''; }).join('、');
            contentDiv.innerHTML += '<p><b>精选:</b> ' + picks + '</p>';
            }
            if (summary.industry_use) {
              contentDiv.innerHTML += '<p><b>行业应用:</b> ' + summary.industry_use + '</p>';
            }
            if (summary.risks) {
              contentDiv.innerHTML += '<p><b>风险:</b> ' + summary.risks + '</p>';
            }
            
            var existing = card.querySelector('.summary-full-content');
            if (existing) existing.remove();
            
            var brief = card.querySelector('.brief');
            if (brief) {
              brief.parentNode.insertBefore(contentDiv, brief.nextSibling);
            } else {
              card.appendChild(contentDiv);
            }
          }
        });
        promises.push(p);
      }
    }
  });
  
  return Promise.all(promises);
}

// Get current filter state
function _getFilterState() {
  if (typeof window.adrGetFilterState === 'function') return window.adrGetFilterState();
  return {
    search: document.getElementById('fav-q') ? document.getElementById('fav-q').value : '',
    dateFrom: document.getElementById('fav-date-from') ? document.getElementById('fav-date-from').value : '',
    dateTo: document.getElementById('fav-date-to') ? document.getElementById('fav-date-to').value : '',
    scrollTop: window.scrollY
  };
}

// Restore filter state
function _restoreFilterState(state) {
  if (typeof window.adrSetFilterState === 'function') { window.adrSetFilterState(state); return; }
  if (state.search && document.getElementById('fav-q')) document.getElementById('fav-q').value = state.search;
  if (state.dateFrom && document.getElementById('fav-date-from')) document.getElementById('fav-date-from').value = state.dateFrom;
  if (state.dateTo && document.getElementById('fav-date-to')) document.getElementById('fav-date-to').value = state.dateTo;
  if (state.scrollTop) window.scrollTo(0, state.scrollTop);
}

function exportDailyPDF() {
  var btn = document.querySelector('.export-pdf-btn');
  var loading = document.getElementById('pdf-loading');
  if (!btn || !loading) return;

  btn.disabled = true;
  btn.textContent = '⏳ 正在生成...';
  loading.style.display = 'block';

  var hidden = _hideEls([
    '.fav-bar', '.export-pdf-btn', '.pdf-loading',
    '.archive', 'footer', '.fav-btn'
  ]);

  var detailsSaved = _expandDetails();

  var wrap = document.querySelector('.wrap');
  var date = document.title.replace('AI 日报雷达 · ', '');
  var filename = 'AI日报雷达_' + date + '.pdf';

  _generatePDF(wrap, filename).then(function() {
    _restoreDetails(detailsSaved);
    _restoreEls(hidden);
    btn.disabled = false;
    btn.textContent = '📄 导出当日日报为 PDF';
    loading.style.display = 'none';
  }).catch(function(err) {
    console.error('PDF export failed:', err);
    _restoreDetails(detailsSaved);
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

  // 1. Save filter state
  var filterState = _getFilterState();

  // 2. Hide UI elements (complete selectors: add cat tabs, date filter, count)
  var hidden = _hideEls([
    '.export-pdf-btn', '.pdf-loading', '.fav-btn',
    '.fav-toolbar', '.fav-link-box', '.copy-btn',
    '.fav-cat-tab', '.fav-date-filter', '#fav-count'
  ]);
  var detailsSaved = _expandDetails();

  // 3. Clear all filters to show ALL favorites
  if (typeof window.adrSetFilterState === 'function') {
    window.adrSetFilterState({ category: '', date: '', from: '', to: '', search: '', sortDesc: true });
  }

  // 4. Wait for DOM update -> inject summary content -> generate PDF
  setTimeout(function() {
    _injectSummaryContent().then(function() {
      var wrap = document.querySelector('.wrap');
      var filename = 'AI日报雷达_收藏夹.pdf';
      _generatePDF(wrap, filename).then(function() {
        // 5. Restore state
        _restoreDetails(detailsSaved); _restoreEls(hidden); _restoreFilterState(filterState);
        btn.disabled = false;
        btn.textContent = '📄 导出收藏夹为 PDF';
        loading.style.display = 'none';
      }).catch(function(err) {
        console.error('PDF export failed:', err);
        _restoreDetails(detailsSaved); _restoreEls(hidden); _restoreFilterState(filterState);
        btn.disabled = false;
        btn.textContent = '❌ 导出失败，请重试';
        loading.style.display = 'none';
        setTimeout(function() {
          btn.textContent = '📄 导出收藏夹为 PDF';
        }, 2000);
      });
    });
  }, 300);
}
