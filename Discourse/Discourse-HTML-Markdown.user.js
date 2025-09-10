// ==UserScript==
// @name         !.Discourse HTML → Markdown Copier
// @description  通用Discourse论坛HTML转Markdown复制工具，自动适配任何Discourse站点
// @version      0.0.1
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

  // 自动检测当前站点信息
  const SITE_INFO = {
    origin: window.location.origin,
    hostname: window.location.hostname,
    isDiscourse: () => {
      // 检测是否为Discourse论坛
      return (
        document.querySelector('meta[name="generator"]')?.content?.includes('Discourse') ||
        document.querySelector('.discourse-root') ||
        document.querySelector('#discourse-modal') ||
        document.body.classList.contains('discourse')
      );
    },
  };

  // 如果不是Discourse论坛，不执行脚本
  if (!SITE_INFO.isDiscourse()) {
    console.log('通用Discourse HTML转换器: 当前站点不是Discourse论坛');
    return;
  }

  console.log(`通用Discourse HTML转换器: 已在 ${SITE_INFO.hostname} 上激活`);

  // 配置常量
  const CONFIG = {
    selectors: {
      title: '#topic-title > div > h1 > a.fancy-title > span, .fancy-title > span, h1 a span',
      postContent: '.cooked',
      postContainer: 'article[data-post-id]',
    },
    chunkSize: 100000,
  };

  // 工具函数
  const Utils = {
    decodeHtml: text =>
      text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    log: (msg, level = 'info') => level === 'error' && console.error(`[通用HTML转MD] ${msg}`),
    checkCompat: () => 'clipboard' in navigator,
  };

  // 转换规则
  const RULES = [
    // 基础HTML元素
    { pattern: /<br\s*\/?>/gi, replacement: '\n' },
    { pattern: /<hr\s*\/?>/gi, replacement: '\n---\n' },
    { pattern: /<p[^>]*>(.*?)<\/p>/gi, replacement: '$1\n\n' },
    { pattern: /<(strong|b)>(.*?)<\/\1>/gi, replacement: '**$2**' },
    { pattern: /<(em|i)>(.*?)<\/\1>/gi, replacement: '*$2*' },
    { pattern: /<(del|s)>(.*?)<\/\1>/gi, replacement: '~~$2~~' },
    { pattern: /<code[^>]*>(.*?)<\/code>/gi, replacement: '`$1`' },
    { pattern: /<mark>(.*?)<\/mark>/gi, replacement: '===$1===' },
    { pattern: /<sup class="footnote"[^>]*>(.*?)<\/sup>/gi, replacement: '[^$1]' },
    // Discourse特殊元素
    { pattern: /<span class="math">\\\((.*?)\\\)<\/span>/gi, replacement: '$$$1$$' },
    { pattern: /<div class="math">\\\[(.*?)\\\]<\/div>/gi, replacement: '\n$$$$\n$1\n$$$$\n' },
    { pattern: /<ul[^>]*>([\s\S]*?)<\/ul>/gi, replacement: '$1\n' },
    { pattern: /<ol[^>]*>([\s\S]*?)<\/ol>/gi, replacement: '$1\n' },
    { pattern: /<li[^>]*>(.*?)<\/li>/gi, replacement: '- $1\n' },
    { pattern: /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, replacement: '\n> $1\n' },
  ];

  // 处理器函数
  const Processors = {
    // 处理用户提及 - 通用版本
    mentions: text =>
      text
        .replace(/<span[^>]*mention[^>]*>(@?[^<]+)<\/span>/gi, (_, mention) => {
          const cleanMention = mention.replace(/<[^>]*>/g, '').trim();
          const username = cleanMention.replace(/^@/, '');
          return `[@${username}](${SITE_INFO.origin}/u/${username})`;
        })
        // 处理用户链接 - 动态匹配当前站点
        .replace(
          new RegExp(`<a[^>]*href="[^"]*\\/u\\/([^\\/\"]+)"[^>]*>@?([^<]+)<\\/a>`, 'gi'),
          `[@$1](${SITE_INFO.origin}/u/$1)`
        ),

    // 处理标签 - 通用版本
    hashtags: text =>
      text
        .replace(/<span[^>]*(?:hashtag|discourse-tag)[^>]*>(?:#?)([^<]+)<\/span>/gi, (_, tag) => {
          const cleanTag = tag.replace(/<[^>]*>/g, '').trim();
          return `[#${cleanTag}](${SITE_INFO.origin}/tag/${cleanTag})`;
        })
        // 处理标签链接 - 动态匹配当前站点
        .replace(
          new RegExp(`<a[^>]*href="[^"]*\\/tag\\/([^\\/\"]+)"[^>]*>(?:#?)([^<]+)<\\/a>`, 'gi'),
          `[#$1](${SITE_INFO.origin}/tag/$1)`
        ),

    // 处理链接 - 通用版本
    links: text =>
      text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (match, href, linkText) => {
        // 处理用户链接（已在mentions中处理）
        if (href.includes('/u/')) {
          return match;
        }

        // 处理标签链接（已在hashtags中处理）
        if (href.includes('/tag/')) {
          return match;
        }

        // 处理话题链接 - 动态匹配当前站点
        if (href.includes('/t/')) {
          const topicMatch = href.match(/\/t\/([^\/]+)\/(\d+)/);
          if (topicMatch) {
            const [, slug] = topicMatch;
            const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            return `[${title}](${href})`;
          }
        }

        // 处理其他链接
        const cleanText = linkText.replace(/<[^>]*>/g, '').trim();
        const title = match.match(/title="([^"]*)"/i);
        if (title) {
          return `[${cleanText}](${href} "${title[1]}")`;
        }
        return `[${cleanText}](${href})`;
      }),

    // 处理图片
    images: text =>
      text.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (match, src) => {
        const altMatch = match.match(/alt="([^"]*)"/i);
        const titleMatch = match.match(/title="([^"]*)"/i);
        const alt = altMatch ? altMatch[1] : titleMatch ? titleMatch[1] : '';

        // 处理相对路径
        const fullSrc = src.startsWith('http') ? src : `${SITE_INFO.origin}${src}`;
        return `![${alt}](${fullSrc})`;
      }),

    // 处理内联格式
    inline: text =>
      text
        .replace(/<kbd>(.*?)<\/kbd>/gi, '`$1`')
        .replace(/<sub>(.*?)<\/sub>/gi, '~$1~')
        .replace(/<sup>(.*?)<\/sup>/gi, '^$1^')
        .replace(/<mark>(.*?)<\/mark>/gi, '==$1==')
        .replace(/<del>(.*?)<\/del>/gi, '~~$1~~')
        .replace(/<ins>(.*?)<\/ins>/gi, '++$1++'),

    // 处理标题
    headings: text =>
      text.replace(/<h([1-6]).*?>(.*?)<\/h\1>/gi, (_, level, content) => {
        // 移除锚点链接
        content = content.replace(/<a[^>]*class="anchor"[^>]*>.*?<\/a>/gi, '');
        // 处理标题内的链接
        content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
        // 清理其他HTML标签
        content = content.replace(/<[^>]*>/g, '');
        // 规范化空白字符
        content = content
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return `\n${'#'.repeat(parseInt(level))} ${content}\n`;
      }),

    // 处理特殊元素
    special: text => {
      // 处理引用块
      text = text.replace(
        /<aside class="quote[^>]*>[\s\S]*?<div class="title">([^<]*)<\/div>[\s\S]*?<blockquote>([\s\S]*?)<\/blockquote>[\s\S]*?<\/aside>/gi,
        (_, author, content) => {
          const cleanAuthor = author
            .replace(/<[^>]*>/g, '')
            .replace(/@([^\s]+)/, '@$1')
            .replace(/\s+/g, ' ')
            .trim();

          const cleanContent = content
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const quotedLines = cleanContent
            .split('\n')
            .map(line => `> ${line.trim()}`)
            .filter(line => line.length > 2)
            .join('\n');

          return `\n> **${cleanAuthor}:**\n${quotedLines}\n`;
        }
      );

      // 处理投票
      text = text.replace(/<div class="poll"[^>]*>([\s\S]*?)<\/div>/gi, (_, content) => {
        const title = content.match(/<div class="poll-title"[^>]*>([\s\S]*?)<\/div>/i);
        const options = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);

        let markdown = '\n**📊 投票：';
        if (title) {
          const cleanTitle = title[1].replace(/<[^>]*>/g, '').trim();
          markdown += `${cleanTitle}**\n\n`;
        } else {
          markdown += '**\n\n';
        }

        if (options) {
          options.forEach(option => {
            const optionText = option
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .trim();
            if (optionText) {
              markdown += `- [ ] ${optionText}\n`;
            }
          });
        }
        return markdown + '\n';
      });

      // 处理折叠内容
      text = text.replace(/<details[^>]*>([\s\S]*?)<\/details>/gi, (_, content) => {
        const summary = content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
        const details = content.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '');

        const summaryText = summary ? summary[1].replace(/<[^>]*>/g, '').trim() : '详情';
        const detailsText = details
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim();

        return `\n<details>\n<summary>${summaryText}</summary>\n\n${detailsText}\n\n</details>\n`;
      });

      // 处理话题链接 - 动态匹配当前站点
      const topicLinkRegex = new RegExp(
        `${SITE_INFO.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/t\\/([^\\/\\s]+)\\/(\\d+)(?:\\/(\\d+))?`,
        'g'
      );
      text = text.replace(topicLinkRegex, (match, slug) => {
        const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        return `[${title}](${match})`;
      });

      return text;
    },
  };

  // 格式化函数
  const formatMarkdown = text =>
    text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\[\s*([^\]]+)\s*\]\(\s*([^)]+)\s*\)/g, '[$1]($2)')
      .replace(/\*\*\s+([^*]+)\s+\*\*/g, '**$1**')
      .replace(/\*\s+([^*]+)\s+\*/g, '*$1*')
      .replace(/_\s+([^_]+)\s+_/g, '_$1_')
      .replace(/`\s+([^`]+)\s+`/g, '`$1`')
      .replace(/~~\s+([^~]+)\s+~~/g, '~~$1~~')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '\n')
      .replace(/^(\s*)-\s+/gm, '$1- ')
      .replace(/^(\s*)\*\s+/gm, '$1- ')
      .replace(/^(\s*)\d+\.\s+/gm, '$1$&')
      .replace(/^>\s*/gm, '> ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

  // 转换器类
  class UniversalDiscourseConverter {
    constructor() {
      this.codeBlocks = [];
      this.metadata = {};
    }

    convert(html) {
      try {
        this.extractMetadata(html);
        html = this.preprocessHtml(html);
        html = this.extractCodeBlocks(html);
        let text = this.processContent(html);

        if (Object.keys(this.metadata).length > 0) {
          const frontMatter = ['---'];
          ['author', 'date', 'source_url'].forEach(key => {
            if (this.metadata[key]) frontMatter.push(`${key}: ${this.metadata[key]}`);
          });
          frontMatter.push('---\n');
          text = frontMatter.join('\n') + text;
        }

        return this.cleanup(text);
      } catch (error) {
        console.error('转换失败:', error);
        return html.replace(/<[^>]+>/g, '').trim();
      }
    }

    convertContentOnly(html) {
      try {
        this.codeBlocks = [];
        this.metadata = {};
        html = this.preprocessHtml(html);
        html = this.extractCodeBlocks(html);
        return this.cleanup(this.processContent(html));
      } catch (error) {
        console.error('转换失败:', error);
        return html.replace(/<[^>]+>/g, '').trim();
      }
    }

    extractMetadata(html) {
      const authorMatch = html.match(/<div[^>]*class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (authorMatch) this.metadata.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
      const dateMatch = html.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
      if (dateMatch) this.metadata.date = dateMatch[1];
      this.metadata.source_url = window.location.href;
      return html;
    }

    preprocessHtml(html) {
      return html.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ');
    }

    processContent(html) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      ['script', 'style', 'iframe'].forEach(tag => {
        const elements = tempDiv.getElementsByTagName(tag);
        for (let i = elements.length - 1; i >= 0; i--) elements[i].remove();
      });
      let text = tempDiv.innerHTML;

      RULES.forEach(rule => (text = text.replace(rule.pattern, rule.replacement)));
      Object.values(Processors).forEach(processor => {
        if (typeof processor === 'function') text = processor(text);
      });

      return formatMarkdown(text);
    }

    cleanup(text) {
      return Utils.decodeHtml(text)
        .replace(/§CODE§(\d+)§/g, (_, index) => {
          const block = this.codeBlocks[index];
          return `\n\`\`\`${block.lang || ''}\n${block.code}\n\`\`\`\n`;
        })
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    extractCodeBlocks(html) {
      return html.replace(/<pre><code.*?>([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
        const langMatch = match.match(/class=".*?language-(\w+).*?"/i);
        const lang = langMatch ? langMatch[1] : '';
        const processedCode = Utils.decodeHtml(code).trim();
        this.codeBlocks.push({ code: processedCode, lang });
        return `§CODE§${this.codeBlocks.length - 1}§`;
      });
    }
  }

  // 复制管理器
  class UniversalMarkdownCopyManager {
    constructor() {
      this.converter = new UniversalDiscourseConverter();
      this.addedButtons = new Set();
      this.init();
    }

    init() {
      this.addCopyButtons();
      this.observePageChanges();
    }

    addCopyButtons() {
      document.querySelectorAll(CONFIG.selectors.postContent).forEach(cookedEl => {
        if (cookedEl.querySelector('.universal-html-copy-btn')) return;

        const postElement = cookedEl.closest(CONFIG.selectors.postContainer);
        if (!postElement) return;

        const postId = postElement.getAttribute('data-post-id') || (postElement.id === 'post_1' ? '1' : null);
        if (postId && !this.addedButtons.has(postId)) {
          const isFirstPost = postId === '1' || postElement.id === 'post_1';
          this.addCopyButtonToCooked(cookedEl, postElement, isFirstPost);
          this.addedButtons.add(postId);
        }
      });
    }

    addCopyButtonToCooked(cookedElement, postElement, isFirstPost) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'universal-html-copy-btn';
      copyBtn.innerHTML = '📋 HTML→MD';
      copyBtn.title = isFirstPost
        ? `复制话题为标准Markdown（${SITE_INFO.hostname} HTML转换）`
        : `复制回复为标准Markdown（${SITE_INFO.hostname} HTML转换）`;
      copyBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 50px;
        background: #17a2b8;
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        z-index: 1000;
        transition: all 0.2s ease;
      `;

      copyBtn.addEventListener('mouseenter', () => {
        copyBtn.style.background = '#138496';
        copyBtn.style.transform = 'translateY(-1px)';
      });

      copyBtn.addEventListener('mouseleave', () => {
        copyBtn.style.background = '#17a2b8';
        copyBtn.style.transform = 'translateY(0)';
      });

      copyBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.copyPostAsMarkdown(postElement, isFirstPost, copyBtn);
      });

      cookedElement.style.position = 'relative';
      cookedElement.appendChild(copyBtn);
    }

    copyPostAsMarkdown(postElement, isFirstPost, button) {
      try {
        const contentEl = postElement.querySelector(CONFIG.selectors.postContent);
        const content = this.getContentWithoutButton(contentEl);
        if (!content) throw new Error('无法获取帖子内容');

        let markdown;
        if (isFirstPost) {
          const titleEl = document.querySelector(CONFIG.selectors.title);
          const title = titleEl?.textContent?.trim() ?? 'Untitled';
          markdown = `# ${title}\n\n${this.converter.convert(content)}`;
        } else {
          markdown = this.converter.convertContentOnly(content);
        }

        navigator.clipboard
          .writeText(markdown)
          .then(() => {
            button.innerHTML = '✅ 已复制';
            button.style.background = '#28a745';
            setTimeout(() => {
              button.innerHTML = '📋 HTML→MD';
              button.style.background = '#17a2b8';
            }, 2000);
          })
          .catch(err => {
            console.error('复制失败:', err);
            alert('复制失败，请检查浏览器权限设置');
          });
      } catch (error) {
        console.error('转换失败:', error);
        alert(`转换失败: ${error.message}`);
      }
    }

    getContentWithoutButton(contentEl) {
      if (!contentEl) return '';
      const clonedEl = contentEl.cloneNode(true);
      clonedEl.querySelectorAll('.universal-html-copy-btn').forEach(btn => btn.remove());
      return clonedEl.innerHTML;
    }

    observePageChanges() {
      const observer = new MutationObserver(mutations => {
        let shouldUpdate = false;
        mutations.forEach(mutation => {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => {
              if (
                node.nodeType === Node.ELEMENT_NODE &&
                node.matches &&
                (node.matches(CONFIG.selectors.postContent) ||
                  node.querySelector(CONFIG.selectors.postContent) ||
                  node.matches(CONFIG.selectors.postContainer) ||
                  node.querySelector(CONFIG.selectors.postContainer))
              ) {
                shouldUpdate = true;
              }
            });
          }
        });
        if (shouldUpdate) {
          setTimeout(() => this.addCopyButtons(), 100);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  // 启动管理器
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new UniversalMarkdownCopyManager());
  } else {
    new UniversalMarkdownCopyManager();
  }

  console.log(`通用Discourse HTML转换器: 已在 ${SITE_INFO.hostname} 上成功初始化`);
})();
