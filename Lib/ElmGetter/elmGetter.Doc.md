# elmGetter 完整文档

## 简介

`elmGetter` 是一个为现代用户脚本量身打造的高性能异步 DOM 操作库。它通过共享 `MutationObserver` 实例和提供声明式 API，极大地简化了在动态网页中获取元素、监听变化和处理事件的复杂性。

## 设计理念

- **性能优先**: 内部自动管理和共享 `MutationObserver`，确保在监听大量变化时也能保持低资源占用。
- **API 简洁**: 提供链式调用和清晰的选项对象，让代码更具可读性。
- **功能集成**: 内置事件委托 (`on`)、样式注入 (`css`) 和元素创建 (`create`) 等常用功能，提供一站式解决方案。

---

## 核心 API 详解

### `get(selectors, options?)`

异步获取一个或多个元素。如果元素当前不存在，将等待其出现，直到超时。

- **参数**:
  - `selectors`: `string | string[]` - 单个或多个 CSS/XPath 选择器字符串。
  - `options`: `object` (可选)
    - `parent`: `Node` - 查询的起始节点，默认为 `document`。
    - `timeout`: `number` - 超时时间（毫秒）。如果设置为 `0`，则仅在超时后返回已找到的元素，不会无限等待。

- **返回**: `Promise<Element | Element[] | null>`
  - 如果传入字符串，返回单个 `Element` 或 `null`。
  - 如果传入数组，返回一个 `Element` 数组，未找到的元素对应位置为 `null`。

- **示例**:
  ```javascript
  // 获取单个元素，最长等待 3 秒
  const main = await elmGetter.get("#main-content", { timeout: 3000 });
  if (main) {
    console.log("主要内容已加载");
  }

  // 批量获取多个关键元素
  const [header, sidebar, footer] = await elmGetter.get(["#header", ".sidebar", "#footer"]);
  ```

### `each(selector, callback, options?)`

持续处理现在和未来所有匹配选择器的元素。这是一个强大的功能，用于处理动态加载的列表或内容。

- **参数**:
  - `selector`: `string` - CSS/XPath 选择器。
  - `callback`: `function(element, isNew)` - 为每个匹配元素执行的回调函数。
    - `element`: `Element` - 当前处理的元素。
    - `isNew`: `boolean` - 如果元素是动态添加到 DOM 中的，则为 `true`。
    - **如果回调函数返回 `false`，将立即停止整个监听过程。**
  - `options`: `object` (可选)
    - `parent`: `Node` - 监听变化的根节点，默认为 `document`。

- **返回**: `function()` - 一个无参函数，调用它可手动停止监听并释放资源。

- **示例**:
  ```javascript
  // 为所有class为 'product' 的元素添加标记
  const stopObserver = elmGetter.each(".product", (el, isNew) => {
    el.dataset.processed = "true";
    if (isNew) {
      console.log("发现新产品:", el.textContent);
    }
  });

  // 1分钟后自动停止监听
  setTimeout(stopObserver, 60000);
  ```

### `on(eventName, selector, callback, options?)`

使用事件委托模式为现在和未来的元素绑定事件监听器。这比为每个元素单独绑定事件更高效。

- **参数**:
  - `eventName`: `string` - DOM 事件名称 (例如: `'click'`, `'mouseover'`)。
  - `selector`: `string` - 目标元素的选择器。
  - `callback`: `function(event, element)` - 事件触发时的回调函数。
    - `event`: `Event` - 原生事件对象。
    - `element`: `Element` - 匹配选择器并触发事件的元素。
  - `options`: `object` (可选)
    - `parent`: `Node` - 附加事件监听器的根节点，默认为 `document`。

- **返回**: `function()` - 调用此函数可移除事件监听器。

- **示例**:
  ```javascript
  // 当 .delete-button 被点击时，删除其所在的 .row 元素
  const stopDeleteListener = elmGetter.on("click", ".delete-button", (e, btn) => {
    const row = btn.closest(".row");
    if (row) row.remove();
  });

  // 在组件卸载时，可以调用 stopDeleteListener() 来清理。
  ```

### `create(htmlString, options?)`

从 HTML 字符串安全地创建 DOM 元素。

- **参数**:
  - `htmlString`: `string` - 包含单个根元素的 HTML 字符串。
  - `options`: `object` (可选)
    - `parent`: `Element` - 如果提供，创建的元素会自动附加到此父元素。
    - `mapIds`: `boolean` - 如果为 `true`，返回一个以元素 ID 为键、元素为值的对象，默认为 `false`。

- **返回**: `Element | { [id: string]: Element } | null` - 创建的元素、ID 映射对象或 `null`。

- **示例**:
  ```javascript
  // 创建一个简单的 div
  const div = elmGetter.create('<div class="message">Hello</div>');

  // 创建一个 UI 组件并获取其内部元素的引用
  const dialogUI = elmGetter.create(`
    <div id="dialog-root">
      <h3 id="dialogTitle">提示</h3>
      <button id="closeBtn">关闭</button>
    </div>
  `, { mapIds: true });

  dialogUI.dialogTitle.textContent = "操作成功";
  dialogUI.closeBtn.onclick = () => dialogUI['dialog-root'].remove();
  document.body.appendChild(dialogUI['dialog-root']);
  ```

---

## 工具与配置

### `css(cssText, id?)`

向页面注入 CSS 样式。

- **参数**:
  - `cssText`: `string` - CSS 样式规则。
  - `id`: `string` (可选) - 为 `<style>` 标签指定一个 ID。如果页面上已存在该 ID 的元素，则不会重复注入。

- **返回**: `HTMLStyleElement` - 创建或找到的 `<style>` 元素。

### `config(options)`

配置 `elmGetter` 的全局行为，支持链式调用。

- **参数**:
  - `options`: `object` - 配置对象。
    - `selectorMode`: `'css' | 'xpath'` - 设置全局的选择器引擎，默认为 `'css'`。

- **属性**:
  - `currentSelectorMode`: `string` (只读) - 获取当前的选择器模式。

- **示例**:
  ```javascript
  elmGetter.config({ selectorMode: 'xpath' });
  console.log(elmGetter.currentSelectorMode); // 'xpath'
  const el = await elmGetter.get("//div[contains(text(), 'unique text')]");
  elmGetter.config({ selectorMode: 'css' }); // 切换回默认
  ```

## 错误处理

`elmGetter` 的设计倾向于“静默失败”和“优雅降级”，而不是抛出异常中断脚本执行。

- `get()`: 如果超时仍未找到元素，它将返回 `null`（或在批量获取中对应位置为 `null`），而不会抛出错误。这允许您通过简单的条件判断来处理元素不存在的情况。
- `query()`: 如果选择器语法错误，它会在控制台打印错误信息并返回 `null` 或空数组。
- `each()`: 如果回调函数执行出错，它会在控制台打印错误并自动停止监听，以防止后续错误。

## 性能与最佳实践

1.  **优先使用 `each` 和 `on`**: 对于动态内容，`each` 和 `on` 利用了事件委托和 `MutationObserver`，远比使用 `setInterval` 轮询 `get` 高效。
2.  **合理设置 `parent`**: 在 `get`, `each`, `on` 中，如果知道元素会出现在某个特定容器内，请指定 `parent` 选项。这会将 `MutationObserver` 的监听范围缩小到该容器，显著提升性能。
3.  **及时清理**: `each` 和 `on` 方法都返回一个停止函数。当您不再需要监听时（例如，页面切换、组件销毁），务必调用此函数以释放资源，避免内存泄漏。
4.  **谨慎使用 XPath**: 虽然支持 XPath，但通常 CSS 选择器的性能优于 XPath。仅在无法用 CSS 选择器定位元素时才使用 XPath。