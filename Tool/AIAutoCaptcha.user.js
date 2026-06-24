// ==UserScript==
// @name         !.AIAutoCaptcha
// @description  智能填表。支持 OpenAI/Gemini。自动处理文本验证码；按住 [Alt+点击] 图片强制识别并填入验证码框（找不到则输出到控制台）。
// @version      3.2.3
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Tool/AIAutoCaptcha.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Tool/AIAutoCaptcha.user.js
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

        static SECURITY = {
            TYPE_BLACKLIST: ['password', 'email', 'search', 'url', 'date', 'datetime-local', 'file', 'hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'range'],
            KEYWORD_BLACKLIST: ['user', 'login', 'account', 'pwd', 'pass', 'auth', 'token', 'csrf', 'mail', 'phone', 'mobile', 'address', 'search', 'query', 'wd', 'keyword', 'title', 'content', 'msg', 'price', 'amount'],
            KEYWORD_WHITELIST: ['captcha', 'yzm', 'verification', 'verify', 'vcode', 'checkcode', '验证码', '校验', 'code'],
            STRONG_IMG_HINTS: ['captcha', 'yzm', 'verification', 'verify', 'vcode', 'checkcode', 'validate', 'random', 'auth', '验证码', '校验']
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
                if (!stored) {
                    this.#data = this.#cloneDefaults();
                    return;
                }

                const parsed = JSON.parse(stored);
                this.#data = this.#isValid(parsed) ? parsed : this.#cloneDefaults();
            } catch {
                this.#data = this.#cloneDefaults();
            }
        }

        static get() {
            if (!this.#data) this.load();
            return this.#data;
        }

        static save(data) {
            if (!this.#isValid(data)) throw new Error('Invalid config');
            this.#data = data;
            GM_setValue(this.KEY, JSON.stringify(data));
        }

        static #cloneDefaults() {
            return {
                provider: this.DEFAULTS.provider,
                openai: { ...this.DEFAULTS.openai },
                gemini: { ...this.DEFAULTS.gemini }
            };
        }

        static #isValid(data) {
            return data
                && (data.provider === 'openai' || data.provider === 'gemini')
                && this.#isProviderConfig(data.openai)
                && this.#isProviderConfig(data.gemini);
        }

        static #isProviderConfig(cfg) {
            return cfg
                && typeof cfg.baseUrl === 'string'
                && typeof cfg.apiKey === 'string'
                && typeof cfg.model === 'string'
                && typeof cfg.textPrompt === 'string';
        }
    }

    class AI {
        static async solve(base64, options = {}) {
            const conf = Config.get();
            const cfg = conf[conf.provider];
            if (!cfg?.apiKey?.trim()) throw new Error('No API Key');

            const prompt = cfg.textPrompt;
            const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');

            if (conf.provider === 'gemini') return this.#gemini(cfg, cleanBase64, prompt, options);
            return this.#openai(cfg, base64, prompt, options);
        }

        static async #openai(cfg, imgUrl, prompt, options) {
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
            const res = await this.request('POST', cfg.baseUrl, { 'Authorization': `Bearer ${cfg.apiKey}` }, body, options);
            return res.choices?.[0]?.message?.content?.trim();
        }

        static async #gemini(cfg, b64, prompt, options) {
            const url = `${cfg.baseUrl}/${cfg.model}:generateContent?key=${cfg.apiKey}`;
            const body = {
                contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: b64 } }] }]
            };
            const res = await this.request('POST', url, {}, body, options);
            return res.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        }

        static request(method, url, headers = {}, body, options = {}) {
            const { timeout = 30000, signal } = options;

            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(this.#abortError(signal.reason));
                    return;
                }

                let settled = false;
                let req = null;

                const cleanup = () => {
                    signal?.removeEventListener?.('abort', onAbort);
                };
                const finish = (fn, value) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    fn(value);
                };
                const fail = err => finish(reject, err instanceof Error ? err : new Error(String(err)));
                const succeed = value => finish(resolve, value);
                const onAbort = () => {
                    try { req?.abort?.(); } catch {}
                    fail(this.#abortError(signal?.reason));
                };

                signal?.addEventListener?.('abort', onAbort, { once: true });

                req = GM_xmlhttpRequest({
                    method,
                    url,
                    timeout,
                    headers: body === undefined ? { ...headers } : { 'Content-Type': 'application/json', ...headers },
                    data: body === undefined ? undefined : JSON.stringify(body),
                    onload: r => {
                        if (r.status < 200 || r.status >= 300) {
                            fail(new Error(this.#formatHttpError(r)));
                            return;
                        }

                        try {
                            succeed(JSON.parse(r.responseText));
                        } catch {
                            fail(new Error('Bad JSON'));
                        }
                    },
                    ontimeout: () => fail(new Error('Request timeout')),
                    onabort: () => fail(this.#abortError()),
                    onerror: () => fail(new Error('Network Error'))
                });
            });
        }

        static #formatHttpError(r) {
            const snippet = (r.responseText || '').trim().replace(/\s+/g, ' ').slice(0, 200);
            return snippet ? `HTTP ${r.status}: ${snippet}` : `HTTP ${r.status}`;
        }

        static #abortError(reason) {
            if (reason instanceof Error) {
                reason.name = reason.name || 'AbortError';
                return reason;
            }
            const err = new Error(typeof reason === 'string' && reason ? reason : 'Request aborted');
            err.name = 'AbortError';
            return err;
        }
    }

    class ModelService {
        static async list(provider, overrides = {}) {
            const conf = Config.get(), cfg = { ...conf[provider], ...overrides };
            if (!cfg?.apiKey?.trim()) throw new Error('No API Key');
            return provider === 'gemini' ? this.#listGemini(cfg) : this.#listOpenAI(cfg);
        }

        static async #listOpenAI(cfg) {
            const res = await AI.request('GET', this.#modelsUrl(cfg.baseUrl), { 'Authorization': `Bearer ${cfg.apiKey}` });
            const models = (res.data || []).map(m => m.id).filter(Boolean);
            if (!models.length) throw new Error('No models returned');
            return models;
        }

        static async #listGemini(cfg) {
            const res = await AI.request('GET', this.#modelsUrl(cfg.baseUrl, cfg.apiKey), {});
            const models = (res.models || []).map(m => m.name?.split('/').pop()).filter(Boolean);
            if (!models.length) throw new Error('No models returned');
            return models;
        }

        static #modelsUrl(url, key = '') {
            const parsed = this.#parseUrl(url), path = parsed.pathname.replace(/\/+$/, '');
            parsed.pathname = /\/models(?:\/.*)?$/i.test(path)
                ? path.replace(/(\/models).*/, '$1')
                : /\/chat\/completions$/i.test(path)
                    ? path.replace(/\/chat\/completions$/i, '/models')
                    : /\/(?:responses|completions)$/i.test(path)
                        ? path.replace(/\/(?:responses|completions)$/i, '/models')
                        : `${path}/models`;
            parsed.search = '';
            if (key) parsed.searchParams.set('key', key);
            return parsed.toString();
        }

        static #parseUrl(url) {
            try { return new URL(String(url || '').trim()); }
            catch { throw new Error('Invalid API Base URL'); }
        }
    }

    class Main {
        #processed = new WeakSet();
        #inputState = new WeakMap();
        #imgMeta = new WeakMap();
        #runSeq = new WeakMap();
        #retryState = new WeakMap();

        constructor() {
            Config.load();
            this.#init();
        }

        #init() {
            GM_registerMenuCommand('⚙️ Settings', () => SettingsUI.open());
            this.#scan();
            setInterval(() => this.#scan(), 1500);
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
            const conf = Config.get();
            if (!conf[conf.provider]?.apiKey?.trim()) return;
            document.querySelectorAll(Config.IMG_SELECTORS.join(',')).forEach(img => {
                const nextRetryAt = this.#retryState.get(img) || 0;
                if (this.#processed.has(img) || nextRetryAt > Date.now() || !this.#isElementVisible(img)) return;
                const input = this.#findInput(img);
                if (input) this.#process(img, false, input);
            });
        }

        #findInput(img) {
            const S = Config.SECURITY;
            const candidates = new Set();
            for (let parent = img.parentElement, i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
                parent.querySelectorAll('input').forEach(input => {
                    const type = (input.type || 'text').toLowerCase();
                    if (!S.TYPE_BLACKLIST.includes(type) && !input.disabled && !input.readOnly && this.#isElementVisible(input)) candidates.add(input);
                });
            }

            let best = null, bestScore = -1, safe = null, safeCount = 0;
            for (const input of candidates) {
                const attrs = `${input.id} ${input.name} ${input.className} ${input.placeholder || ''}`.toLowerCase();
                const whiteIndex = S.KEYWORD_WHITELIST.findIndex(k => attrs.includes(k));
                if (whiteIndex !== -1) {
                    const score = S.KEYWORD_WHITELIST.length - whiteIndex;
                    if (score > bestScore) {
                        best = input;
                        bestScore = score;
                    }
                    continue;
                }
                if (!S.KEYWORD_BLACKLIST.some(k => attrs.includes(k))) {
                    safe = input;
                    safeCount++;
                }
            }
            if (best) return best;
            if (safeCount !== 1) return null;
            const attrs = `${img.currentSrc || img.src || ''} ${img.id || ''} ${img.className || ''} ${img.alt || ''} ${img.title || ''}`.toLowerCase();
            return Config.SECURITY.STRONG_IMG_HINTS.some(k => attrs.includes(k)) ? safe : null;
        }

        async #process(img, force = false, inputEl = null) {
            this.#observeImage(img);
            if (this.#processed.has(img) && !force) return;
            if (inputEl && !this.#canWriteInput(inputEl, force)) {
                this.#processed.delete(img);
                return;
            }

            const meta = this.#imgMeta.get(img);
            if (force && meta?.controller) this.#cancelInFlight(img, 'Superseded by manual retry');
            this.#processed.add(img);

            const seq = this.#nextRunSeq(img), controller = new AbortController();
            meta.controller = controller;
            const feedbackEl = inputEl || img;
            this.#setFeedback(img, seq, feedbackEl, '#3B82F6');

            try {
                const base64 = await this.#captureBase64(img, controller.signal);
                this.#assertRunCurrent(img, seq);
                const clean = this.#normalizeResult(await AI.solve(base64, { signal: controller.signal }));
                this.#assertRunCurrent(img, seq);

                if (inputEl) {
                    if (!this.#canWriteInput(inputEl, force)) return;
                    this.#writeInput(inputEl, clean);
                    this.#inputState.set(inputEl, { lastCode: clean });
                } else if (force) {
                    console.log('[AI Captcha][Alt+Click]', clean);
                }

                this.#retryState.delete(img);
                this.#setFeedback(img, seq, feedbackEl, '#10B981');
            } catch (err) {
                if (err?.name === 'AbortError') return;
                console.error(err);
                if (this.#isRunCurrent(img, seq)) {
                    this.#markRetryFailure(img);
                    this.#processed.delete(img);
                    this.#setFeedback(img, seq, feedbackEl, '#EF4444');
                }
            } finally {
                if (meta?.controller === controller) meta.controller = null;
                this.#restoreFeedbackLater(img, seq);
            }
        }

        #observeImage(img) {
            if (this.#imgMeta.has(img)) return;
            const reset = () => this.#handleRefresh(img);
            img.addEventListener('load', reset, { passive: true });

            const obs = new MutationObserver(muts => {
                if (!img.isConnected) {
                    this.#cancelInFlight(img, 'Image removed');
                    this.#clearFeedback(img);
                    img.removeEventListener('load', reset);
                    obs.disconnect();
                    this.#imgMeta.delete(img);
                    return;
                }
                for (const m of muts) {
                    if (m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'srcset')) {
                        reset();
                        break;
                    }
                }
            });
            obs.observe(img, { attributes: true, attributeFilter: ['src', 'srcset'] });
            this.#imgMeta.set(img, { controller: null, feedback: null });
        }

        #handleRefresh(img) {
            this.#processed.delete(img);
            this.#retryState.delete(img);
            this.#nextRunSeq(img);
            this.#cancelInFlight(img, 'Image refreshed');
            this.#clearFeedback(img);

            const input = this.#findInput(img);
            if (input) this.#clearIfAIFilled(input);
        }

        #clearIfAIFilled(input) {
            const state = this.#inputState.get(input);
            if (!state?.lastCode) return;
            if (String(input?.value || '').trim() === state.lastCode) this.#writeInput(input, '');
            this.#inputState.delete(input);
        }

        async #captureBase64(img, signal) {
            await this.#waitForImage(img, 10000, signal);

            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error('Invalid image size');

            const cvs = document.createElement('canvas');
            cvs.width = w;
            cvs.height = h;

            const ctx = cvs.getContext('2d');
            if (!ctx) throw new Error('No 2D context');

            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, w, h);
            return cvs.toDataURL('image/png');
        }

        #normalizeResult(raw) {
            const compact = String(raw || '').replace(/\s+/g, '');
            if (!compact) throw new Error('Empty captcha result');

            const cleaned = compact.replace(/=+$/, '');
            if (!cleaned || !/^[A-Za-z0-9]+$/.test(cleaned)) throw new Error('Invalid captcha result');
            return cleaned;
        }

        #waitForImage(img, timeout = 10000, signal) {
            if (signal?.aborted) return Promise.reject(this.#abortError(signal.reason));
            if (img.complete) {
                if (img.naturalWidth) return Promise.resolve();
                return Promise.reject(new Error('Image already broken'));
            }

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    cleanup();
                    reject(new Error('Image load timeout'));
                }, timeout);

                const cleanup = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener?.('abort', onAbort);
                    img.removeEventListener('load', onLoad);
                    img.removeEventListener('error', onError);
                };
                const onLoad = () => {
                    cleanup();
                    if (img.naturalWidth) resolve();
                    else reject(new Error('Image load error'));
                };
                const onError = () => {
                    cleanup();
                    reject(new Error('Image load error'));
                };
                const onAbort = () => {
                    cleanup();
                    reject(this.#abortError(signal?.reason));
                };

                signal?.addEventListener?.('abort', onAbort, { once: true });
                img.addEventListener('load', onLoad, { once: true });
                img.addEventListener('error', onError, { once: true });
            });
        }

        #nextRunSeq(img) {
            const seq = (this.#runSeq.get(img) || 0) + 1;
            this.#runSeq.set(img, seq);
            return seq;
        }

        #isRunCurrent(img, seq) {
            return (this.#runSeq.get(img) || 0) === seq;
        }

        #assertRunCurrent(img, seq) {
            if (this.#isRunCurrent(img, seq)) return;
            throw this.#abortError('Stale captcha request');
        }

        #abortError(reason) {
            const err = new Error(typeof reason === 'string' && reason ? reason : 'Request aborted');
            err.name = 'AbortError';
            return err;
        }

        #cancelInFlight(img, reason) {
            const meta = this.#imgMeta.get(img);
            if (!meta?.controller) return;
            meta.controller.abort(reason || 'Request aborted');
            meta.controller = null;
        }

        #markRetryFailure(img) {
            this.#retryState.set(img, Date.now() + 5000);
        }

        #isElementVisible(el) {
            if (!el?.isConnected) return false;
            const style = getComputedStyle(el);
            if (style.display === 'none') return false;
            if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
            if (Number(style.opacity || '1') === 0) return false;
            return el.getClientRects().length > 0;
        }

        #canWriteInput(input, force) {
            if (!input) return true;
            if (!this.#isElementVisible(input)) return false;
            if (force) return true;

            const current = String(input?.value || '').trim();
            if (!current) return true;

            const state = this.#inputState.get(input);
            return !!state?.lastCode && current === state.lastCode;
        }

        #writeInput(input, value) {
            const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc?.set) desc.set.call(input, value);
            else input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        #setFeedback(img, seq, el, color) {
            const meta = this.#imgMeta.get(img);
            if (!meta) return;
            const current = meta.feedback;

            if (!current || current.seq !== seq || current.el !== el) {
                if (current?.timer) clearTimeout(current.timer);
                if (current?.el) current.el.style.cssText = current.originStyle;
                meta.feedback = { seq, el, originStyle: el.style.cssText, timer: null };
            }

            if (!this.#isRunCurrent(img, seq)) return;
            el.style.outline = `3px solid ${color}`;
            el.style.transition = '0.2s';
        }

        #restoreFeedbackLater(img, seq) {
            const meta = this.#imgMeta.get(img);
            const feedback = meta?.feedback;
            if (!feedback || feedback.seq !== seq) return;

            if (feedback.timer) clearTimeout(feedback.timer);
            feedback.timer = setTimeout(() => {
                const currentMeta = this.#imgMeta.get(img);
                const current = currentMeta?.feedback;
                if (!current || current.seq !== seq) return;
                current.el.style.cssText = current.originStyle;
                currentMeta.feedback = null;
            }, 2000);
        }

        #clearFeedback(img) {
            const meta = this.#imgMeta.get(img);
            const feedback = meta?.feedback;
            if (!feedback) return;
            if (feedback.timer) clearTimeout(feedback.timer);
            feedback.el.style.cssText = feedback.originStyle;
            meta.feedback = null;
        }
    }

    class SettingsUI {
        static open() {
            const host = document.createElement('div');
            const shadow = host.attachShadow({ mode: 'closed' });
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
                    renderModelOptions([]);
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
                const next = {
                    provider: p,
                    openai: { ...conf.openai },
                    gemini: { ...conf.gemini }
                };
                next[p] = {
                    baseUrl: $('#url').value,
                    apiKey: $('#key').value,
                    model: $('#model').value,
                    textPrompt: $('#tprompt').value
                };
                Config.save(next);
                host.remove();
            };
        }
    }

    new Main();
})();
