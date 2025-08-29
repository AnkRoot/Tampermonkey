# QuantumDOM 完整文档

## 简介

QuantumDOM 是一个为现代用户脚本设计的终极 DOM 实用工具库。它革命性地将 `MutationObserver` 的事件驱动模型与声明式的跨边界遍历能力（Shadow DOM / Iframe）相结合，提供了健壮、高效且易于使用的 API 来应对复杂的动态网页。

## 核心特性：`>>>` 遍历语法

QuantumDOM 最强大的特性是 `>>>` 分隔符，它允许你用一个选择器字符串无缝地穿透不同的 DOM 领域。

- **`selector >>> shadow-root`**: 获取 `selector` 匹配元素的 Shadow DOM 根节点。
- **`selector >>> iframe-content`**: 获取 `selector` 匹配的 `<iframe>` 元素的内部 `document`，并会自动等待 Iframe 加载完成。

**示例：**
```javascript
// 一个复杂的穿透路径
const deepElement = await QuantumDOM.get(
  '#app-container >>> shadow-root >>> #widget-frame >>> iframe-content >>> .inner-button'
);

// 这个选择器会：
// 1. 在主文档中找到 #app-container
// 2. 进入它的 Shadow DOM
// 3. 在 Shadow DOM 中找到 #widget-frame (一个 Iframe)
// 4. 等待 Iframe 加载完成并进入其 document
// 5. 在 Iframe 的 document 中找到 .inner-button
```
---
## 核心 API 详解

### `get(selectors, options?)`

异步获取一个或多个元素，完全支持 `>>>` 遍历和结果缓存。

- **参数**:
  - `selectors`: `string | string[]` - 单个或多个选择器字符串。
  - `options`: `object` (可选)
    - `parent`: `Node` - 查询的起始节点，默认为 `document`。
    - `timeout`: `number` - 超时时间（毫秒），默认使用全局配置。

- **返回**: `Promise<Element | Element[] | null>`
- **抛出**: `TimeoutError`, `ParseError`, `TraversalError`

- **示例**:
  ```javascript
  // 简单获取
  const title = await QuantumDOM.get('#title');

  // 穿透获取并处理错误
  try {
      const button = await QuantumDOM.get('#app-host >>> shadow-root >>> .submit-btn');
      button.click();
  } catch (e) {
      console.error(e.message);
  }

  // 批量获取，未找到的项为 null
  const [header, content] = await QuantumDOM.get(['#header', '#non-existent']);
  ```

### `each(selector, callback, options?)`

持续处理现在和未来所有匹配的元素，完全支持 `>>>` 遍历。

- **参数**:
  - `selector`: `string` - 支持 `>>>` 的选择器。
  - `callback`: `function(element)` - 回调函数。如果返回 `false`，将停止监听。
  - `options`: `object` (可选)
    - `parent`: `Node` - 起始节点，默认为 `document`。

- **返回**: `function()` - 调用此函数可手动停止监听。

- **示例**:
  ```javascript
  // 监听 Shadow DOM 中动态添加的所有列表项
  const stop = QuantumDOM.each('#list-host >>> shadow-root >>> .list-item', (item) => {
    item.style.backgroundColor = 'lightblue';
  });

  // 在需要时停止
  // stop();
  ```

### `on(eventName, selector, callback, options?)`

为现在和未来的元素提供事件委托，完全支持 `>>>` 遍历。

- **参数**:
  - `eventName`: `string` - 事件名称，如 `'click'`。
  - `selector`: `string` - 支持 `>>>` 的目标元素选择器。
  - `callback`: `function(event, element)` - 事件回调函数。
  - `options`: `object` (可选)
    - `parent`: `Node` - 起始节点，默认为 `document`。

- **返回**: `Promise<function()>` - 一个 Promise，它会解析为一个用于移除监听器的函数。

- **示例**:
  ```javascript
  // 为 Iframe 内部的按钮添加点击事件
  const stopListener = await QuantumDOM.on(
    'click',
    '#widget-iframe >>> iframe-content >>> .action-button',
    (evt, btn) => {
      console.log(`Iframe 中按钮 ${btn.dataset.id} 被点击!`);
    }
  );

  // 在需要时移除监听
  // stopListener();
  ```

### `create(htmlString, options?)` | `css(cssText, id?)`

这两个 API 与 `elmGetter` 功能类似，用于创建元素和注入样式。

- `create` 示例:
  ```javascript
  const ui = QuantumDOM.create(`
    <div id="modal"><h2 id="modal-title">标题</h2></div>
  `, { mapIds: true });
  ui.modalTitle.textContent = '新标题';
  ```
- `css` 示例:
  ```javascript
  QuantumDOM.css('.highlight { background: yellow; }', 'my-highlight-style');
  ```

---
## 配置与工具方法

### `configure(options)`

配置库的全局行为。

- **参数**: `object`
  - `timeout`: `number` (默认: 10000) - 全局超时（毫秒）。
  - `debug`: `boolean` (默认: false) - 是否在控制台打印调试信息。
  - `cacheEnabled`: `boolean` (默认: true) - 是否启用 `get` 的结果缓存。
  - `cacheTTL`: `number` (默认: 300000) - 缓存存活时间（毫秒）。

### `clearCache()`

手动清除所有通过 `get` 缓存的查询结果。

---
## 错误处理

QuantumDOM 抛出可捕获的自定义错误，使错误处理更精确。

- **错误类型**:
  - `QuantumDOM.TimeoutError`: 查找元素超时。
  - `QuantumDOM.ParseError`: 选择器语法错误。
  - `QuantumDOM.TraversalError`: 穿越 Shadow DOM 或 Iframe 时出错（例如 Iframe 加载失败）。

- **错误处理示例**:
  ```javascript
  try {
    const el = await QuantumDOM.get('#app >>> shadow-root >>> #iframe >>> iframe-content >>> .button', { timeout: 3000 });
  } catch (error) {
    if (error instanceof QuantumDOM.TimeoutError) {
      console.error('查找超时，请检查元素是否存在或网络延迟。');
    } else if (error instanceof QuantumDOM.TraversalError) {
      console.error('DOM 穿透错误，可能是 Shadow DOM 或 Iframe 未正确加载。');
    } else {
      console.error('未知错误:', error.message);
    }
  }
  ```
## 性能与最佳实践

1.  **智能缓存**: `get` 方法默认启用缓存。对于频繁查询且不会改变的静态元素，这能极大提升性能。对于动态内容区域，可以考虑在操作后调用 `clearCache()`。
2.  **缩小范围**: 尽可能为 `get`, `each`, `on` 提供 `parent` 上下文，以减少 DOM 监听范围。
3.  **及时清理**: `each` 和 `on` 返回的停止函数是释放资源的关键。确保在不再需要监听时调用它们。
4.  **优化穿透路径**: 穿透 Shadow DOM 和 Iframe 是有成本的。尽量使用最直接、层级最少的选择器路径。
5.  **批量操作**: 当需要获取多个元素时，使用 `get(['#a', '#b'])` 数组形式比多次单独调用 `get` 更高效。
6.  **选择合适的工具**:
    *   **复杂场景**: 当需要处理 Shadow DOM 或 Iframe 穿透时，`QuantumDOM` 是不二之选。
    *   **简单场景**: 如果仅涉及主文档的 DOM 操作，不涉及复杂的边界穿透，使用更轻量级的库可能性能更佳。