[English](README.md) | [简体中文](README.zh-CN.md)

# ChatGPT Conversation Exporter（Tampermonkey）

将**当前打开的 ChatGPT 对话**从网页导出为 Markdown、JSON、TXT 或 PDF。

## 功能

- 页面右侧提供可折叠的悬浮工具栏。
- 一键导出为：
  - `Export MD`
  - `Export JSON`
  - `Export TXT`
  - `Export PDF`
- 内置导出设置（保存到 `localStorage`）：
  - `Include metadata`（默认开启）
  - `Expand citations`（默认开启）
- PDF 导出使用隐藏打印框架；如果浏览器阻止打印，直接重试导出即可。
- 全程本地处理，不会上传到任何服务器。

## 安装

1. 在浏览器安装 Tampermonkey。
2. 新建一个 userscript。
3. 粘贴 [`userscript/chatgpt-exporter.user.js`](userscript/chatgpt-exporter.user.js) 的内容。
4. 打开 ChatGPT 对话页面（`https://chatgpt.com/c/...`），使用悬浮导出工具栏。

## 使用

1. 打开目标对话页面。
2. 点击所需格式的导出按钮。
3. 脚本会在浏览器中直接下载文件。
4. PDF 导出说明：
   - 如果正常弹出打印，选择“保存为 PDF”。
   - 如果打印被拦截，重新点击 `Export PDF` 再试一次。

## 导出数据模型

JSON 导出结构如下：

```json
{
  "source": "chatgpt_web_dom",
  "thread_url": "https://chatgpt.com/c/...",
  "title": "Example",
  "exported_at": "2026-03-26T20:15:00+08:00",
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "created_at": "2026-03-26T20:14:00+08:00",
      "content_parts": [
        { "type": "markdown", "text": "Hello" }
      ],
      "citations": [],
      "attachments": []
    }
  ]
}
```

## 注意事项

- 如果页面里没有可解析的消息节点，脚本会明确提示，而不是导出不完整内容。
- ChatGPT 页面结构变更后，DOM 选择器可能需要更新。
