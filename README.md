# Tampermonkey 脚本集

> 这是一个按站点和用途分类的 Tampermonkey 脚本仓库，覆盖 B 站增强、Discourse 内容处理、GitHub 页面增强，以及一些通用辅助工具。

## 仓库概览

- `BiliBili/`：B 站画质、下载和播放增强
- `Discourse/`：Discourse / Linux.do 内容转换、访问修复、HTML 预览和自动化
- `Github/`：GitHub 页面增强与信息可视化
- `Tool/`：通用辅助脚本

## 目录

- [精选脚本](#精选脚本)
- [脚本清单](#脚本清单)

## 仓库结构

```text
.
├── BiliBili/
├── Discourse/
├── Github/
├── Tool/
├── .images/
├── .shared/
└── README.md
```

## 精选脚本

### Discourse Raw → Markdown Copier

![Discourse 帖子工具栏中的 Markdown 复制按钮](.images/Discourse/Discourse-Raw-Markdown/linux-do-topic-copy.png)

从 Discourse Raw API 获取原始内容并转换为标准 Markdown，适合整理帖子、迁移内容和二次发布。

### GitHub Toolbar Boost

![GitHub 仓库顶部工具栏增强按钮](.images/Github/GitHubToolbarBoost/github-toolbar-boost.png)

为 GitHub 仓库顶部工具栏补充快捷入口，例如 GitHub.dev、DeepWiki、CodeWiki、ZreadAi。

### GitHub Freshness

![GitHub 仓库新鲜度标签效果](.images/Github/GitHubToolbarBoost/github-toolbar-boost-1.png)

为仓库文件列表和时间组件添加“新鲜度”标签，便于快速识别近期活跃与陈旧内容。

## 脚本清单

### BiliBili

| 脚本 | 作用 | 亮点 |
| --- | --- | --- |
| [`BiliQualityPlus.user.js`](BiliBili/BiliQualityPlus.user.js) | B 站画质增强与解锁 | 自动切换最高画质，支持大会员画质试用续期，带独立设置面板 |
| [`BiliVideoDownloader.user.js`](BiliBili/BiliVideoDownloader.user.js) | B 站视频/番剧/课程解析下载 | 支持 dash / flv / mp4、字幕/弹幕下载，以及 aria2 RPC / 命令 / Blob 下载 |

### Discourse

| 脚本 | 作用 | 亮点 |
| --- | --- | --- |
| [`Discourse-HTML-Markdown.user.js`](Discourse/Discourse-HTML-Markdown.user.js) | 通用 Discourse HTML → Markdown | 处理标题、引用、列表、图片、详情块、投票等常见结构 |
| [`Discourse-HTML-Preview.user.js`](Discourse/Discourse-HTML-Preview.user.js) | HTML 代码块预览 | 通过独立预览页执行 HTML/JS，绕开站点 CSP 对 Blob 预览的限制 |
| [`Discourse-Raw-Markdown.user.js`](Discourse/Discourse-Raw-Markdown.user.js) | Discourse Raw → Markdown | 基于 Raw API 的复制工具，支持图片修复、BBCode 转换和链接美化 |
| [`LinuxDo-AccessFixes.user.js`](Discourse/LinuxDo-AccessFixes.user.js) | Linux.do 访问修复 | 自动跳转 challenge，并补充中键打开相关的 track-view 计数 |
| ~~[`LinuxDo-InviteLink-Idle.user.js`](Discourse/LinuxDo-InviteLink-Idle.user.js)~~ | Linux.do 邀请码挂机生成 | 24h 仅生成一次，限流/异常自动冷却，成功后自动复制链接 |

### GitHub

| 脚本 | 作用 | 亮点 |
| --- | --- | --- |
| [`GitHubFileListCollapser.user.js`](Github/GitHubFileListCollapser.user.js) | 仓库文件列表折叠按钮 | 在仓库文件表格上提供全局折叠/展开 |
| [`GitHubFreshness.user.js`](Github/GitHubFreshness.user.js) | GitHub 时间新鲜度标记 | 给 relative-time 等组件添加状态标签，自动适配主题 |
| [`GitHubToolbarBoost.user.js`](Github/GitHubToolbarBoost.user.js) | GitHub 顶部工具栏增强 | 在顶部和仓库工具栏加入常用快捷入口 |

### 工具类

| 脚本 | 作用 | 亮点 |
| --- | --- | --- |
| [`AccountSnapshotSync.user.js`](Tool/AccountSnapshotSync.user.js) | 基于 WebDAV 的账户快照同步 | 自动备份 Cookie + Storage，支持多设备同步与冲突处理 |
| [`AIAutoCaptcha.user.js`](Tool/AIAutoCaptcha.user.js) | AI 自动识别验证码 | 支持 OpenAI / Gemini，文本验证码自动处理，图片可按住 Alt + 点击强制识别 |
| [`FocusStealth.user.js`](Tool/FocusStealth.user.js) | 前台检测拦截与伪装可见 | 精准拦截 visibilitychange / blur / focusout / pagehide 等事件 |
