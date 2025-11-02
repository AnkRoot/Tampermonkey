// ==UserScript==
// @name         !.Discourse Raw → Markdown Copier
// @description  通用Discourse论坛Raw API Markdown复制工具
// @version      2.2.0
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        */t/topic/*
// @match        */t/*
// @grant        GM_setClipboard
// @run-at       document-end
// @require      https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.user.js
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
// ==/UserScript==

(function () {
  'use strict';

  class DiscourseRawMarkdown {
    #siteInfo;

    constructor() {
      this.#siteInfo = {
        origin: window.location.origin,
        hostname: window.location.hostname,
      };
    }

    #isDiscourse() {
      return (
        document.querySelector('meta[name="generator"]')?.content?.includes('Discourse') ||
        document.querySelector('.discourse-root') ||
        document.querySelector('#discourse-modal') ||
        document.body.classList.contains('discourse')
      );
    }

    async #getPostRawContent(topicId, postNumber) {
      const url = `${this.#siteInfo.origin}/raw/${topicId}/${postNumber}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rawContent = await response.text();
        return this.#convertToStandardMarkdown(rawContent);
      } catch (error) {
        throw new Error(`获取Raw内容失败: ${error.message}`);
      }
    }

    #convertToStandardMarkdown(rawContent) {
      let content = rawContent;
      const origin = this.#siteInfo.origin;

      const processors = [
        // 处理Discourse上传的图片，转换为完整的URL。
        {
          name: 'Images',
          regex: /!\[([^|\]]*?)\|?([^\]]*)\]\(upload:\/\/([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)\)/gi,
          replacement: (match, altText, dimensions, base62Sha1, format) => {
            const imgElement = document.querySelector(`img[data-base62-sha1="${base62Sha1}"]`);
            return imgElement?.src ? `![${altText.trim()}](${imgElement.src})` : match;
          }
        },
        // 处理引用块，转换为标准的Markdown引用。
        {
          name: 'Quotes',
          regex: /\[quote="([^"]*?)(?:,\s*post:\d+)?(?:,\s*topic:\d+)?"\]([\s\S]*?)\[\/quote\]/gi,
          replacement: (_, author, quoteContent) => {
            const cleanAuthor = author.trim();
            const quotedLines = quoteContent.trim().split('\n').map(line => `> ${line}`).join('\n');
            return `\n> **${cleanAuthor}:**\n${quotedLines}\n`;
          }
        },
        // 转换Discourse特有的列表项 `[*]` 为标准Markdown `*`。
        {
          name: 'List Items',
          regex: /\[\*\]\s*(.*?)\s*(?=\[\*\]|\[\/list\])/gi,
          replacement: '\n* $1'
        },
        // 移除列表容器 `[list]` 和 `[/list]` 标签。
        {
          name: 'Lists Wrapper',
          regex: /\[\/?list(=1)?\]\n?/gi,
          replacement: ''
        },
        // 处理文本对齐，转换为HTML div标签。
        {
          name: 'Alignment',
          regex: /\[align=(center|right|left|justify)\]([\s\S]*?)\[\/align\]/gi,
          replacement: '<div style="text-align: $1;">$2</div>'
        },
        // 处理投票，转换为可读的Markdown列表。
        {
          name: 'Polls',
          regex: /\[poll[^\]]*\]([\s\S]*?)\[\/poll\]/gi,
          replacement: (_, pollContent) => {
            const lines = pollContent.trim().split('\n').filter(line => line.trim().startsWith('*'));
            let markdown = '\n**📊 投票：**\n\n';
            lines.forEach(line => {
              const cleanLine = line.replace(/^\*\s*/, '').trim();
              if (cleanLine) markdown += `- [ ] ${cleanLine}\n`;
            });
            return markdown + '\n';
          }
        },
        // 统一处理 `[spoiler]` 和 `[details]` 为HTML的 `<details>` 标签。
        {
          name: 'Spoilers & Details',
          regex: /\[(spoiler|details)\]([\s\S]*?)\[\/\1\]/gi,
          replacement: (match, tag, content) => {
            const summary = tag === 'spoiler' ? '剧透' : '详情';
            return `\n<details>\n<summary>${summary}</summary>\n\n${content.trim()}\n\n</details>\n`;
          }
        },
        // 处理带自定义标题的 `[details]`。
        {
          name: 'Details with Summary',
          regex: /\[details="([^"]*)"\]([\s\S]*?)\[\/details\]/gi,
          replacement: (_, summary, detailContent) => {
            return `\n<details>\n<summary>${summary.trim()}</summary>\n\n${detailContent.trim()}\n\n</details>\n`;
          }
        },
        // --- 基础文本格式化 (BBCode to Markdown) ---
        { name: 'Bold', regex: /\[b\]([\s\S]*?)\[\/b\]/gi, replacement: '**$1**' },
        { name: 'Italic', regex: /\[i\]([\s\S]*?)\[\/i\]/gi, replacement: '*$1*' },
        { name: 'Underline', regex: /\[u\]([\s\S]*?)\[\/u\]/gi, replacement: '<u>$1</u>' },
        { name: 'Strikethrough', regex: /\[s\]([\s\S]*?)\[\/s\]/gi, replacement: '~~$1~~' },
        // 剥离不兼容的样式标签，如颜色、大小等。
        {
          name: 'Strip Unsupported Style Tags',
          regex: /\[\/?(color|size|font)[^\]]*\]/gi,
          replacement: ''
        },
        // --- 提及、链接和标签 ---
        // 处理用户提及，转换为指向用户个人资料页的链接。
        {
          name: 'Mentions',
          regex: /(?<=^|\s)@([a-zA-Z0-9_-]+)\b/g,
          replacement: (match, user) => match.replace(`@${user}`, `[@${user}](${origin}/u/${user})`)
        },
        // 处理内部话题链接，转换为带可读标题的Markdown链接。
        {
          name: 'Topic Links',
          regex: new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/t\\/([^\\/\\s]+)\\/(\\d+)(?:\\/(\\d+))?`, 'g'),
          replacement: (match, slug) => {
            const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            return `[${title}](${match})`;
          }
        },
        // 处理标签，转换为指向标签页的链接。
        {
          name: 'Tags',
          regex: /(?<=^|\s)#([a-zA-Z0-9-]+)\b/g,
          replacement: (match, tag) => match.replace(`#${tag}`, `[#${tag}](${origin}/tag/${tag})`)
        },
      ];

      for (const processor of processors) {
        content = content.replace(processor.regex, processor.replacement);
      }
      return content.replace(/\n\s*\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    #createCopyButton(postElement) {
      const article = postElement.querySelector('article[data-topic-id]');
      const topicId = article?.dataset.topicId || window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/)?.[1];
      const postNumber = postElement.dataset.postNumber;

      if (!topicId || !postNumber) return null;

      const button = elmGetter.create(`
        <button class="${document.querySelector('.post-action-menu__copy-link')?.className || 'btn no-text btn-icon btn-flat'} universal-copy-button"
                title="复制为标准Markdown（${this.#siteInfo.hostname} Raw API）">
          <svg class="fa d-icon d-icon-d-post-share svg-icon svg-string" xmlns="http://www.w3.org/2000/svg"><use href="#copy"></use></svg><span aria-hidden="true">&ZeroWidthSpace;</span>
        </button>
      `);

      button.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const originalIcon = button.querySelector('svg use');
        const originalHref = originalIcon.getAttribute('href');
        originalIcon.setAttribute('href', '#check');
        button.disabled = true;

        try {
          const rawContent = await this.#getPostRawContent(topicId, postNumber);
          const success = GM_setClipboard(rawContent, 'text/plain');
          button.title = success ? '已复制!' : '复制失败!';
        } catch (error) {
          console.error('[Discourse Raw Markdown]: 操作失败:', error);
          button.title = `获取失败: ${error.message}`;
        } finally {
          setTimeout(() => {
            originalIcon.setAttribute('href', originalHref);
            button.title = `复制为标准Markdown（${this.#siteInfo.hostname} Raw API）`;
            button.disabled = false;
          }, 1500);
        }
      });

      return button;
    }

    init() {
      if (!this.#isDiscourse()) {
        console.log('[Discourse Raw Markdown]: 当前站点不是Discourse论坛');
        return;
      }

      console.log(`[Discourse Raw Markdown]: 已在 ${this.#siteInfo.hostname} 上激活`);

      elmGetter.each('.topic-post .post-controls .actions', (actionsContainer) => {
        if (actionsContainer.querySelector('.universal-copy-button')) return;

        const postElement = actionsContainer.closest('.topic-post');
        if (!postElement) return;

        const button = this.#createCopyButton(postElement);
        if (button) {
          actionsContainer.prepend(button);
        }
      });
    }
  }

  new DiscourseRawMarkdown().init();

})();