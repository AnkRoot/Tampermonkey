// ==UserScript==
// @name         !.Discourse Raw → Markdown Copier
// @description  📝 Discourse 帖子 Markdown 复制工具——通过 Raw API 获取原始内容，智能转换为标准 Markdown，支持图片修复、BBCode转换、链接美化、代码高亮，采用分层架构设计，适用于技术文档迁移、博客转载、跨平台发布等场景。
// @version      2.5.3
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0
// @match        */t/topic/*
// @match        */t/*
// @grant        GM_setClipboard
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
// ==/UserScript==

(function () {
  'use strict';

  /**
   * [Layer 1] Config & Helpers
   */
  class Config {
    static SELECTORS = {
      ROOT_CHECK: [
        'meta[name="generator"][content*="Discourse"]',
        'body.discourse'
      ],
      POST_CONTAINER: '.topic-post',
      ACTION_CONTAINER: '.post-controls .actions',
      EXISTING_BTN: '.btn',
    };

    static UI = {
      button: {
        class: 'btn no-text btn-icon btn-flat discourse-md-copy-btn',
        icons: { copy: '#copy', check: '#check' },
        delay: 1800
      },
      messages: {
        title: '复制为标准 Markdown (Raw API)',
        success: '复制成功!',
        error: '复制失败: '
      }
    };

    static Utils = class {
      static escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      static safeHash = hash => CSS?.escape?.(hash) || hash;

      /**
       * 判断 offset 是否处于 Markdown 链接目标 (](...)) 内
       */
      static isInsideMdLinkTarget(full, offset) {
        if (!full || offset == null) return false;
        if (offset >= 2 && full.slice(offset - 2, offset) === '](') return true;

        const left = full.lastIndexOf('](', offset);
        if (left === -1) return false;

        const right = full.indexOf(')', left + 2);
        return right !== -1 && offset < right;
      }

      /**
       * 判断 offset 是否位于 Markdown 链接文字部分 [...] 内
       */
      static isInsideMdLinkText(full, offset) {
        if (!full || offset == null) return false;

        const leftBracket = full.lastIndexOf('[', offset);
        if (leftBracket === -1) return false;

        const rightBracket = full.indexOf(']', leftBracket + 1);
        if (rightBracket === -1) return false;

        return leftBracket < offset && offset < rightBracket;
      }

      /**
       * 链接类替换统一开关：位于链接文字或链接目标内则跳过
       */
      static shouldSkipLinkification(full, offset) {
        return (
          this.isInsideMdLinkTarget(full, offset) ||
          this.isInsideMdLinkText(full, offset)
        );
      }
    };

    /**
     * 文本处理器分组
     * 媒体 / Discourse 特有元素 / 结构化清理 / 链接&标签
     */
    static ProcessorGroups = {
      media(origin) {
        const U = Config.Utils;

        return [
          {
            // 1. 图片: upload:// → DOM 真实 URL（多级回退）
            name: 'Images',
            regex:
              /!\[([^|\]]*?)\|?([^\]]*)\]\(upload:\/\/([A-Za-z0-9]+)\.([A-Za-z0-9]+)\)/g,
            replacement: (match, altRaw, dimRaw, hash, ext) => {
              const alt = (altRaw || '').trim();

              try {
                const safeHash = U.safeHash(hash);

                // a) 直接从 data-base62-sha1 拿 src
                const img = document.querySelector(
                  `img[data-base62-sha1="${safeHash}"]`
                );
                if (img?.src) return `![${alt}](${img.src})`;

                // b) lightbox / a[href*="hash"]
                const href = document
                  .querySelector(
                    `a.lightbox[href*="${hash}"], a[href*="${hash}"]`
                  )
                  ?.getAttribute('href');
                if (href) {
                  const abs = href.startsWith('http') ? href : origin + href;
                  return `![${alt}](${abs})`;
                }

                // c) srcset/source 回退
                const ss = document.querySelector(
                  `source[srcset*="${hash}"], img[srcset*="${hash}"]`
                );
                const srcset = ss?.getAttribute('srcset');
                if (srcset) {
                  const first = srcset.split(',')[0]?.trim()?.split(' ')[0];
                  if (first) {
                    const abs = first.startsWith('http') ? first : origin + first;
                    return `![${alt}](${abs})`;
                  }
                }
              } catch (_) {
                // ignore
              }

              return match;
            },
          },

          {
            // 2. 附件: upload:// → 使用 DOM 恢复真实下载地址（只要加上域名即可）
            name: 'Attachments',
            regex:
              /\[([^\]|]+)(?:\|attachment)?\]\(upload:\/\/([A-Za-z0-9]+)(\.[A-Za-z0-9]+)?\)/g,
            replacement: (match, filename, hash, ext = '') => {
              try {
                const safeHash = U.safeHash(hash);

                // 优先：带 attachment 类的链接
                let a =
                  document.querySelector(
                    `a.attachment[href*="${safeHash}"]`
                  ) ||
                  document.querySelector(`a[href*="${safeHash}"]`);

                const href = a && a.getAttribute('href');
                if (href) {
                  const abs = href.startsWith('http') ? href : origin + href;
                  // 👉 输出标准 Markdown 链接，文件名保持原样
                  return `[${filename}](${abs})`;
                }
              } catch (_) {
                // ignore DOM 相关错误
              }

              // 找不到 DOM 对应链接时的兜底：至少保留可读信息
              return `${filename} (upload://${hash}${ext})`;
            },
          },
        ];
      },

      discourseMeta() {
        return [
          {
            // 3. 引用块: [quote] → Markdown blockquote
            name: 'Quotes',
            regex:
              /\[quote="([^"]*?)(?:,\s*post:\d+)?(?:,\s*topic:\d+)?(?:,\s*full:true)?"\]([\s\S]*?)\[\/quote\]/g,
            replacement: (_, authorRaw, contentRaw) => {
              const author = (authorRaw || '').trim();
              const content = (contentRaw || '').trim();

              const lines = content
                .split('\n')
                .map((l) => `> ${l}`.trimEnd());
              return `\n> **${author}:**\n${lines.join('\n')}\n`;
            },
          },

          {
            // 4. Discourse 时间戳: [date=...] → 纯文本
            name: 'Date',
            regex: /\[date=([^\]]+?)(?:\s+time=[^\]]+?)?\]/g,
            replacement: '$1',
          },

          {
            // 5. 列表项 [*] → *
            name: 'ListItems',
            regex: /\[\*\]\s*([\s\S]*?)(?=\n?\[\*\]|\n?\[\/list\])/g,
            replacement: (_, item) => `\n* ${(item || '').trim()}`,
          },

          {
            // 6. 移除列表容器 [list]
            name: 'ListWrapper',
            regex: /\[\/?list(?:=1)?\]\s*/g,
            replacement: '',
          },

          {
            // 7. Polls → Checkbox 列表
            name: 'Polls',
            regex: /\[poll[^\]]*\]([\s\S]*?)\[\/poll\]/g,
            replacement: (_, contentRaw = '') => {
              const items = contentRaw
                .trim()
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.startsWith('*'))
                .map(l => `- [ ] ${l.replace(/^\*\s*/, '').trim()}`);

              return `\n**📊 投票：**\n\n${
                items.length ? items.join('\n') : '(无内容)'
              }\n`;
            },
          },

          {
            // 8. 折叠内容 spoiler/details → <details>
            name: 'Details',
            regex: /\[(spoiler|details)(?:="([^"]*)")?\]([\s\S]*?)\[\/\1\]/g,
            replacement: (_, tag, title, contentRaw = '') => {
              const summary = title || (tag === 'spoiler' ? '剧透' : '详情');
              return `\n<details>\n<summary>${summary}</summary>\n\n${contentRaw.trim()}\n\n</details>\n`;
            },
          },
        ];
      },

      structure() {
        // BBCode 标签映射
        const BBCODE_MAP = {
          b: '**$1**',
          i: '*$1*',
          u: '<u>$1</u>',
          s: '~~$1~~',
          kbd: '<kbd>$1</kbd>'
        };

        // 动态生成 BBCode 转换器
        const bbcodeProcessors = Object.entries(BBCODE_MAP).map(([tag, replacement]) => ({
          name: `BBCode_${tag}`,
          regex: new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[/${tag}\\]`, 'g'),
          replacement
        }));

        return [
          ...bbcodeProcessors,
          {
            // 移除不支持的样式标签
            name: 'Cleanup',
            regex: /\[\/?(?:color|size|font|align)[^\]]*\]/g,
            replacement: '',
          },
        ];
      },

      linkification(origin) {
        const U = Config.Utils;
        const originEsc = U.escapeRegExp(origin);
        const PREFIX = '(^|[\\s([{"\\\'`])';

        return [
          {
            // 11. 用户提及: @user → 链接（避免套娃）
            name: 'Mentions',
            regex: new RegExp(`${PREFIX}@(\\w[\\w-]*)\\b`, 'g'),
            replacement: (m, pre, u, offset, full) => {
              if (U.shouldSkipLinkification(full, offset)) return m;
              return `${pre}[@${u}](${origin}/u/${u})`;
            },
          },

          {
            // 12. 话题链接 /t/slug/id → [Title](Link)（仅在非 URL 目标位置替换）
            name: 'TopicLinks',
            regex: new RegExp(
              `${originEsc}\\/t\\/([^\\/?#\\s]+)\\/(\\d+)(?:\\/(\\d+))?(?=\\b|[?#\\s]|$)`,
              'g'
            ),
            replacement: (match, slug, id, post, offset, full) => {
              if (U.isInsideMdLinkTarget(full, offset)) return match;
              const title = (slug || '').replace(/-/g, ' ').trim();
              return `[${title || slug}](${match})`;
            },
          },

          {
            // 13. 标签 #tag → 链接（避免 URL fragment / markdown link 套娃）
            name: 'Tags',
            regex: new RegExp(
              `${PREFIX}#([A-Za-z0-9\\-\\u4e00-\\u9fa5]+)\\b`,
              'g'
            ),
            replacement: (m, pre, t, offset, full) => {
              if (U.shouldSkipLinkification(full, offset)) return m;

              const prev = full?.[offset - 1] || '';
              if (/[\/:?=&#.]/.test(prev)) return m;

              return `${pre}[#${t}](${origin}/tag/${t})`;
            },
          },
        ];
      },
    };

    static getProcessors(origin, service) {
      // 此处预留 service 位，未来如需从 Service 注入更多上下文可直接使用
      const G = Config.ProcessorGroups;
      return [
        ...G.media(origin, service),
        ...G.discourseMeta(),
        ...G.structure(),
        ...G.linkification(origin),
      ];
    }
  }

  /**
   * [Layer 2] Service: Raw → Markdown
   */
  class MarkdownService {
    #origin;
    #codeBlocks = [];

    constructor() {
      this.#origin = window.location.origin;
    }

    async fetchAndConvert(topicId, postNumber) {
      const url = `${this.#origin}/raw/${topicId}/${postNumber}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      return this.#processText(raw);
    }

    #processText(text) {
      const processors = Config.getProcessors(this.#origin, this);

      let content = this.#maskCode(text);

      for (const p of processors) {
        if (p.regex?.global) p.regex.lastIndex = 0;
        content = content.replace(p.regex, p.replacement);
      }

      content = this.#unmaskCode(content);

      return content
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    /**
     * 代码块占位: 支持 ``` ``` 与 `inline`
     */
    #maskCode(text) {
      this.#codeBlocks = [];

      const patterns = [
        /```[\s\S]*?```/g,  // fenced code
        /`[^`\n]*`/g         // inline code
      ];

      return patterns.reduce((out, pattern) =>
        out.replace(pattern, m => {
          const idx = this.#codeBlocks.push(m) - 1;
          return `§§CODE_BLOCK_${idx}§§`;
        }), text);
    }

    #unmaskCode(text) {
      return text.replace(/§§CODE_BLOCK_(\d+)§§/g, (_, index) =>
        this.#codeBlocks[Number(index)] || ''
      );
    }
  }

  /**
   * [Layer 3] UI: 按钮注入与交互
   */
  class UIController {
    #service;

    constructor() {
      this.#service = new MarkdownService();
    }

    injectButton(postElement) {
      const actionsContainer = postElement.querySelector(
        Config.SELECTORS.ACTION_CONTAINER
      );
      if (!actionsContainer || actionsContainer.querySelector('.discourse-md-copy-btn')) return false;

      const { topicId, postNumber } = this.#getPostMeta(postElement);
      if (!topicId || !postNumber) return false;

      const existingBtn = actionsContainer.querySelector(Config.SELECTORS.EXISTING_BTN);
      const btn = document.createElement('button');

      btn.className = existingBtn
        ? `${existingBtn.className} discourse-md-copy-btn`
        : Config.UI.button.class;
      btn.title = Config.UI.messages.title;

      btn.innerHTML = `
<svg class="fa d-icon d-icon-copy svg-icon svg-string" xmlns="http://www.w3.org/2000/svg">
  <use href="${Config.UI.button.icons.copy}"></use>
</svg>`.trim();

      btn.addEventListener('click', (e) =>
        this.#handleClick(e, btn, topicId, postNumber)
      );

      actionsContainer.prepend(btn);
      return true;
    }

    #getPostMeta(postElement) {
      const article = postElement.matches('article')
        ? postElement
        : postElement.querySelector('article.topic-post, article[data-topic-id]');

      const topicId = article?.dataset.topicId ||
                      postElement.dataset.topicId ||
                      window.location.pathname.match(/\/t\/[^/]+\/(\d+)/)?.[1];

      const postNumber = article?.dataset.postNumber ||
                         postElement.dataset.postNumber ||
                         postElement.id?.split('_').pop();

      return { topicId, postNumber };
    }

    async #handleClick(e, btn, topicId, postNumber) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;

      const useEl = btn.querySelector('use');
      const originalHref = useEl?.getAttribute('href') || Config.UI.button.icons.copy;

      // UI: loading 状态
      Object.assign(btn.style, {
        opacity: '0.7',
        cursor: 'wait'
      });
      btn.disabled = true;

      try {
        const markdown = await this.#service.fetchAndConvert(topicId, postNumber);
        GM_setClipboard(markdown, 'text/plain');

        useEl?.setAttribute('href', Config.UI.button.icons.check);
        btn.title = Config.UI.messages.success;
        btn.classList.add('btn-primary');
      } catch (err) {
        console.error('[Raw→Markdown]', err);
        btn.title = Config.UI.messages.error + (err?.message || String(err));
        btn.style.backgroundColor = '#ffe6e6';
        useEl?.setAttribute('href', originalHref);
      } finally {
        setTimeout(() => {
          useEl?.setAttribute('href', originalHref);
          Object.assign(btn, {
            title: Config.UI.messages.title,
            disabled: false
          });
          Object.assign(btn.style, {
            opacity: '',
            cursor: '',
            backgroundColor: ''
          });
          btn.classList.remove('btn-primary');
        }, Config.UI.button.delay);
      }
    }
  }

  /**
   * [Layer 4] App: 启动与 DOM 观察
   */
  class App {
    #ui;
    #observer;

    constructor() {
      this.#ui = new UIController();
    }

    init() {
      if (!this.#isDiscourse()) return;

      console.info('[Raw→Markdown] Discourse detected, service active.');

      this.#scan(document);
      this.#startObserver();
    }

    #startObserver() {
      this.#observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (!m.addedNodes || m.addedNodes.length === 0) continue;

          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement || node instanceof DocumentFragment) {
              this.#scan(node);
            }
          }
        }
      });

      this.#observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    #isDiscourse() {
      return Config.SELECTORS.ROOT_CHECK.some((sel) =>
        document.querySelector(sel)
      );
    }

    #scan(root = document) {
      const posts = new Set();

      const tryAddPost = (el) => {
        if (el?.matches?.(Config.SELECTORS.POST_CONTAINER)) posts.add(el);
      };

      if (root instanceof HTMLElement) {
        tryAddPost(root);
        tryAddPost(root.closest?.(Config.SELECTORS.POST_CONTAINER));
      }

      root.querySelectorAll?.(Config.SELECTORS.POST_CONTAINER)
        ?.forEach((p) => posts.add(p));

      for (const post of posts) {
        const actions = post.querySelector(Config.SELECTORS.ACTION_CONTAINER);
        if (!actions) continue;
        if (actions.querySelector('.discourse-md-copy-btn')) continue;

        this.#ui.injectButton(post);
      }
    }
  }

  new App().init();
})();
