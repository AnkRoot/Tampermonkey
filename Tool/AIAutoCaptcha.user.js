// ==UserScript==
// @name         !.AIAutoCaptcha
// @description  全自动识别并输入，安全模式排除敏感输入框。
// @version      2.3.0
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

(function () {
    'use strict';

    /**
     * 安全配置与黑名单
     */
    const SECURITY = {
        TYPE_BLACKLIST: [
            'password', 'email', 'search', 'url', 'date', 'datetime-local',
            'month', 'week', 'time', 'color', 'file', 'hidden', 'image',
            'submit', 'button', 'reset', 'checkbox', 'radio', 'range'
        ],
        KEYWORD_BLACKLIST: [
            'user', 'name', 'login', 'account', 'uid', 'id',
            'pwd', 'pass', 'auth_token',
            'mail', 'phone', 'mobile', 'address',
            'search', 'query', 'wd', 'keyword', 'q',
            'title', 'content', 'msg', 'message',
            'price', 'amount', 'num'
        ],
        KEYWORD_WHITELIST: [
            'code', 'captcha', 'yzm', 'verify', 'check', 'auth', 'valid', 'verification', '验证', '校验'
        ]
    };

    class ConfigManager {
        #defaultConfig = {
            provider: 'openai',
            openai: { baseUrl: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-4o-mini' },
            gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: '', model: 'gemini-1.5-flash' },
            qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', apiKey: '', model: 'qwen-vl-max' },
            selectors: [
                'img[src*="captcha"]', 'img[src*="verify"]', 'img[src*="code"]', 'img[id*="code"]', 'img[id*="Code"]',
                'img[class*="captcha"]', 'img[class*="code"]', 'img[alt*="captcha"]', 'img[id="authImage"]',
                'img[src*="validate"]', 'img[src*="random"]'
            ]
        };
        #config;
        constructor() { this.#load(); }
        #load() {
            try {
                const stored = GM_getValue('ai_captcha_config_v3');
                this.#config = stored ? { ...this.#defaultConfig, ...JSON.parse(stored) } : this.#defaultConfig;
            } catch (e) { this.#config = this.#defaultConfig; }
        }
        get all() { return this.#config; }
        save(newConfig) {
            this.#config = { ...this.#config, ...newConfig };
            GM_setValue('ai_captcha_config_v3', JSON.stringify(this.#config));
        }
    }

    class ApiService {
        #configManager;
        #systemPrompt = `输出规则：只输出验证码字符或算术结果，无标点，无前缀。`;
        constructor(configManager) { this.#configManager = configManager; }
        async identify(base64Image) {
            const config = this.#configManager.all;
            const pConfig = config[config.provider];
            if (!pConfig.apiKey) throw new Error("API Key 未配置");
            const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
            if (config.provider === 'gemini') return this.#callGemini(pConfig, cleanBase64);
            return this.#callOpenAIStyle(pConfig, cleanBase64);
        }
        async #callOpenAIStyle(config, base64) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST", url: config.baseUrl,
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
                    data: JSON.stringify({
                        model: config.model,
                        messages: [{ role: "user", content: [{ type: "text", text: this.#systemPrompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }] }]
                    }),
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.error) reject(new Error(data.error.message));
                            else resolve(data.choices[0].message.content.trim());
                        } catch (e) { reject(new Error("API 解析失败")); }
                    },
                    onerror: () => reject(new Error("网络错误"))
                });
            });
        }
        async #callGemini(config, base64) {
            const url = `${config.baseUrl}/${config.model}:generateContent?key=${config.apiKey}`;
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST", url: url,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({ contents: [{ parts: [{ text: this.#systemPrompt }, { inline_data: { mime_type: "image/png", data: base64 } }] }] }),
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.error) reject(new Error(data.error.message));
                            else resolve(data.candidates[0].content.parts[0].text.trim());
                        } catch (e) { reject(new Error("API 解析失败")); }
                    },
                    onerror: () => reject(new Error("网络错误"))
                });
            });
        }
    }

    /**
     * UI 管理 - 全部右下角
     */
    class UiManager {
        #host; #shadow; #indicator; #toastTimer;

        constructor(onOpenSettings) {
            this.#initShadowDOM(onOpenSettings);
        }

        #initShadowDOM(onOpenSettings) {
            this.#host = document.createElement('div');
            // 宿主容器定位
            this.#host.style.cssText = 'position: fixed; bottom: 0; right: 0; width: 0; height: 0; z-index: 2147483647;';
            document.body.appendChild(this.#host);
            this.#shadow = this.#host.attachShadow({ mode: 'closed' });

            const style = document.createElement('style');
            style.textContent = `
                :host { font-family: system-ui, -apple-system, sans-serif; }

                /* --- 右下角呼吸灯 --- */
                .indicator {
                    position: fixed;
                    bottom: 15px;
                    right: 15px;
                    width: 12px; height: 12px; border-radius: 50%;
                    background: #9CA3AF;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    z-index: 10000;
                    border: 2px solid white;
                }
                .indicator:hover { transform: scale(1.3); }

                /* Tooltip for Indicator */
                .indicator::after {
                    content: attr(data-title);
                    position: absolute; right: 20px; bottom: -4px;
                    background: rgba(0,0,0,0.8); color: #fff;
                    padding: 4px 10px; border-radius: 4px; font-size: 12px;
                    white-space: nowrap; opacity: 0; visibility: hidden;
                    transition: all 0.2s; pointer-events: none;
                }
                .indicator:hover::after { opacity: 1; visibility: visible; right: 25px; }

                /* 状态颜色 */
                .status-idle { background: #10B981; box-shadow: 0 0 8px #10B981; animation: breathe 3s infinite; }
                .status-processing { background: #3B82F6; box-shadow: 0 0 12px #3B82F6; animation: blink 0.8s infinite; }
                .status-error { background: #EF4444; box-shadow: 0 0 8px #EF4444; }

                /* --- 提示气泡 (Toast) - 改为右下角向上浮动 --- */
                .toast {
                    position: fixed;
                    bottom: 45px; /* 位于指示器上方 */
                    right: 15px;
                    padding: 8px 14px;
                    background: rgba(31, 41, 55, 0.9);
                    color: white;
                    border-radius: 8px;
                    font-size: 13px;
                    opacity: 0;
                    transform: translateY(10px); /* 初始位置向下偏移，产生上浮效果 */
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    pointer-events: none;
                    backdrop-filter: blur(4px);
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    display: flex; align-items: center; gap: 6px;
                }
                .toast.show { opacity: 1; transform: translateY(0); }

                /* --- 模态框 --- */
                .modal-backdrop {
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.3); backdrop-filter: blur(2px);
                    display: flex; justify-content: center; align-items: center;
                    opacity: 0; visibility: hidden; transition: all 0.2s;
                }
                .modal-backdrop.open { opacity: 1; visibility: visible; }
                .modal-card {
                    background: white; padding: 24px; border-radius: 16px; width: 360px;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
                    transform: scale(0.95); transition: transform 0.2s;
                }
                .modal-backdrop.open .modal-card { transform: scale(1); }
                .form-group { margin-bottom: 12px; }
                .form-label { display: block; font-size: 12px; color: #4B5563; margin-bottom: 4px; font-weight: 500; }
                .form-input {
                    width: 100%; padding: 8px 12px; border: 1px solid #D1D5DB;
                    border-radius: 6px; font-size: 14px; outline: none; transition: border-color 0.2s;
                }
                .form-input:focus { border-color: #3B82F6; }
                .btn { padding: 6px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s; }
                .btn-primary { background: #2563EB; color: white; }
                .btn-primary:hover { background: #1D4ED8; }
                .btn-secondary { background: #F3F4F6; color: #374151; margin-right: 8px; }
                .btn-secondary:hover { background: #E5E7EB; }

                @keyframes breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
                @keyframes blink { 0%, 100% { opacity: 0.5; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }
            `;
            this.#shadow.appendChild(style);

            this.#indicator = document.createElement('div');
            this.#indicator.className = 'indicator';
            this.#indicator.onclick = onOpenSettings;
            this.#shadow.appendChild(this.#indicator);

            this.updateStatus('idle', 'AI 验证码待机中');
        }

        updateStatus(status, text) {
            this.#indicator.className = `indicator status-${status}`;
            this.#indicator.setAttribute('data-title', text);
        }

        showToast(msg) {
            let toast = this.#shadow.querySelector('.toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.className = 'toast';
                this.#shadow.appendChild(toast);
            }
            toast.textContent = msg;
            toast.classList.add('show');
            clearTimeout(this.#toastTimer);
            this.#toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
        }

        renderSettingsModal(configManager, onSave) {
            let modal = this.#shadow.querySelector('.modal-backdrop');
            if (!modal) {
                modal = document.createElement('div');
                modal.className = 'modal-backdrop';
                modal.innerHTML = `
                    <div class="modal-card">
                        <h3 style="margin:0 0 16px 0; color:#111827; font-size:18px">配置 AI 验证码</h3>
                        <div class="form-group"><label class="form-label">服务商</label><select id="p" class="form-input" style="background:white"><option value="openai">OpenAI / 兼容</option><option value="gemini">Google Gemini</option><option value="qwen">通义千问</option></select></div>
                        <div class="form-group"><label class="form-label">API 地址 (Base URL)</label><input id="u" class="form-input"></div>
                        <div class="form-group"><label class="form-label">API Key</label><input id="k" type="password" class="form-input"></div>
                        <div class="form-group"><label class="form-label">模型名称 (Model)</label><input id="m" class="form-input"></div>
                        <div style="text-align:right; margin-top:20px">
                            <button id="c" class="btn btn-secondary">取消</button>
                            <button id="s" class="btn btn-primary">保存配置</button>
                        </div>
                    </div>`;
                this.#shadow.appendChild(modal);
                const els = { p: modal.querySelector('#p'), u: modal.querySelector('#u'), k: modal.querySelector('#k'), m: modal.querySelector('#m'), c: modal.querySelector('#c'), s: modal.querySelector('#s') };
                els.p.onchange = () => { const c = configManager.all[els.p.value]; els.u.value = c.baseUrl; els.k.value = c.apiKey; els.m.value = c.model; };
                els.c.onclick = () => modal.classList.remove('open');
                els.s.onclick = () => {
                    onSave({ provider: els.p.value, [els.p.value]: { baseUrl: els.u.value, apiKey: els.k.value, model: els.m.value } });
                    modal.classList.remove('open');
                };
            }
            const conf = configManager.all;
            const p = conf.provider;
            const card = modal.querySelector('.modal-card');
            card.querySelector('#p').value = p;
            card.querySelector('#u').value = conf[p].baseUrl;
            card.querySelector('#k').value = conf[p].apiKey;
            card.querySelector('#m').value = conf[p].model;
            modal.classList.add('open');
        }
    }

    class AutoController {
        #configManager; #apiService; #uiManager; #imageState = new WeakMap();
        constructor() {
            this.#configManager = new ConfigManager();
            this.#apiService = new ApiService(this.#configManager);
            this.#uiManager = new UiManager(() => this.#openSettings());
            this.#checkApiKey();
            GM_registerMenuCommand('⚙️ 验证码设置', () => this.#openSettings());
            setInterval(() => this.#scan(), 1500);
        }
        #checkApiKey() {
            const c = this.#configManager.all;
            if (!c[c.provider].apiKey) this.#uiManager.updateStatus('error', '未配置 Key (点击配置)');
        }
        #openSettings() {
            this.#uiManager.renderSettingsModal(this.#configManager, (c) => {
                this.#configManager.save(c);
                this.#checkApiKey();
                this.#uiManager.showToast('设置已保存');
                if (this.#configManager.all[this.#configManager.all.provider].apiKey) this.#uiManager.updateStatus('idle', 'AI 待机中');
            });
        }
        #scan() {
            if (this.#uiManager.status === 'error') return;
            const selectors = this.#configManager.all.selectors.join(',');
            const images = document.querySelectorAll(selectors);
            images.forEach(img => {
                const rect = img.getBoundingClientRect();
                if (rect.width < 30 || rect.height < 10 || window.getComputedStyle(img).visibility === 'hidden') return;
                const state = this.#imageState.get(img);
                if (!state || state.src !== img.src) {
                    const input = this.#findInputSafe(img);
                    if (input && !input.value) this.#process(img, input);
                }
            });
        }
        #findInputSafe(img) {
            let parent = img.parentElement;
            for (let i = 0; i < 3 && parent; i++) {
                const inputs = parent.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled])');
                for (let input of inputs) {
                    const type = (input.type || 'text').toLowerCase();
                    if (SECURITY.TYPE_BLACKLIST.includes(type)) continue;
                    const attrs = (input.id + " " + input.name + " " + input.className + " " + (input.placeholder || "")).toLowerCase();
                    if (SECURITY.KEYWORD_BLACKLIST.some(kw => attrs.includes(kw))) continue;
                    if (SECURITY.KEYWORD_WHITELIST.some(kw => attrs.includes(kw))) return input;
                    if (inputs.length === 1 && (type === 'text' || type === 'tel')) return input;
                }
                parent = parent.parentElement;
            }
            return null;
        }
        async #process(img, input) {
            this.#imageState.set(img, { src: img.src, status: 'processing' });
            this.#uiManager.updateStatus('processing', 'AI 识别中...');
            const originalPlaceholder = input.placeholder;
            input.placeholder = "AI 识别中...";
            try {
                const base64 = await this.#imgToBase64(img);
                if (!base64) throw new Error("Image Error");
                const code = await this.#apiService.identify(base64);
                if (code && !input.value) {
                    input.value = code;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    this.#uiManager.showToast(`已填入: ${code}`);
                }
            } catch (err) { } finally {
                input.placeholder = originalPlaceholder;
                this.#uiManager.updateStatus('idle', 'AI 待机中');
                this.#imageState.set(img, { src: img.src, status: 'done' });
            }
        }
        async #imgToBase64(img) {
            try {
                if (!img.complete) await new Promise(r => img.onload = r);
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 100;
                canvas.height = img.naturalHeight || 40;
                canvas.getContext('2d').drawImage(img, 0, 0);
                return canvas.toDataURL('image/png');
            } catch { return null; }
        }
    }
    new AutoController();
})();
