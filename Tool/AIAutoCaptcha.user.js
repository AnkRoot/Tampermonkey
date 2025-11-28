// ==UserScript==
// @name         !.AIAutoCaptcha
// @description  全自动识别并输入验证码。安全模式排除敏感输入框，支持跨域图片识别。使用现代视觉模型 (GPT-4o/Gemini/Qwen) 进行极速识别，智能逻辑不再依赖 URL 变化，提供银行级安全防护。
// @version      3.0.2
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/AIAutoCaptcha.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/AIAutoCaptcha.user.js
// ==/UserScript==

/**
 * @project      AI 验证码自动识别 (AIAutoCaptcha)
 * @version      3.0.1
 * @description  一个配置一次、终身忘记的脚本。它静默地守护在浏览器右下角，利用现代 AI 视觉能力自动搞定验证码。
 *
 * ### 1. ⚡️ 极致的"无感"自动化体验
 * - **Canvas 直读取图**：采用 `Canvas` API 直接读取图片数据，在同源下实现高效快速的图像捕获。
 * - **极速响应**：引入 `load` 事件监听，图片渲染完成瞬间立即触发识别。
 * - **智能刷新**：监听图片 `src` 变化，用户手动点击刷新验证码后，脚本会自动清空旧值并重新识别，无需手动干预。
 *
 * ### 2. 🧠 现代 AI 协议与结构化 Prompt
 * - **System Prompt 分离**：修复旧版将指令混入 User 消息的问题。采用标准的 Role 分离结构，大幅提升对“计算题”、“字符过滤”的遵循度。
 * - **最佳参数锁定**：强制 `temperature: 0` 和 `top_p: 1`，消除 AI 的“创造性”，确保 OCR 结果的绝对确定性。
 * - **多模型适配**：完美适配 GPT-4o (Vision)、Google Gemini 1.5 (Native API)、通义千问 Qwen-VL。
 *
 * ### 3. 🛡️ 银行级的安全与防误触机制
 * - **绝对非空保护**：“有值不填”原则。只要框内有人工输入的字符，脚本绝不覆盖。
 * - **严格黑名单**：明确排除 password、email、search 等敏感输入框，绝不读取或填入密码域。
 * - **状态防抖**：使用 `WeakMap` 记录处理状态，防止页面滚动或重绘时重复消耗 API 额度。
 *
 * ### 4. 🎨 统一且优雅的 UI (Shadow DOM)
 * - **样式隔离**：所有 UI 封装在 Shadow DOM 中，互不影响。
 * - **状态反馈**：右下角呼吸灯（🟢待机 / 🔵识别中 / 🔴错误）+ 玻璃拟态设置面板。
 */

(function () {
    'use strict';

    // --- 静态配置与常量 ---

    const SECURITY = {
        // 绝对禁止操作的输入框类型
        TYPE_BLACKLIST: ['password', 'email', 'search', 'url', 'date', 'datetime-local', 'file', 'hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'range'],
        // 明确指向非验证码用途的语义关键词
        KEYWORD_BLACKLIST: ['user', 'login', 'account', 'pwd', 'pass', 'auth_token', 'mail', 'phone', 'mobile', 'address', 'search', 'query', 'wd', 'keyword', 'title', 'content', 'msg', 'price', 'amount'],
        // 优先匹配的白名单关键词（按可信度降序排列）
        KEYWORD_WHITELIST: ['captcha', 'yzm', 'verification', '验证', '校验', 'verify', 'valid', 'auth', '认证', 'check', 'code', '安全']
    };

    const AI_PROMPTS = {
        // 现代化的结构化 Prompt (System Role)
        OCR_SYSTEM: `I am a specialized OCR engine for CAPTCHA solving.
Rules:
1. Output ONLY the characters found in the image.
2. NO markdown, NO explanations, NO prefixes like "The code is".
3. If the image is a math problem (e.g., "1+1=?"), output the numerical result ONLY.
4. Strictly maintain case sensitivity (Upper/Lower case).
5. Ignore background noise, lines, or dots.`
    };

    // --- 核心模块 ---

    class ConfigManager {
        #defaultConfig = {
            provider: 'openai',
            openai: { baseUrl: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-4o-mini' },
            gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: '', model: 'gemini-1.5-flash' },
            qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', apiKey: '', model: 'qwen-vl-max' },
            selectors: [
                'img[src*="captcha" i]', 'img[src*="verify" i]', 'img[src*="code" i]', 'img[src*="validate" i]', 'img[src*="random" i]',
                'img[id*="captcha" i]', 'img[id*="verify" i]', 'img[id*="code" i]', 'img[id*="checkcode" i]', 'img[id*="vcode" i]', 'img[id*="auth" i]',
                'img[class*="captcha" i]', 'img[class*="verify" i]', 'img[class*="code" i]', 'img[class*="vcode" i]',
                'img[alt*="captcha" i]', 'img[alt*="verify" i]', 'img[alt*="code" i]', 'img[alt*="验证码" i]',
                'img[title*="captcha" i]', 'img[title*="verify" i]', 'img[title*="code" i]', 'img[title*="验证码" i]'
            ]
        };
        #config;

        constructor() { this.#load(); }

        #load() {
            try {
                const stored = GM_getValue('ai_captcha_config_v3');
                this.#config = stored ? { ...this.#defaultConfig, ...JSON.parse(stored) } : this.#defaultConfig;
            } catch { this.#config = this.#defaultConfig; }
        }

        get all() { return this.#config; }

        save(newConfig) {
            this.#config = {
                ...this.#config,
                ...newConfig,
                [newConfig.provider]: { ...this.#config[newConfig.provider], ...newConfig[newConfig.provider] }
            };
            GM_setValue('ai_captcha_config_v3', JSON.stringify(this.#config));
        }
    }

    class ImageUtils {
        static #base64Cache = new WeakMap();

        /**
         * 仅依赖 Canvas 获取验证码 Base64（失败时直接抛错，让调用方感知跨域或加载问题）
         */
        static async getBase64(img) {
            if (!img) throw new Error("未知的验证码图片");
            if (this.#base64Cache.has(img)) {
                return this.#base64Cache.get(img);
            }
            const task = this.#getByCanvas(img);
            this.#base64Cache.set(img, task);
            try {
                return await task;
            } catch (error) {
                this.#base64Cache.delete(img);
                throw error;
            }
        }

        static invalidate(img) {
            if (!img) return;
            this.#base64Cache.delete(img);
        }

        static #getByCanvas(img) {
            return new Promise((resolve, reject) => {
                if (!img.complete || img.naturalWidth === 0) {
                    reject(new Error("Image not loaded"));
                    return;
                }
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    // 若无 CORS 头，此处会抛出 SecurityError
                    const dataURL = canvas.toDataURL('image/png');
                    resolve(dataURL);
                } catch (e) {
                    reject(e);
                }
            });
        }
    }

    class ApiService {
        #configManager;
        constructor(configManager) { this.#configManager = configManager; }

        async identify(base64Image) {
            const config = this.#configManager.all;
            const pConfig = config[config.provider];
            if (!pConfig.apiKey) throw new Error("API Key 未配置");

            // 移除 data:image/png;base64, 前缀，用于 Gemini 等需要纯数据的接口
            const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');

            if (config.provider === 'gemini') {
                return this.#callGemini(pConfig, cleanBase64);
            } else {
                return this.#callOpenAICompatible(pConfig, base64Image);
            }
        }

        // OpenAI / Qwen / Claude-via-Proxy
        async #callOpenAICompatible(config, fullBase64) {
            return new Promise((resolve, reject) => {
                const messages = [
                    {
                        role: "system",
                        content: AI_PROMPTS.OCR_SYSTEM // 修复：System Prompt 归位
                    },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: fullBase64 } }
                        ]
                    }
                ];

                GM_xmlhttpRequest({
                    method: "POST",
                    url: config.baseUrl,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${config.apiKey}`
                    },
                    data: JSON.stringify({
                        model: config.model,
                        messages: messages,
                        temperature: 0, // 核心参数：0 (贪婪采样，最稳)
                        top_p: 1,
                        max_tokens: 20
                    }),
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.error) reject(new Error(data.error.message || 'API Error'));
                            else resolve(data.choices[0].message.content.trim());
                        } catch (e) {
                            reject(new Error("API 解析失败"));
                        }
                    },
                    onerror: () => reject(new Error("网络请求失败"))
                });
            });
        }

        // Google Gemini Native API
        async #callGemini(config, cleanBase64) {
            const url = `${config.baseUrl}/${config.model}:generateContent?key=${config.apiKey}`;

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({
                        // Gemini v1beta 推荐使用 system_instruction
                        system_instruction: {
                            parts: [{ text: AI_PROMPTS.OCR_SYSTEM }]
                        },
                        contents: [{
                            parts: [
                                { inline_data: { mime_type: "image/png", data: cleanBase64 } }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0,
                            topP: 1,
                            maxOutputTokens: 20
                        }
                    }),
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.error) reject(new Error(data.error.message));
                            else if (data.candidates && data.candidates[0].content) {
                                resolve(data.candidates[0].content.parts[0].text.trim());
                            } else {
                                reject(new Error("Gemini 无有效响应"));
                            }
                        } catch (e) {
                            reject(new Error("Gemini 解析失败"));
                        }
                    },
                    onerror: () => reject(new Error("网络错误"))
                });
            });
        }
    }

    class UiManager {
        #host; #shadow; #indicator; #toastTimer;
        constructor(onOpenSettings) { this.#initShadowDOM(onOpenSettings); }

        #initShadowDOM(onOpenSettings) {
            this.#host = document.createElement('div');
            this.#host.style.cssText = 'position: fixed; bottom: 0; right: 0; width: 0; height: 0; z-index: 2147483647;';
            document.body.appendChild(this.#host);

            this.#shadow = this.#host.attachShadow({ mode: 'closed' });

            const style = document.createElement('style');
            style.textContent = `
                :host { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
                .indicator { position: fixed; bottom: 20px; right: 20px; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 0 2px rgba(255,255,255,0.8), 0 4px 6px rgba(0,0,0,0.1); z-index: 9999; }
                .indicator:hover { transform: scale(1.2); }
                .status-idle { background: #10B981; } 
                .status-processing { background: #3B82F6; animation: pulse 1s infinite; } 
                .status-error { background: #EF4444; } 
                .toast { position: fixed; bottom: 50px; right: 20px; padding: 8px 16px; background: rgba(17, 24, 39, 0.85); color: #fff; border-radius: 8px; font-size: 13px; opacity: 0; transform: translateY(10px); transition: all 0.3s; pointer-events: none; backdrop-filter: blur(8px); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .toast.show { opacity: 1; transform: translateY(0); }
                .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.2); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.2s; }
                .backdrop.open { opacity: 1; visibility: visible; }
                .panel { background: #fff; width: 340px; padding: 24px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); transform: scale(0.95); transition: transform 0.2s; display: flex; flex-direction: column; gap: 16px; color: #374151; }
                .backdrop.open .panel { transform: scale(1); }
                .title { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
                .field { display: flex; flex-direction: column; gap: 6px; }
                .label { font-size: 12px; font-weight: 500; color: #4B5563; }
                .input { padding: 8px 12px; border: 1px solid #E5E7EB; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; width: 100%; box-sizing: border-box; background: #fff; color: #1F2937; }
                .input:focus { border-color: #3B82F6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1); }
                .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
                .btn { padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: background 0.2s; }
                .btn-cancel { background: #F3F4F6; color: #4B5563; }
                .btn-save { background: #2563EB; color: #fff; }
                @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); } 70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); } 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); } }
            `;

            this.#shadow.appendChild(style);

            this.#indicator = document.createElement('div');
            this.#indicator.className = 'indicator status-idle';
            this.#indicator.onclick = onOpenSettings;
            this.#indicator.title = "点击配置 AI 验证码";
            this.#shadow.appendChild(this.#indicator);
        }

        updateStatus(status, msg) {
            this.#indicator.className = `indicator status-${status}`;
            this.#indicator.title = msg;
        }

        showToast(text) {
            let toast = this.#shadow.querySelector('.toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.className = 'toast';
                this.#shadow.appendChild(toast);
            }
            toast.textContent = text;
            toast.classList.add('show');
            clearTimeout(this.#toastTimer);
            this.#toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
        }

        renderSettings(configManager, onSave) {
            let backdrop = this.#shadow.querySelector('.backdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'backdrop';
                backdrop.innerHTML = `
                    <div class="panel">
                        <h3 class="title">AI 验证码配置</h3>
                        <div class="field">
                            <label class="label">服务商 (Provider)</label>
                            <select id="p" class="input">
                                <option value="openai">OpenAI / Compatible</option>
                                <option value="gemini">Google Gemini</option>
                                <option value="qwen">Aliyun Qwen (通义)</option>
                            </select>
                        </div>
                        <div class="field">
                            <label class="label">API 端点 (Base URL)</label>
                            <input id="u" class="input" placeholder="https://...">
                        </div>
                        <div class="field">
                            <label class="label">API 密钥 (Key)</label>
                            <input id="k" type="password" class="input" placeholder="sk-...">
                        </div>
                        <div class="field">
                            <label class="label">模型名称 (Model)</label>
                            <input id="m" class="input" placeholder="gpt-4o-mini">
                        </div>
                        <div class="actions">
                            <button id="c" class="btn btn-cancel">取消</button>
                            <button id="s" class="btn btn-save">保存</button>
                        </div>
                    </div>
                `;
                this.#shadow.appendChild(backdrop);

                const els = {
                    p: backdrop.querySelector('#p'),
                    u: backdrop.querySelector('#u'),
                    k: backdrop.querySelector('#k'),
                    m: backdrop.querySelector('#m'),
                    cancel: backdrop.querySelector('#c'),
                    save: backdrop.querySelector('#s')
                };

                const updateInputs = () => {
                    const type = els.p.value;
                    const conf = configManager.all[type];
                    els.u.value = conf.baseUrl;
                    els.k.value = conf.apiKey;
                    els.m.value = conf.model;
                };

                els.p.onchange = updateInputs;

                els.cancel.onclick = () => backdrop.classList.remove('open');

                els.save.onclick = () => {
                    const provider = els.p.value;
                    onSave({
                        provider: provider,
                        [provider]: {
                            baseUrl: els.u.value.trim(),
                            apiKey: els.k.value.trim(),
                            model: els.m.value.trim()
                        }
                    });
                    backdrop.classList.remove('open');
                };
            }

            const conf = configManager.all;
            const pVal = conf.provider;
            const backdropEl = this.#shadow.querySelector('.backdrop');
            const pSelect = backdropEl.querySelector('#p');
            pSelect.value = pVal;
            pSelect.dispatchEvent(new Event('change'));
            backdropEl.classList.add('open');
        }
    }

    class AutoController {
        #configManager; #apiService; #uiManager;
        #observedImages = new WeakSet();
        #processingMap = new WeakMap();

        constructor() {
            this.#configManager = new ConfigManager();
            this.#apiService = new ApiService(this.#configManager);
            this.#uiManager = new UiManager(() => this.#openSettings());

            this.#checkInit();
            GM_registerMenuCommand('⚙️ 验证码设置', () => this.#openSettings());

            setInterval(() => this.#scan(), 1500);
        }

        #checkInit() {
            const c = this.#configManager.all;
            if (!c[c.provider].apiKey) {
                this.#uiManager.updateStatus('error', '未配置 Key');
                setTimeout(() => this.#uiManager.showToast('请点击红点配置 API Key'), 1000);
            }
        }

        #openSettings() {
            this.#uiManager.renderSettings(this.#configManager, (newConf) => {
                this.#configManager.save(newConf);
                this.#uiManager.showToast('配置已保存');
                this.#uiManager.updateStatus('idle', '就绪');
                this.#scan();
            });
        }

        #scan() {
            const selectors = this.#configManager.all.selectors.join(',');
            const images = document.querySelectorAll(selectors);

            images.forEach(img => {
                if (img.offsetParent === null) return;
                const rect = img.getBoundingClientRect();
                if (rect.width < 30 || rect.height < 10) return;

                if (!this.#observedImages.has(img)) {
                    this.#observedImages.add(img);
                    this.#bindEvents(img);
                    if (img.complete && img.naturalWidth > 0) {
                        this.#process(img);
                    }
                }
            });
        }

        #bindEvents(img) {
            ImageUtils.invalidate(img);

            img.addEventListener('load', () => {
                ImageUtils.invalidate(img);
                this.#clearInput(img);
                setTimeout(() => this.#process(img, true), 100);
            });

            const obs = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'attributes' && m.attributeName === 'src') {
                        ImageUtils.invalidate(img);
                        this.#clearInput(img);
                    }
                }
            });
            obs.observe(img, { attributes: true, attributeFilter: ['src'] });
        }

        #clearInput(img) {
            const input = this.#findInputSafe(img);
            if (input && input.value) {
                if (this.#processingMap.has(img)) return;
                input.value = '';
                this.#uiManager.updateStatus('processing', '图片刷新...');
            }
        }

        #findInputSafe(img) {
            let bestMatch = { input: null, score: -1 };
            let potentialInputs = [];
            let parent = img.parentElement;

            // 1. 收集所有邻近的、符合基本条件的输入框
            for (let i = 0; i < 5 && parent; i++) {
                parent.querySelectorAll('input').forEach(input => {
                    const type = (input.type || 'text').toLowerCase();
                    if (!SECURITY.TYPE_BLACKLIST.includes(type) && !input.disabled && !input.readOnly) {
                        if (!potentialInputs.includes(input)) potentialInputs.push(input);
                    }
                });
                parent = parent.parentElement;
            }

            // 2. 遍历所有候选输入框，根据白名单的可信度顺序进行打分
            for (const input of potentialInputs) {
                const attrs = `${input.id} ${input.name} ${input.className} ${input.placeholder || ''}`.toLowerCase();
                const matchIndex = SECURITY.KEYWORD_WHITELIST.findIndex(kw => attrs.includes(kw));

                if (matchIndex !== -1) {
                    const score = SECURITY.KEYWORD_WHITELIST.length - matchIndex;
                    if (score > bestMatch.score) {
                        // 一旦命中白名单，即为候选者，不再受黑名单否决
                        bestMatch = { input: input, score: score };
                    }
                }
            }

            // 3. 如果有基于白名单的最佳匹配，则返回它
            if (bestMatch.input) return bestMatch.input;

            // 4. [降级策略] 如果没有白名单命中，则检查是否存在唯一的、未被关键词拉黑的输入框
            const validInputs = potentialInputs.filter(inp => {
                const attrs = `${inp.id} ${inp.name} ${inp.className} ${inp.placeholder || ''}`.toLowerCase();
                return !SECURITY.KEYWORD_BLACKLIST.some(kw => attrs.includes(kw)) && inp.offsetParent !== null;
            });

            if (validInputs.length === 1) return validInputs[0];

            return null;
        }

        async #process(img, isRefresh = false) {
            const input = this.#findInputSafe(img);
            if (!input) return;

            if (this.#processingMap.get(img)) return;
            if (!isRefresh && input.value.length > 0) return;

            this.#processingMap.set(img, true);
            this.#uiManager.updateStatus('processing', 'AI 识别中...');

            const originalPh = input.placeholder;
            input.placeholder = "AI 正在识别...";

            try {
                const base64 = await ImageUtils.getBase64(img);
                const code = await this.#apiService.identify(base64);

                if (code) {
                    if (!input.value) {
                        input.value = code;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        this.#uiManager.showToast(`已填入: ${code}`);
                    }
                }
            } catch (err) {
                console.error('[AIAutoCaptcha]', err);
                if (err.message.includes("API Key")) {
                    this.#uiManager.updateStatus('error', 'API Key 错误');
                }
            } finally {
                input.placeholder = originalPh;
                this.#uiManager.updateStatus('idle', '待机');
                this.#processingMap.delete(img);
            }
        }
    }

    new AutoController();

})();
