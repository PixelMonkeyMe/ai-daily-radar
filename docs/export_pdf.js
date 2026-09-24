// PDF 导出功能：日报和收藏夹

function exportDailyPDF() {
  var btn = document.querySelector('.export-pdf-btn');
  var loading = document.getElementById('pdf-loading');
  if (!btn || !loading) return;
  
  btn.disabled = true;
  btn.textContent = '⏳ 正在生成...';
  loading.style.display = 'block';
  
  // 获取当日日报内容（不包括历史折叠部分）
  var wrap = document.querySelector('.wrap');
  var clone = wrap.cloneNode(true);
  
  // 移除历史折叠部分
  var archiveDiv = clone.querySelector('.archive');
  if (archiveDiv) archiveDiv.remove();
  
  // 移除导出按钮和 loading
  var btnClone = clone.querySelector('.export-pdf-btn');
  if (btnClone) btnClone.remove();
  var loadingClone = clone.querySelector('.pdf-loading');
  if (loadingClone) loadingClone.remove();
  
  // 展开所有 <details>
  var details = clone.querySelectorAll('details');
  for (var i = 0; i < details.length; i++) {
    details[i].setAttribute('open', '');
  }
  
  // 获取日期
  var date = document.title.replace('AI 日报雷达 · ', '');
  var filename = 'AI日报雷达_' + date + '.pdf';
  
  var opt = {
    margin: 10,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };
  
  html2pdf().set(opt).from(clone).save().then(function() {
    btn.disabled = false;
    btn.textContent = '📄 导出当日日报为 PDF';
    loading.style.display = 'none';
  }).catch(function(err) {
    console.error('PDF export failed:', err);
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
  
  // 获取收藏夹内容
  var wrap = document.querySelector('.wrap');
  var clone = wrap.cloneNode(true);
  
  // 移除导出按钮和 loading
  var btnClone = clone.querySelector('.export-pdf-btn');
  if (btnClone) btnClone.remove();
  var loadingClone = clone.querySelector('.pdf-loading');
  if (loadingClone) loadingClone.remove();
  
  var filename = 'AI日报雷达_收藏夹.pdf';
  
  var opt = {
    margin: 10,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };
  
  html2pdf().set(opt).from(clone).save().then(function() {
    btn.disabled = false;
    btn.textContent = '📄 导出收藏夹为 PDF';
    loading.style.display = 'none';
  }).catch(function(err) {
    console.error('PDF export failed:', err);
    btn.disabled = false;
    btn.textContent = '❌ 导出失败，请重试';
    loading.style.display = 'none';
    setTimeout(function() {
      btn.textContent = '📄 导出收藏夹为 PDF';
    }, 2000);
  });
}
