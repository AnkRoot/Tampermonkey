## **elmGetter 2.0 API 文档**

**版本:** 2.0.0
**作者:** ank (Refactored by Gemini)

`elmGetter` 是一个为现代用户脚本量身打造的高性能异步 DOM 操作库。它不仅提供了强大的元素获取和监听功能，还内置了事件委托和样式注入等实用工具，旨在简化动态网页环境下的脚本开发。

### **核心理念：现代、高效、强大**

`elmGetter 2.0` 经过彻底重构，专注于提供：

- **清晰的 API**: 使用选项对象 (`{}`) 代替多重参数，代码意图一目了然。
- **极致的性能**: 内部共享 `MutationObserver` 实例，自动管理生命周期，极大减少资源开销。
- **强大的功能**: 内置事件委托 (`on`) 和样式注入 (`css`)，解决用户脚本开发的常见痛点。

---

### **核心方法**

#### `async elmGetter.get(selectors, [options])`

异步获取一个或多个元素。如果元素当前不存在，将等待其出现直至超时。

- **`selectors`**: `string | string[]` - 单个或多个 CSS/XPath 选择器。
- **`options`**: `object` (可选) - 配置对象：
  - `parent`: `Node` - 查询的起始节点，默认为 `document`。
  - `timeout`: `number` - 超时时间（毫秒），`0` 表示不超时。

**返回**: `Promise<Element | Element[] | null>` - 若传入单个选择器，返回找到的元素或 `null`。若传入数组，返回一个元素数组（未找到的项为 `null`）。

**示例:**

```javascript
// 获取单个元素，超时 3 秒
const el = await elmGetter.get('#dynamic-id', { timeout: 3000 });

// 批量获取多个元素
const [header, footer] = await elmGetter.get(['#header', '#footer']);

// 在特定容器内查找
const container = await elmGetter.get('.container');
if (container) {
  const item = await elmGetter.get('.item', { parent: container });
}
```

#### `elmGetter.each(selector, callback, [options])`

持续处理现在和未来所有匹配选择器的元素。

- **`selector`**: `string` - CSS/XPath 选择器。
- **`callback`**: `function(element, isNew)` - 回调函数。
  - `element` (`Element`): 当前处理的元素。
  - `isNew` (`boolean`): 元素是否为动态新增的。
  - **返回 `false` 可立即停止监听。**
- **`options`**: `object` (可选) - 配置对象：
  - `parent`: `Node` - 监听的根节点，默认为 `document`。

**返回**: `function()` - 调用此函数可手动停止监听。

**示例:**

```javascript
// 为所有 class 为 'highlight' 的元素添加边框
const stopHighlighting = elmGetter.each('.highlight', (el, isNew) => {
  el.style.border = '2px solid gold';
  if (isNew) {
    console.log('新的高亮元素已添加!');
  }
});

// 10秒后停止监听
setTimeout(stopHighlighting, 10000);
```

#### `elmGetter.on(eventName, selector, callback, [options])`

为现在和未来的元素提供高效的事件委托。

- **`eventName`**: `string` - DOM 事件名称，如 `'click'`, `'mouseover'`。
- **`selector`**: `string` - 目标元素的选择器。
- **`callback`**: `function(event, element)` - 事件触发时的回调。
  - `event` (`Event`): 原生事件对象。
  - `element` (`Element`): 匹配选择器并触发事件的元素。
- **`options`**: `object` (可选) - 配置对象：
  - `parent`: `Node` - 监听事件的根节点，默认为 `document`。

**返回**: `function()` - 调用此函数可移除事件监听器。

**示例:**

```javascript
// 当动态添加的 .delete-btn 被点击时，移除其父元素
const stopDeleteListener = elmGetter.on('click', '.delete-btn', (e, btn) => {
  btn.closest('.item').remove();
});

// 在需要时可以停止监听
// stopDeleteListener();
```

#### `elmGetter.create(htmlString, [options])`

从 HTML 字符串安全地创建 DOM 元素。

- **`htmlString`**: `string` - 包含单个根元素的 HTML 字符串。
- **`options`**: `object` (可选) - 配置对象：
  - `parent`: `Element` - 若提供，创建的元素会自动附加到此父元素。
  - `mapIds`: `boolean` - 若为 `true`，返回一个以元素 ID 为键的对象，默认为 `false`。

**返回**: `Element | {[key: string]: Element} | null` - 创建的元素，或 ID 映射对象。

**示例:**

```javascript
// 创建并附加一个新段落
elmGetter.create('<p>Hello World</p>', { parent: document.body });

// 创建一个复杂的 UI 组件并获取其内部元素的引用
const ui = elmGetter.create(`
  <div id="dialog">
    <h3 id="dialogTitle">提示</h3>
    <button id="closeBtn">关闭</button>
  </div>
`, { mapIds: true });

ui.dialogTitle.textContent = '操作成功';
ui.closeBtn.onclick = () => ui.dialog.remove();
document.body.appendChild(ui.dialog);
```

---

### **工具方法**

#### `elmGetter.css(cssText, [id])`

向页面注入 CSS 样式，并可选择性地防止重复注入。

- **`cssText`**: `string` - CSS 样式规则。
- **`id`**: `string` (可选) - 为 `<style>` 标签指定一个 ID。如果页面上已存在该 ID 的元素，则不会重复注入。

**返回**: `HTMLStyleElement` - 创建或找到的 `<style>` 元素。

**示例:**

```javascript
// 注入一些全局样式
elmGetter.css(`
  .my-script-modal { display: block; position: fixed; }
  .my-script-overlay { background: rgba(0,0,0,0.5); }
`, 'my-script-styles');
```

#### `elmGetter.config(options)`

配置 `elmGetter` 的全局行为。

- **`options`**: `object` - 配置对象：
  - `selectorMode`: `'css' | 'xpath'` - 设置全局的选择器引擎。

**返回**: `elmGetter` 实例本身，支持链式调用。

**示例:**

```javascript
elmGetter.config({ selectorMode: 'xpath' });
const element = await elmGetter.get("//div[contains(text(), 'unique text')]");
elmGetter.config({ selectorMode: 'css' }); // 切换回默认模式
```

#### `elmGetter.currentSelectorMode`

获取当前的选择器模式（只读属性）。

```javascript
console.log(elmGetter.currentSelectorMode); // 'css' 或 'xpath'
```