// ==UserScript==
// @name         通用Discourse Raw Markdown复制器
// @description  通用Discourse论坛Raw API Markdown复制工具，自动适配任何Discourse站点
// @version      1.0.0
// @author       ank
// @namespace    http://010314.xyz/
// @match        */t/topic/*
// @match        */t/*
// @grant        none
// @run-at       document-end
// @require      https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.user.js
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/Discourse-Raw-Markdown.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 检测Discourse站点
  const isDiscourse = () => {
    return (
      document.querySelector('meta[name="generator"]')?.content?.includes('Discourse') ||
      document.querySelector('.discourse-root') ||
      document.querySelector('#discourse-modal') ||
      document.body.classList.contains('discourse')
    );
  };

  if (!isDiscourse()) {
    console.log('[Discourse Raw Markdown]: 当前站点不是Discourse论坛');
    return;
  }

  const SITE_INFO = {
    origin: window.location.origin,
    hostname: window.location.hostname,
  };

  console.log(`[Discourse Raw Markdown]: 已在 ${SITE_INFO.hostname} 上激活`);

  // 复制到剪贴板
  const copyToClipboard = (text) => {
    const textArea = elmGetter.create(`<textarea style="position:fixed;top:-9999px;left:-9999px;">${text}</textarea>`, document.body);
    textArea.select();
    try {
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (err) {
      document.body.removeChild(textArea);
      return false;
    }
  };

  // 获取Raw内容并转换
  const getPostRawContent = async (topicId, postNumber) => {
    const url = `${SITE_INFO.origin}/raw/${topicId}/${postNumber}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rawContent = await response.text();
      return convertToStandardMarkdown(rawContent);
    } catch (error) {
      throw new Error(`获取Raw内容失败: ${error.message}`);
    }
  };

  // 将Discourse特有语法转换为标准Markdown
  const convertToStandardMarkdown = (rawContent) => {
    let content = rawContent;

    // 处理图片：将![alt_text|dimensions,scale%](upload://base62-sha1.格式)转换为![alt_text](img src)
    content = content.replace(
      /!\[([^\]]*?)\|([^\]]*?)\]\(upload:\/\/([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)\)/gi,
      (match, altText, dimensions, base62Sha1, format) => {
        // 从当前页面查找对应的img元素
        const imgElement = document.querySelector(`img[data-base62-sha1="${base62Sha1}"]`);
        if (imgElement && imgElement.src) {
          return `![${altText}](${imgElement.src})`;
        }
        // 如果找不到对应的img元素，返回原始格式
        return match;
      }
    );

    // 处理引用块
    content = content.replace(
      /\[quote="([^"]*?)(?:,\s*post:\d+)?(?:,\s*topic:\d+)?"\]([\s\S]*?)\[\/quote\]/gi,
      (_, author, quoteContent) => {
        const cleanAuthor = author.trim();
        const lines = quoteContent.trim().split('\n');
        const quotedLines = lines.map(line => `> ${line}`).join('\n');
        return `\n> **${cleanAuthor}:**\n${quotedLines}\n`;
      }
    );

    // 处理投票
    content = content.replace(/\[poll[^\]]*\]([\s\S]*?)\[\/poll\]/gi, (_, pollContent) => {
      const lines = pollContent.trim().split('\n').filter(line => line.trim());
      let markdown = '\n**📊 投票：**\n\n';
      lines.forEach(line => {
        const cleanLine = line.replace(/^\*\s*/, '').trim();
        if (cleanLine) markdown += `- [ ] ${cleanLine}\n`;
      });
      return markdown + '\n';
    });

    // 处理折叠内容
    content = content.replace(/\[details="([^"]*)"\]([\s\S]*?)\[\/details\]/gi, (_, summary, detailContent) => {
      return `\n<details>\n<summary>${summary}</summary>\n\n${detailContent.trim()}\n\n</details>\n`;
    });

    content = content.replace(/\[details\]([\s\S]*?)\[\/details\]/gi, (_, detailContent) => {
      return `\n<details>\n<summary>详情</summary>\n\n${detailContent.trim()}\n\n</details>\n`;
    });

    // 处理用户提及
    content = content.replace(/@(\w+)/g, (_, username) => {
      return `[@${username}](${SITE_INFO.origin}/u/${username})`;
    });

    // 处理话题链接
    const topicLinkRegex = new RegExp(
      `${SITE_INFO.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/t\\/([^\\/\\s]+)\\/(\\d+)(?:\\/(\\d+))?`,
      'g'
    );
    content = content.replace(topicLinkRegex, (match, slug) => {
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `[${title}](${match})`;
    });

    // 处理标签
    content = content.replace(/#(\w+)/g, (_, tag) => {
      return `[#${tag}](${SITE_INFO.origin}/tag/${tag})`;
    });

    // 清理多余空行
    content = content.replace(/\n{3,}/g, '\n\n');
    return content.replace(/^\n+/, '').replace(/\n+$/, '\n');
  };

  // 创建复制按钮
  const createCopyButton = (postElement) => {
    const article = postElement.querySelector('article[data-topic-id]');
    const topicId = article?.dataset.topicId || window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/)?.[1];
    const postNumber = postElement.dataset.postNumber;

    if (!topicId || !postNumber) return null;

    const button = elmGetter.create(`
      <button class="${document.querySelector('.post-action-menu__copy-link').className || 'btn no-text btn-icon btn-flat'} universal-copy-button"
              title="复制为标准Markdown（${SITE_INFO.hostname} Raw API）">
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
        const rawContent = await getPostRawContent(topicId, postNumber);
        const success = copyToClipboard(rawContent);
        button.title = success ? '已复制!' : '复制失败!';
      } catch (error) {
        console.error('[Discourse Raw Markdown]: 操作失败:', error);
        button.title = '获取失败!';
      } finally {
        setTimeout(() => {
          originalIcon.setAttribute('href', originalHref);
          button.title = `复制为标准Markdown（${SITE_INFO.hostname} Raw API）`;
          button.disabled = false;
        }, 1500);
      }
    });

    return button;
  };

  // 使用elmGetter.each处理帖子
  elmGetter.each('.topic-post .post-controls .actions', (actionsContainer) => {
    // 避免重复添加按钮
    if (actionsContainer.querySelector('.universal-copy-button')) return;

    const postElement = actionsContainer.closest('.topic-post');
    if (!postElement) return;

    const button = createCopyButton(postElement);
    if (button) {
      actionsContainer.prepend(button);
    }
  });

  console.log(`[Discourse Raw Markdown]: 已在 ${SITE_INFO.hostname} 上成功初始化`);
})();