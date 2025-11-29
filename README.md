<h1 align="center">WeRead Export</h1>
<div align="center">
一键导出微信读书笔记

![](https://raw.githubusercontent.com/haossr/weread-export/main/wiki/app.png)

</div>

# 功能

- [x] 显示带笔记的书籍列表
- [x] 一键导出笔记（Markdown / JSON / CSV，自动合并单文件）
- [x] 导出包含封面、作者、评分、章节、划线、想法、阅读时长等字段
- [x] 登录状态自动检测，未登录自动跳转并关闭弹窗
- [ ] 导出笔记图片
- [ ] 支持 Firefox、Chrome 商店下载

## 导出格式说明

- Markdown：合并单文件，含封面、章节和划线/想法
- JSON：去规范化，单条笔记一行，含书籍信息、章节、阅读时间等
- CSV：去规范化，单条笔记一行，便于表格处理

## 一键导出示例（Markdown）

![](https://raw.githubusercontent.com/haossr/weread-export/main/wiki/note-demo.png)

# 安装

## 1. Chrome 商店安装

[链接](https://chrome.google.com/webstore/detail/weread-export/pfdngabomfljjilophohpifglnodhhnh?hl=zh-CN&authuser=0)

需要翻墙，可以自动更新

## 2. 手动安装

1. clone 仓库

```
git clone https://github.com/haossr/weread-export.git
```

2. Chrome 浏览器访问 [chrome://extensions/](chrome://extensions/)，打开右上角开发者模式，拖入仓库文件到此界面。

> 使用 git pull 更新

# 源码开发

## API 文档

[在线 API 文档](https://www.eolink.com/share/index?shareCode=65wWvE)
![](https://raw.githubusercontent.com/haossr/weread-export/main/wiki/eolink.png)

## 安装依赖

```
pnpm install
```

## 运行

```
pnpm dev
```

## 打包

```
pnpm build
```
