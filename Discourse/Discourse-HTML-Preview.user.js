// ==UserScript==
// @name         !.Discourse HTML Preview
// @description  Linux.do HTML 代码块预览工具：为 HTML 代码块添加眼睛图标预览按钮，并通过独立预览页执行 HTML/JS，绕开站点 CSP 对 Blob 预览的限制。
// @version      1.4.3
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        https://linux.do/t/topic/*
// @grant        GM_addStyle
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Discourse/Discourse-HTML-Preview.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Discourse/Discourse-HTML-Preview.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    selectors: {
      pre: '.cooked pre',
      code: 'code',
      buttonWrapper: '.codeblock-button-wrapper',
      buttonBar: '.codeblock-buttons',
      topicTitle: [
        '#topic-title .fancy-title',
        '.fancy-title',
        'h1 a.fancy-title',
        'h1 a span'
      ]
    },
    classes: {
      button: 'html-preview-cmd'
    },
    labels: {
      preview: '预览'
    },
    previewRunnerUrl: 'https://htmlpreview.github.io/?https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/.shared/html-preview-runner/index.html'
  };

  GM_addStyle(`
    .${CONFIG.classes.button} .d-icon,
    .${CONFIG.classes.button} .svg-icon,
    .${CONFIG.classes.button} svg {
      pointer-events: none;
    }
  `);

  class DiscourseHtmlPreview {
    constructor() {
      this.observer = null;
      this.rescanTimer = null;
    }

    init() {
      if (!this.isDiscoursePage()) return;

      this.scan();
      this.observe();
    }

    isDiscoursePage() {
      return Boolean(
        document.querySelector('meta[name="generator"][content*="Discourse"]') ||
        document.body?.classList.contains('discourse')
      );
    }

    observe() {
      this.observer = new MutationObserver((mutations) => {
        let shouldRescan = false;

        for (const mutation of mutations) {
          if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;

            if (
              node.matches?.('.cooked, pre') ||
              node.querySelector?.('.cooked pre') ||
              node.querySelector?.('pre code')
            ) {
              shouldRescan = true;
              break;
            }
          }

          if (shouldRescan) break;
        }

        if (!shouldRescan) return;

        clearTimeout(this.rescanTimer);
        this.rescanTimer = window.setTimeout(() => this.scan(), 60);
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    scan() {
      let htmlBlockIndex = 0;

      document.querySelectorAll(CONFIG.selectors.pre).forEach((preElement) => {
        const numbered = this.enhanceCodeBlock(preElement, htmlBlockIndex);
        if (numbered) htmlBlockIndex += 1;
      });
    }

    enhanceCodeBlock(preElement, htmlBlockIndex) {
      const codeBlock = preElement.querySelector(CONFIG.selectors.code);
      if (!codeBlock) return false;

      const buttonHost = preElement.querySelector(CONFIG.selectors.buttonWrapper)
        || preElement.querySelector(CONFIG.selectors.buttonBar);
      if (!buttonHost) return false;

      const codeText = this.getCodeText(codeBlock);
      if (!this.looksLikeHtml(preElement, codeBlock, codeText)) return false;

      if (buttonHost.querySelector(`.${CONFIG.classes.button}`)) return true;

      const previewBtn = this.createActionButton(
        this.getPreviewIconMarkup(),
        CONFIG.labels.preview,
        () => this.previewCode(codeBlock, htmlBlockIndex),
        CONFIG.labels.preview
      );

      buttonHost.appendChild(previewBtn);
      return true;
    }

    createActionButton(content, title, handler, ariaLabel = title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = content;
      button.title = title;
      button.setAttribute('aria-label', ariaLabel);
      button.className = `btn nohighlight btn-flat ${CONFIG.classes.button}`;

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
      });

      return button;
    }

    getPreviewIconMarkup() {
      const iconId = this.resolveEyeIconId();
      const iconName = iconId.replace(/^#/, '');

      return `
        <svg class="fa d-icon d-icon-${iconName} svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <use href="${iconId}"></use>
        </svg>
      `.trim();
    }

    resolveEyeIconId() {
      const preferredIds = ['#eye', '#far-eye', '#regular-eye', '#fa-eye'];

      for (const iconId of preferredIds) {
        const id = iconId.slice(1);
        if (document.getElementById(id)) {
          return iconId;
        }
      }

      const eyeSymbol = Array.from(document.querySelectorAll('symbol[id]')).find((symbol) =>
        /(^|[-_:])eye($|[-_:])/.test(symbol.id) || symbol.id.includes('eye')
      );

      return eyeSymbol ? `#${eyeSymbol.id}` : '#eye';
    }

    previewCode(codeBlock, index) {
      const codeText = this.getCodeText(codeBlock);
      if (!codeText) {
        alert('错误：HTML 内容为空。');
        return;
      }

      const title = `${this.getTopicTitle()} · 代码块 ${index + 1}`;
      this.openPreviewTab(this.buildPreviewDocument(codeText, title));
    }

    openPreviewTab(htmlDocument) {
      const previewWindow = window.open('about:blank', '_blank');
      if (!previewWindow) {
        alert('预览页被浏览器拦截了，请允许弹出新标签页后重试。');
        return;
      }

      previewWindow.opener = null;
      previewWindow.name = JSON.stringify({
        html: htmlDocument,
        sourceUrl: window.location.href,
        openedAt: Date.now()
      });
      previewWindow.location.replace(CONFIG.previewRunnerUrl);
    }

    getCodeText(codeBlock) {
      return codeBlock?.textContent?.replace(/\u00A0/g, ' ')?.trim() || '';
    }

    looksLikeHtml(preElement, codeBlock, codeText) {
      if (!codeText) return false;

      const classText = `${preElement.className || ''} ${codeBlock.className || ''}`.toLowerCase();
      if (/\b(?:lang(?:uage)?-(?:html|xml)|html|xml)\b/.test(classText)) return true;
      if (/^\s*<!doctype\s+html/i.test(codeText)) return true;
      if (/^\s*<html[\s>]/i.test(codeText)) return true;
      if (!/[<>]/.test(codeText)) return false;

      return (
        /<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(codeText) &&
        /<(?:body|head|div|span|p|section|article|main|header|footer|script|style|link|meta|title|svg|table|form|button|input|textarea|canvas|iframe|img|a|ul|ol|li)[\s/>]/i.test(codeText)
      );
    }

    buildPreviewDocument(codeText, title = `${this.getTopicTitle()} - HTML Preview`) {
      const source = codeText.trim();

      if (!source) {
        return this.wrapHtmlFragment('', title);
      }

      return this.isDocumentHtml(source)
        ? this.injectPreviewHead(source, title)
        : this.wrapHtmlFragment(source, title);
    }

    isDocumentHtml(source) {
      return (
        /^\s*<!doctype\s+html/i.test(source) ||
        /^\s*<html[\s>]/i.test(source) ||
        /<head[\s>]/i.test(source) ||
        /<body[\s>]/i.test(source)
      );
    }

    injectPreviewHead(source, title) {
      let html = source.trim();

      if (!/^\s*<!doctype/i.test(html)) {
        html = `<!doctype html>\n${html}`;
      }

      if (!/<html[\s>]/i.test(html)) {
        html = html.replace(/^\s*<!doctype[^>]*>\s*/i, '');
        html = `<!doctype html>\n<html>\n${html}\n</html>`;
      }

      const extras = this.buildHeadExtras(html, title);

      if (/<head[\s>]/i.test(html)) {
        return extras
          ? html.replace(/<head(\b[^>]*)>/i, (match, attrs) => `<head${attrs}>\n${extras}`)
          : html;
      }

      return html.replace(
        /<html(\b[^>]*)>/i,
        (match, attrs) => `<html${attrs}>\n<head>\n${extras}\n</head>`
      );
    }

    buildHeadExtras(source, title) {
      const extras = [];

      if (
        !/<meta[^>]+charset\s*=/i.test(source) &&
        !/<meta[^>]+http-equiv\s*=\s*["']content-type["']/i.test(source)
      ) {
        extras.push('<meta charset="utf-8">');
      }

      if (!/<base[\s>]/i.test(source)) {
        extras.push(`<base href="${this.escapeHtmlAttr(document.baseURI)}">`);
      }

      if (!/<title[\s>]/i.test(source)) {
        extras.push(`<title>${this.escapeHtmlText(title)}</title>`);
      }

      return extras.join('\n');
    }

    wrapHtmlFragment(fragment, title) {
      return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="${this.escapeHtmlAttr(document.baseURI)}">
<title>${this.escapeHtmlText(title)}</title>
</head>
<body>
${fragment}
</body>
</html>`;
    }

    escapeHtmlText(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    escapeHtmlAttr(text) {
      return this.escapeHtmlText(text).replace(/"/g, '&quot;');
    }

    getTopicTitle() {
      for (const selector of CONFIG.selectors.topicTitle) {
        const text = document.querySelector(selector)?.textContent?.trim();
        if (text) return text;
      }

      const fallback = document.title?.split(' - ')[0]?.trim();
      return fallback || 'discourse-html-preview';
    }
  }

  const boot = () => new DiscourseHtmlPreview().init();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
