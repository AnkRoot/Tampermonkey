# elmGetter 简明指南

## 核心 API

- `get(selector, parent?, timeout?)`: 异步获取元素
- `each(selector, parent?, callback)`: 遍历并监听元素，返回一个可停止监听的函数
- `create(domString, returnList?, parent?)`: 创建 DOM 元素
- `selector(mode)`: 设置选择器模式(css/xpath)

## 快速使用

```js
// 异步获取元素
elmGetter.get('#myElement').then(el => console.log(el));
elmGetter.get(['#el1', '.class2']).then(([el1, el2]) => {
  /* ... */
});

// 设置超时和父元素
const parent = document.querySelector('.container');
elmGetter.get('.child', parent, 5000).then(el => {
  // 5秒后仍未找到元素时返回null
  if (el) console.log('找到元素');
});

// 遍历元素(包括新添加的)
elmGetter.each('p', el => (el.style.color = 'blue'));
elmGetter.each('.item', container, (el, isNew) => {
  // isNew为true表示新添加的元素
  // 返回false可停止遍历
});

// 停止监听
const stopEach = elmGetter.each('.log', console.log);
// ... 在需要的时候调用
stopEach();

// 创建元素
const div = elmGetter.create('<div>Hello</div>');
const list = elmGetter.create('<div id="main"><p id="text"></p></div>', true);
// list包含: list[0]=div元素, list.main=div元素, list.text=p元素

// 设置选择器模式
elmGetter.selector('css'); // 默认
elmGetter.selector('xpath');
console.log(elmGetter.currentSelector); // 获取当前模式
```

## 高级用法

- **获取元素**: 自动等待元素出现，支持 CSS 和 XPath 选择器
- **批量获取**: 可用数组同时获取多个元素 `['#id1', '.class2', 'xpath://div']`
- **元素监听**: `each()`可自动监听新添加的匹配元素
- **元素创建**: 使用`returnList=true`可快速访问带 ID 的子元素
- **XPath**: 使用`selector('xpath')`切换到 XPath 模式进行更复杂的选择

## 参数说明

- `selector`: 选择器字符串或数组
- `parent`: 父元素(可选，默认 document)
- `timeout`: 超时毫秒(0=无限等待)
- `callback`: 函数(element, isNewlyAdded) => void
- `mode`: 'css'或'xpath'
