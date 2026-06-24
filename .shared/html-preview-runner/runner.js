(() => {
  'use strict';

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showError(message, detail = '') {
    document.title = 'HTML Preview Runner - Error';
    document.body.innerHTML = `
      <div class="runner-status">
        <div class="runner-card">
          <h1>预览启动失败</h1>
          <p>${escapeHtml(message)}</p>
          ${detail ? `<p><code>${escapeHtml(detail)}</code></p>` : ''}
        </div>
      </div>
    `;
  }

  let payload;
  try {
    payload = window.name ? JSON.parse(window.name) : null;
  } catch (error) {
    showError('无法解析预览数据。', error?.message || String(error));
    return;
  }

  if (!payload || typeof payload.html !== 'string' || !payload.html.trim()) {
    showError('没有接收到可用的 HTML 内容。');
    return;
  }

  try {
    window.name = '';
  } catch (_) {
    // ignore
  }

  document.open();
  document.write(payload.html);
  document.close();
})();
