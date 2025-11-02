// ==UserScript==
// @name         !.Discourse HTML → Markdown Copier
// @description  通用Discourse论坛HTML转Markdown复制工具，自动适配任何Discourse站点
// @version      0.0.2
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        */t/topic/*
// @match        */t/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-HTML-Markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-HTML-Markdown.user.js
// ==/UserScript==

(function () {
  'use strict';

  class HtmlToMarkdownConverter {
    #codeBlocks = [];
    #siteOrigin;

    constructor(siteOrigin) {
      this.#siteOrigin = siteOrigin;
    }

    #processors = [
      // 预处理：移除脚本和样式，防止干扰转换。
      {
        name: 'Pre-process: Strip scripts and styles',
        process: (html) => {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          ['script', 'style', 'iframe'].forEach(tag => {
            const elements = tempDiv.getElementsByTagName(tag);
            for (let i = elements.length - 1; i >= 0; i--) elements[i].remove();
          });
          return tempDiv.innerHTML;
        }
      },
      // 块级元素：标题 (h1-h6)
      {
        name: 'Block: Headings',
        process: (text) => text.replace(/<h([1-6]).*?>(.*?)<\/h\1>/gi, (_, level, content) => {
          const cleanContent = content.replace(/<a[^>]*class="anchor"[^>]*>.*?<\/a>/gi, '')
                                      .replace(/<[^>]*>/g, '').trim();
          return `\n${'#'.repeat(parseInt(level))} ${cleanContent}\n`;
        })
      },
      // 块级元素：Discourse 特有的 aside 引用
      {
        name: 'Discourse: Aside Quotes',
        process: (text) => text.replace(/<aside class="quote no-group"[^>]*data-username="([^"]+)">[\s\S]*?<blockquote>([\s\S]*?)<\/blockquote>[\s\S]*?<\/aside>/gi, (_, username, quoteContent) => {
            const cleanContent = this.convert(quoteContent);
            const quotedLines = cleanContent.split('\n').map(line => `> ${line}`).join('\n');
            return `\n> **@${username}**:\n${quotedLines}\n`;
        })
      },
      // 块级元素：标准引用
      {
        name: 'Block: Blockquotes',
        process: (text) => text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
          const cleanContent = this.convert(content);
          const lines = cleanContent.trim().split('\n');
          return '\n' + lines.map(line => '> ' + line).join('\n') + '\n';
        })
      },
      // 块级元素：列表 (ul, ol)
      {
        name: 'Block: Lists',
        process: (text) => text.replace(/<(u|o)l[^>]*>([\s\S]*?)<\/\1l>/gi, (match, type, content) => {
          const listItems = Array.from(content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
          return listItems.map((li, index) => {
            const prefix = type === 'ol' ? `${index + 1}. ` : '- ';
            return prefix + this.convert(li[1]).trim();
          }).join('\n') + '\n';
        })
      },
      // 块级元素：分割线
      {
        name: 'Block: Horizontal Rule',
        process: (text) => text.replace(/<hr\s*\/?>/gi, '\n---\n')
      },
      // 块级元素：段落
      {
        name: 'Block: Paragraphs',
        process: (text) => text.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
      },
      // Discourse 特殊元素：折叠内容
      {
        name: 'Discourse: Details/Spoiler',
        process: (text) => text.replace(/<details[^>]*>([\s\S]*?)<\/details>/gi, (_, content) => {
          const summaryMatch = content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
          const summary = summaryMatch ? this.convert(summaryMatch[1]).trim() : '详情';
          const detailsContent = content.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '');
          const cleanDetails = this.convert(detailsContent);
          return `\n<details>\n<summary>${summary}</summary>\n\n${cleanDetails.trim()}\n\n</details>\n`;
        })
      },
      // Discourse 特殊元素：投票
      {
        name: 'Discourse: Polls',
        process: (text) => text.replace(/<div class="poll"[^>]*>([\s\S]*?)<\/div>/gi, (_, content) => {
            const titleMatch = content.match(/<div class="poll-title"[^>]*>([\s\S]*?)<\/div>/i);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
            const options = content.match(/<li[^>]*class="option"[^>]*>([\s\S]*?)<\/li>/gi) || [];
            let markdown = `\n**📊 投票: ${title}**\n\n`;
            options.forEach(option => {
                const optionText = option.replace(/<[^>]+>/g, '').trim();
                if (optionText) markdown += `- [ ] ${optionText}\n`;
            });
            return markdown + '\n';
        })
      },
      // 媒体：图片
      {
        name: 'Media: Images',
        process: (text) => text.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (match, src) => {
          const alt = match.match(/alt="([^"]*)"/i)?.[1] || '';
          const fullSrc = src.startsWith('http') || src.startsWith('data:') ? src : `${this.#siteOrigin}${src}`;
          return `![${alt}](${fullSrc})`;
        })
      },
      // 媒体：链接
      {
        name: 'Media: Links',
        process: (text) => text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (match, href, linkText) => {
          const cleanText = this.convert(linkText).trim();
          if (!cleanText || cleanText === href) return href;
          if (href.includes('/u/')) return `[@${cleanText.replace('@', '')}](${href})`;
          if (href.includes('/tag/')) return `[#${cleanText.replace('#', '')}](${href})`;
          return `[${cleanText}](${href})`;
        })
      },
      // 内联元素
      { name: 'Inline: Bold', process: (text) => text.replace(/<(strong|b)>(.*?)<\/\1>/gi, '**$2**') },
      { name: 'Inline: Italic', process: (text) => text.replace(/<(em|i)>(.*?)<\/\1>/gi, '*$2*') },
      { name: 'Inline: Strikethrough', process: (text) => text.replace(/<(del|s)>(.*?)<\/\1>/gi, '~~$2~~') },
      { name: 'Inline: Code', process: (text) => text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`') },
      { name: 'Inline: Break', process: (text) => text.replace(/<br\s*\/?>/gi, '\n') },
      // 清理
      {
        name: 'Cleanup: Decode HTML entities',
        process: (text) => text.replace(/&nbsp;/g, ' ').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/"/g, '"').replace(/'/g, "'")
      },
      {
        name: 'Cleanup: Normalize whitespace',
        process: (text) => text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim()
      },
      {
        name: 'Cleanup: Strip remaining tags',
        process: (text) => text.replace(/<[^>]+>/g, '')
      }
    ];

    #extractCodeBlocks(html) {
      return html.replace(/<pre><code.*?>([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
        const langMatch = match.match(/class=".*?language-(\w+).*?"/i);
        const lang = langMatch ? langMatch[1] : '';
        const decoder = this.#processors.find(p => p.name === 'Cleanup: Decode HTML entities');
        const decodedCode = decoder ? decoder.process(code) : code;
        this.#codeBlocks.push({ code: decodedCode.trim(), lang });
        return `§CODE§${this.#codeBlocks.length - 1}§`;
      });
    }

    #restoreCodeBlocks(text) {
      return text.replace(/§CODE§(\d+)§/g, (_, index) => {
        const block = this.#codeBlocks[index];
        return `\n\`\`\`${block.lang || ''}\n${block.code}\n\`\`\`\n`;
      });
    }

    convert(html) {
      this.#codeBlocks = [];
      let processedHtml = this.#extractCodeBlocks(html);

      for (const processor of this.#processors) {
        processedHtml = processor.process(processedHtml);
      }

      return this.#restoreCodeBlocks(processedHtml).replace(/\n{3,}/g, '\n\n').trim();
    }
  }

  class DiscourseHtmlMarkdown {
    #siteInfo;
    #config;
    #converter;
    #addedButtons = new Set();

    constructor() {
      this.#siteInfo = {
        origin: window.location.origin,
        hostname: window.location.hostname,
      };
      this.#config = {
        selectors: {
          title: '#topic-title > div > h1 > a.fancy-title > span, .fancy-title > span, h1 a span',
          postContent: '.cooked',
          postContainer: 'article[data-post-id]',
        },
      };
      this.#converter = new HtmlToMarkdownConverter(this.#siteInfo.origin);
    }

    #isDiscourse() {
      return (
        document.querySelector('meta[name="generator"]')?.content?.includes('Discourse') ||
        document.querySelector('.discourse-root') ||
        document.querySelector('#discourse-modal') ||
        document.body.classList.contains('discourse')
      );
    }

    #addCopyButtons() {
      document.querySelectorAll(this.#config.selectors.postContent).forEach(cookedEl => {
        const postElement = cookedEl.closest(this.#config.selectors.postContainer);
        if (!postElement) return;

        const postId = postElement.getAttribute('data-post-id');
        if (postId && !this.#addedButtons.has(postId)) {
          const isFirstPost = postId === '1' || postElement.id === 'post_1';
          this.#createCopyButton(cookedEl, postElement, isFirstPost);
          this.#addedButtons.add(postId);
        }
      });
    }

    #createCopyButton(cookedElement, postElement, isFirstPost) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'universal-html-copy-btn';
      copyBtn.innerHTML = '📋 HTML→MD';
      copyBtn.title = isFirstPost
        ? `复制话题为标准Markdown（${this.#siteInfo.hostname} HTML转换）`
        : `复制回复为标准Markdown（${this.#siteInfo.hostname} HTML转换）`;
      copyBtn.style.cssText = `
        position: absolute; top: 10px; right: 50px; background: #17a2b8; color: white;
        border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;
        font-size: 12px; z-index: 1000; transition: all 0.2s ease;
      `;

      copyBtn.addEventListener('mouseenter', () => {
        copyBtn.style.background = '#138496';
        copyBtn.style.transform = 'translateY(-1px)';
      });
      copyBtn.addEventListener('mouseleave', () => {
        copyBtn.style.background = '#17a2b8';
        copyBtn.style.transform = 'translateY(0)';
      });
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#copyPostAsMarkdown(postElement, isFirstPost, copyBtn);
      });

      cookedElement.style.position = 'relative';
      cookedElement.appendChild(copyBtn);
    }

    async #copyPostAsMarkdown(postElement, isFirstPost, button) {
      try {
        const contentEl = postElement.querySelector(this.#config.selectors.postContent);
        const clonedEl = contentEl.cloneNode(true);
        clonedEl.querySelector('.universal-html-copy-btn')?.remove();
        const content = clonedEl.innerHTML;

        if (!content) throw new Error('无法获取帖子内容');

        let markdown;
        if (isFirstPost) {
          const titleEl = document.querySelector(this.#config.selectors.title);
          const title = titleEl?.textContent?.trim() ?? 'Untitled';
          markdown = `# ${title}\n\n${this.#converter.convert(content)}`;
        } else {
          markdown = this.#converter.convert(content);
        }

        await navigator.clipboard.writeText(markdown);
        button.innerHTML = '✅ 已复制';
        button.style.background = '#28a745';
        setTimeout(() => {
          button.innerHTML = '📋 HTML→MD';
          button.style.background = '#17a2b8';
        }, 2000);
      } catch (error) {
        console.error('转换或复制失败:', error);
        alert(`操作失败: ${error.message}`);
      }
    }

    #observePageChanges() {
      const observer = new MutationObserver(() => this.#addCopyButtons());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    init() {
      if (!this.#isDiscourse()) {
        console.log('通用Discourse HTML转换器: 当前站点不是Discourse论坛');
        return;
      }
      console.log(`通用Discourse HTML转换器: 已在 ${this.#siteInfo.hostname} 上激活`);

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.#addCopyButtons();
        this.#observePageChanges();
      }
    }
  }

  new DiscourseHtmlMarkdown().init();

})();