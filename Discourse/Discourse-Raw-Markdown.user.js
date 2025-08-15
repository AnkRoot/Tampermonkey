// ==UserScript==
// @name         !.Discourse Raw Markdown
// @description  通用Discourse论坛Raw API Markdown复制工具，自动适配任何Discourse站点
// @version      0.0.1
// @author       ank
// @namespace    http://010314.xyz/
// @match        */t/topic/*
// @match        */t/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
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
    console.log('通用Discourse复制器: 当前站点不是Discourse论坛');
    return;
  }

  console.log(`通用Discourse复制器: 已在 ${SITE_INFO.hostname} 上激活`);

  // CSS样式
  const customCSS = `
    .universal-copy-button {
      display: inline-flex;
      align-items: center;
    }
    .universal-copy-button svg {
      width: 16px;
      height: 16px;
    }
    .universal-copy-button svg path {
      fill: #888;
      transition: fill 0.2s ease-in-out;
    }
    .universal-copy-button:hover svg path {
      fill: #007bff;
    }
  `;

  const styleSheet = document.createElement('style');
  styleSheet.innerText = customCSS;
  document.head.appendChild(styleSheet);

  // 图标定义
  const ICON_SVG = {
    COPY: `<svg class="d-icon d-icon-copy" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    CHECK: `<svg class="d-icon d-icon-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  };

  // 复制到剪贴板
  function reliableCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      document.body.removeChild(textArea);
      return false;
    }
  }

  // 获取Raw内容
  function getPostRawContent(topicId, postNumber) {
    const url = `${SITE_INFO.origin}/raw/${topicId}/${postNumber}`;
    return fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.text();
      })
      .then(rawContent => {
        return convertDiscourseToStandardMarkdown(rawContent);
      });
  }

  // 将Discourse特有语法转换为标准Markdown
  function convertDiscourseToStandardMarkdown(rawContent) {
    let content = rawContent;

    // 1. 处理引用块 [quote="author, post:1, topic:123"]...[/quote]
    content = content.replace(
      /\[quote="([^"]*?)(?:,\s*post:\d+)?(?:,\s*topic:\d+)?"\]([\s\S]*?)\[\/quote\]/gi,
      (_, author, quoteContent) => {
        const cleanAuthor = author.trim();
        const lines = quoteContent.trim().split('\n');
        const quotedLines = lines.map(line => `> ${line}`).join('\n');
        return `\n> **${cleanAuthor}:**\n${quotedLines}\n`;
      }
    );

    // 2. 处理投票 [poll]...[/poll]
    content = content.replace(/\[poll[^\]]*\]([\s\S]*?)\[\/poll\]/gi, (_, pollContent) => {
      const lines = pollContent
        .trim()
        .split('\n')
        .filter(line => line.trim());
      let markdown = '\n**📊 投票：**\n\n';
      lines.forEach(line => {
        const cleanLine = line.replace(/^\*\s*/, '').trim();
        if (cleanLine) {
          markdown += `- [ ] ${cleanLine}\n`;
        }
      });
      return markdown + '\n';
    });

    // 3. 处理折叠内容 [details="summary"]...[/details]
    content = content.replace(/\[details="([^"]*)"\]([\s\S]*?)\[\/details\]/gi, (_, summary, detailContent) => {
      return `\n<details>\n<summary>${summary}</summary>\n\n${detailContent.trim()}\n\n</details>\n`;
    });

    // 4. 处理简单折叠 [details]...[/details]
    content = content.replace(/\[details\]([\s\S]*?)\[\/details\]/gi, (_, detailContent) => {
      return `\n<details>\n<summary>详情</summary>\n\n${detailContent.trim()}\n\n</details>\n`;
    });

    // 5. 处理用户提及 @username -> [@username](链接) - 使用当前站点域名
    content = content.replace(/@(\w+)/g, (_, username) => {
      return `[@${username}](${SITE_INFO.origin}/u/${username})`;
    });

    // 6. 处理话题链接 - 动态匹配当前站点
    const topicLinkRegex = new RegExp(
      `${SITE_INFO.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/t\\/([^\\/\\s]+)\\/(\\d+)(?:\\/(\\d+))?`,
      'g'
    );
    content = content.replace(topicLinkRegex, (match, slug) => {
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `[${title}](${match})`;
    });

    // 7. 处理标签 #tag - 使用当前站点域名
    content = content.replace(/#(\w+)/g, (_, tag) => {
      return `[#${tag}](${SITE_INFO.origin}/tag/${tag})`;
    });

    // 8. 清理多余的空行
    content = content.replace(/\n{3,}/g, '\n\n');

    // 9. 清理开头和结尾的空行
    content = content.replace(/^\n+/, '').replace(/\n+$/, '\n');

    return content;
  }

  // 创建复制按钮
  function createCopyIcon(postElement) {
    const article = postElement.querySelector('article[data-topic-id]');
    const topicId = article?.dataset.topicId || window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/)?.[1];
    const postNumber = postElement.dataset.postNumber;

    if (!topicId || !postNumber) return null;

    const button = document.createElement('button');
    button.className = 'widget-button btn-flat no-text btn-icon universal-copy-button';
    button.title = `复制为标准Markdown（${SITE_INFO.hostname} Raw API）`;
    button.innerHTML = ICON_SVG.COPY;

    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();

      const originalIcon = button.innerHTML;
      button.innerHTML = ICON_SVG.CHECK;
      button.disabled = true;

      getPostRawContent(topicId, postNumber)
        .then(rawContent => {
          const success = reliableCopyToClipboard(rawContent);
          button.title = success ? '已复制!' : '复制失败!';
        })
        .catch(error => {
          console.error('通用Discourse复制器: 操作失败:', error);
          button.title = '获取失败!';
        })
        .finally(() => {
          setTimeout(() => {
            button.innerHTML = originalIcon;
            button.title = `复制为标准Markdown（${SITE_INFO.hostname} Raw API）`;
            button.disabled = false;
          }, 1500);
        });
    });

    return button;
  }

  // 添加按钮到帖子
  function addIconsToPosts() {
    const posts = document.querySelectorAll('.topic-post:not(.universal-copy-added)');
    posts.forEach(post => {
      post.classList.add('universal-copy-added');
      const actionsContainer = post.querySelector('.post-controls .actions');
      if (actionsContainer) {
        const icon = createCopyIcon(post);
        if (icon && !actionsContainer.querySelector('.universal-copy-button')) {
          actionsContainer.prepend(icon);
        }
      }
    });
  }

  // 初始化
  function init() {
    addIconsToPosts();
    const targetNode = document.getElementById('posts-stream');
    if (targetNode) {
      const observer = new MutationObserver(addIconsToPosts);
      observer.observe(targetNode, { childList: true, subtree: true });
    }
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log(`通用Discourse复制器: 已在 ${SITE_INFO.hostname} 上成功初始化`);
})();
