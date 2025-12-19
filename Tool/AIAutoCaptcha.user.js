// ==UserScript==
// @name         !.AIAutoCaptcha
// @description  智能填表。支持 OpenAI/Gemini。自动处理文本验证码；按住 [Alt+点击] 图片强制识别并填入验证码框（找不到则输出到控制台）。
// @version      3.2.0
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/AIAutoCaptcha.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/AIAutoCaptcha.user.js
// ==/UserScript==

(function () {
    'use strict';

    class Config {
        static KEY = 'ai_captcha_config';
        static DEFAULTS = {
            provider: 'openai',
            openai: {
                baseUrl: 'https://api.openai.com/v1/chat/completions',
                apiKey: '',
                model: 'gpt-4o-mini',
                textPrompt: 'Extract the captcha from the image and output only the final answer. If unclear, output nothing.'
            },
            gemini: {
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
                apiKey: '',
                model: 'gemini-2.5-flash-lite',
                textPrompt: 'Extract the captcha from the image and output only the final answer. If unclear, output nothing.'
            }
        };

        // 安全规则：仅在高度疑似验证码输入框时才会填充（白名单优先）
        static SECURITY = {
            // 禁止填充的 input type
            TYPE_BLACKLIST: ['password', 'email', 'search', 'url', 'date', 'datetime-local', 'file', 'hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'range'],

            // 命中则拒绝（id/name/class/placeholder）
            KEYWORD_BLACKLIST: ['user', 'login', 'account', 'pwd', 'pass', 'auth', 'token', 'csrf', 'mail', 'phone', 'mobile', 'address', 'search', 'query', 'wd', 'keyword', 'title', 'content', 'msg', 'price', 'amount'],

            // 命中则优先（id/name/class/placeholder）
            KEYWORD_WHITELIST: ['captcha', 'yzm', 'verification', 'verify', 'vcode', 'checkcode', '验证码', '校验', 'code']
        };

        static IMG_SELECTORS = [
            'img[src*="captcha" i]', 'img[src*="verify" i]', 'img[src*="code" i]', 'img[src*="validate" i]', 'img[src*="random" i]',
            'img[id*="captcha" i]', 'img[id*="verify" i]', 'img[id*="code" i]', 'img[id*="checkcode" i]', 'img[id*="vcode" i]', 'img[id*="auth" i]',
            'img[class*="captcha" i]', 'img[class*="verify" i]', 'img[class*="code" i]', 'img[class*="vcode" i]',
            'img[alt*="captcha" i]', 'img[alt*="verify" i]', 'img[alt*="code" i]', 'img[alt*="验证码" i]',
            'img[title*="captcha" i]', 'img[title*="verify" i]', 'img[title*="code" i]', 'img[title*="验证码" i]'
        ];

        static #data = null;
        static load() {
            try {
                const stored = GM_getValue(this.KEY);
                this.#data = stored ? { ...this.DEFAULTS, ...JSON.parse(stored) } : { ...this.DEFAULTS };
                // 深度补全，防止新字段丢失
                ['openai', 'gemini'].forEach(k => this.#data[k] = { ...this.DEFAULTS[k], ...(this.#data[k] || {}) });
            } catch { this.#data = { ...this.DEFAULTS }; }
        }
        static get() { if (!this.#data) this.load(); return this.#data; }
        static save(d) { this.#data = { ...this.#data, ...d }; GM_setValue(this.KEY, JSON.stringify(this.#data)); }
    }

    // Core: AI Service
    class AI {
        static async solve(base64) {
            const conf = Config.get();
            const cfg = conf[conf.provider];
            if (!cfg.apiKey) throw new Error('No API Key');

            const prompt = cfg.textPrompt;
            const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');

            if (conf.provider === 'gemini') return this.#gemini(cfg, cleanBase64, prompt);
            return this.#openai(cfg, base64, prompt);
        }

        static async #openai(cfg, imgUrl, prompt) {
            const body = {
                model: cfg.model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: imgUrl } }
                    ]
                }],
                max_tokens: 16,
                temperature: 0
            };
            const res = await this.request('POST', cfg.baseUrl, { 'Authorization': `Bearer ${cfg.apiKey}` }, body);
            return res.choices?.[0]?.message?.content?.trim();
        }

        static async #gemini(cfg, b64, prompt) {
            const url = `${cfg.baseUrl}/${cfg.model}:generateContent?key=${cfg.apiKey}`;
            const body = {
                contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: b64 } }] }]
            };
            const res = await this.request('POST', url, {}, body);
            return res.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        }

        static request(method, url, headers, body) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method, url, timeout: 30000,
                    headers: body === undefined ? { ...headers } : { 'Content-Type': 'application/json', ...headers },
                    data: body === undefined ? undefined : JSON.stringify(body),
                    onload: r => {
                        if (r.status >= 200 && r.status < 300) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch { reject(new Error('Bad JSON')); }
                            return;
                        }
                        reject(new Error(`HTTP ${r.status}`));
                    },
                    onerror: () => reject(new Error('Network Error'))
                });
            });
        }
    }

    class ModelService {
        static async list(provider, overrides = {}) {
            const conf = Config.get();
            const cfg = { ...conf[provider], ...overrides };
            if (!cfg.apiKey) throw new Error('No API Key');
            return provider === 'gemini' ? this.#listGemini(cfg) : this.#listOpenAI(cfg);
        }

        static async #listOpenAI(cfg) {
            const url = this.#openaiListUrl(cfg.baseUrl);
            const res = await AI.request('GET', url, { 'Authorization': `Bearer ${cfg.apiKey}` });
            const models = (res.data || []).map(m => m.id).filter(Boolean);
            if (!models?.length) throw new Error('No models returned');
            return models;
        }

        static #openaiListUrl(url) {
            const cleaned = url.replace(/\/v1\/.*$/, '/v1/models');
            return cleaned.includes('/models') ? cleaned : `${cleaned}/models`;
        }

        static async #listGemini(cfg) {
            const url = this.#geminiListUrl(cfg.baseUrl, cfg.apiKey);
            const res = await AI.request('GET', url, {});
            const models = (res.models || []).map(m => m.name?.split('/').pop()).filter(Boolean);
            if (!models?.length) throw new Error('No models returned');
            return models;
        }

        static #geminiListUrl(baseUrl, key) {
            const base = baseUrl.replace(/\/:generateContent.*$/, '').replace(/\/models\/?$/, '/models');
            const root = base.includes('/models') ? base : `${base}/models`;
            return `${root}?key=${key}`;
        }
    }

    // Logic: Scanner & Processor
    class Main {
        #processed = new WeakSet();
        #inputState = new WeakMap();
        #imgMeta = new WeakMap();

        constructor() {
            Config.load();
            this.#init();
        }

        #init() {
            GM_registerMenuCommand('⚙️ Settings', () => SettingsUI.open());

            setInterval(() => this.#scan(), 1500);

            // Alt+点击图片：强制识别；能定位到验证码输入框则直接填入
            document.addEventListener('click', e => {
                if (!e.altKey) return;
                const img = e.target?.closest?.('img');
                if (!img) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                this.#process(img, true, this.#findInput(img));
            }, true);
        }

        #scan() {
            const imgs = document.querySelectorAll(Config.IMG_SELECTORS.join(','));
            imgs.forEach(img => {
                this.#observeImage(img);
                if (this.#processed.has(img) || img.offsetParent === null) return;
                const input = this.#findInput(img);
                if (input) {
                    this.#process(img, false, input);
                }
            });
        }

        #findInput(img) {
            const S = Config.SECURITY;
            let best = { input: null, score: -1 };
            const attrCache = new Map();
            let candidates = [];
            let parent = img.parentElement;

            for (let i = 0; i < 5 && parent; i++) {
                parent.querySelectorAll('input').forEach(input => {
                    const type = (input.type || 'text').toLowerCase();
                    if (S.TYPE_BLACKLIST.includes(type)) return;
                    if (input.disabled || input.readOnly) return;
                    if (!input.offsetParent) return;
                    if (!candidates.includes(input)) candidates.push(input);
                });
                parent = parent.parentElement;
            }

            const infos = candidates.map(input => {
                const attrs = attrCache.get(input) || `${input.id} ${input.name} ${input.className} ${input.placeholder || ''}`.toLowerCase();
                attrCache.set(input, attrs);
                return {
                    input,
                    attrs,
                    whiteIndex: S.KEYWORD_WHITELIST.findIndex(k => attrs.includes(k)),
                    hasBlack: S.KEYWORD_BLACKLIST.some(k => attrs.includes(k))
                };
            });

            infos.forEach(info => {
                if (info.whiteIndex !== -1) {
                    const score = S.KEYWORD_WHITELIST.length - info.whiteIndex;
                    if (score > best.score) best = { input: info.input, score };
                    return;
                }
                if (info.hasBlack) return;
            });

            if (best.input) return best.input;

            const safeFallback = infos.filter(i => !i.hasBlack).map(i => i.input);
            if (safeFallback.length === 1) return safeFallback[0];
            return null;
        }

        async #process(img, force = false, inputEl = null) {
            if (this.#processed.has(img) && !force) return;
            this.#processed.add(img);

            const feedbackEl = inputEl || img;

            if (inputEl && !force && inputEl.value.trim()) {
                this.#processed.delete(img);
                return;
            }

            const originStyle = feedbackEl.style.cssText;
            feedbackEl.style.outline = '3px solid #3B82F6';
            feedbackEl.style.transition = '0.2s';

            try {
                const base64 = await this.#captureBase64(img);
                const res = await AI.solve(base64);
                const clean = this.#normalizeResult(res);

                if (inputEl) {
                    inputEl.value = clean;
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                    this.#inputState.set(inputEl, { lastCode: clean });
                } else if (force) {
                    console.log('[AI OCR][Alt+Click]', clean);
                }

                feedbackEl.style.outline = '3px solid #10B981';
            } catch (err) {
                console.error(err);
                feedbackEl.style.outline = '3px solid #EF4444';
                this.#processed.delete(img); // 失败允许重试
            } finally {
                setTimeout(() => feedbackEl.style.cssText = originStyle, 2000);
            }
        }

        #observeImage(img) {
            if (this.#imgMeta.has(img)) return;
            const reset = () => this.#handleRefresh(img);

            img.addEventListener('load', reset, { passive: true });

            const obs = new MutationObserver(muts => {
                if (!img.isConnected) {
                    obs.disconnect();
                    this.#imgMeta.delete(img);
                    return;
                }
                for (const m of muts) {
                    if (m.type === 'attributes' && m.attributeName === 'src') {
                        reset();
                        break;
                    }
                }
            });
            obs.observe(img, { attributes: true, attributeFilter: ['src'] });

            this.#imgMeta.set(img, { observer: obs });
        }

        #handleRefresh(img) {
            this.#processed.delete(img);
            const input = this.#findInput(img);
            if (!input) return;
            this.#clearIfAIFilled(input);
        }

        #clearIfAIFilled(input) {
            const state = this.#inputState.get(input);
            if (!state || !state.lastCode) return;
            if (input.value === state.lastCode) {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        async #captureBase64(img) {
            if (!img.complete || !img.naturalWidth) await this.#waitForImage(img);
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error('Invalid image size');

            const dpr = window.devicePixelRatio || 1;
            const cvs = document.createElement('canvas');
            cvs.width = w * dpr;
            cvs.height = h * dpr;

            const ctx = cvs.getContext('2d');
            if (!ctx) throw new Error('No 2D context');

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, w, h);
            return cvs.toDataURL('image/png');
        }

        #normalizeResult(raw) {
            const compact = (raw || '').replace(/\s+/g, '');
            if (!compact) throw new Error('Empty OCR result');
            if (!/^[A-Za-z0-9+\-*/=]+$/.test(compact)) throw new Error('Invalid captcha result');

            let cleaned = compact.replace(/=$/, '');
            if (!cleaned) throw new Error('Invalid captcha result');

            if (/^\d+[+\-*/]\d+/.test(cleaned)) {
                try {
                    const val = Function(`return ${cleaned}`)();
                    if (Number.isFinite(val)) cleaned = String(val);
                } catch {}
            }
            return cleaned;
        }

        #waitForImage(img) {
            if (img.complete && img.naturalWidth) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const cleanup = () => {
                    img.removeEventListener('load', onLoad);
                    img.removeEventListener('error', onError);
                };
                const onLoad = () => { cleanup(); resolve(); };
                const onError = () => { cleanup(); reject(new Error('Image load error')); };
                img.addEventListener('load', onLoad, { once: true });
                img.addEventListener('error', onError, { once: true });
            });
        }
    }

    // UI: Settings
    class SettingsUI {
        static open() {
            const host = document.createElement('div');
            const shadow = host.attachShadow({mode:'closed'});
            const conf = Config.get();

            shadow.innerHTML = `
                <style>
                    .box { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:999999; }
                    .pan { background:#fff; padding:20px; border-radius:8px; width:380px; font-family:sans-serif; max-height:90vh; overflow-y:auto; }
                    input,select,textarea { width:100%; margin:5px 0 10px; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:13px; }
                    label { font-size:12px; font-weight:bold; color:#555; display:block; margin-top:8px; }
                    .btns { text-align:right; margin-top:15px; }
                    button { padding:8px 16px; cursor:pointer; border-radius:4px; border:1px solid #ccc; }
                    .model-row { display:flex; gap:8px; align-items:center; margin:5px 0 8px; }
                    .model-row select { flex:1; margin:0; height:32px; }
                    .model-row button { margin:0; height:32px; padding:0 14px; white-space:nowrap; }
                    .model-help { font-size:11px; color:#777; margin:4px 0 8px; }
                    h3 { margin:0 0 15px; font-size:16px; }
                </style>
                <div class="box">
                    <div class="pan">
                        <h3>AI Captcha Settings</h3>

                        <label>Provider</label>
                        <select id="prov">
                            <option value="openai">OpenAI / Custom</option>
                            <option value="gemini">Gemini</option>
                        </select>

                        <label>API Base URL</label>
                        <input id="url" placeholder="https://api.openai.com/v1/chat/completions">

                        <label>API Key</label>
                        <input type="password" id="key" placeholder="sk-...">

                        <label>Model（优先接口选择，无则手填）</label>
                        <div class="model-row">
                            <select id="modelList">
                                <option value="">接口加载后可选</option>
                            </select>
                            <button id="fetchModels" type="button">拉取模型</button>
                        </div>
                        <input id="model" placeholder="例如：gpt-4o-mini">
                        <div class="model-help">接口无返回或需自定义时，直接手填。</div>

                        <label>Text Recognition Prompt</label>
                        <textarea id="tprompt" rows="3" placeholder="请用自然语言描述：只输出识别结果；不确定就输出空。"></textarea>

                        <div class="btns">
                            <button id="save" style="background:#2563EB;color:#fff;border:none;">Save</button>
                            <button id="close">Close</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(host);

            const $ = s => shadow.querySelector(s);
            const load = p => {
                const c = conf[p];
                $('#url').value = c.baseUrl;
                $('#key').value = c.apiKey;
                $('#model').value = c.model;
                $('#tprompt').value = c.textPrompt;
            };
            const renderModelOptions = list => {
                const sel = $('#modelList');
                sel.innerHTML = '<option value="">接口加载后可选</option>';
                list.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    if (m === $('#model').value) opt.selected = true;
                    sel.appendChild(opt);
                });
            };
            const fetchModels = async () => {
                const btn = $('#fetchModels');
                const sel = $('#modelList');
                btn.disabled = true;
                btn.textContent = '加载中';
                sel.innerHTML = '<option value="">加载中...</option>';
                try {
                    const p = $('#prov').value;
                    const list = await ModelService.list(p, { baseUrl: $('#url').value, apiKey: $('#key').value });
                    renderModelOptions(list);
                } catch (err) {
                    alert(`拉取模型失败：${err.message}`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '拉取模型';
                }
            };

            $('#prov').value = conf.provider;
            load(conf.provider);
            renderModelOptions([]);

            $('#prov').onchange = e => {
                load(e.target.value);
                renderModelOptions([]);
            };
            $('#fetchModels').onclick = fetchModels;
            $('#modelList').onchange = e => {
                if (e.target.value) $('#model').value = e.target.value;
            };
            $('#close').onclick = () => host.remove();
            $('#save').onclick = () => {
                const p = $('#prov').value;
                const newC = {
                    provider: p,
                    [p]: {
                        baseUrl: $('#url').value,
                        apiKey: $('#key').value,
                        model: $('#model').value,
                        textPrompt: $('#tprompt').value
                    }
                };
                Config.save(newC);
                host.remove();
            };
        }
    }

    new Main();
})();
