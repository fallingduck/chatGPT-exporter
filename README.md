[English](README.md) | [简体中文](README.zh-CN.md)

# ChatGPT Conversation Exporter (Tampermonkey)

Export the **currently opened ChatGPT conversation** from the web UI to Markdown, JSON, TXT, or PDF.

## Features

- Floating, collapsible toolbar on the right side of the page.
- One-click export to:
  - `Export MD`
  - `Export JSON`
  - `Export TXT`
  - `Export PDF`
- Built-in export settings (persisted in `localStorage`):
  - `Include metadata` (default: on)
  - `Expand citations` (default: on)
- PDF export uses a hidden print frame. If printing is blocked, retry export.
- Local-only workflow: no upload to any server.

## Install

1. Install Tampermonkey in your browser.
2. Create a new userscript.
3. Paste the content of [`userscript/chatgpt-exporter.user.js`](userscript/chatgpt-exporter.user.js).
4. Open a ChatGPT conversation (`https://chatgpt.com/c/...`), then use the floating export toolbar.

## Usage

1. Open the target conversation page.
2. Click the export button for the format you need.
3. The script downloads the file directly in your browser.
4. For PDF:
   - If print opens normally, choose "Save as PDF".
   - If print is blocked, run `Export PDF` again.

## Export Data Model

JSON export uses this shape:

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

## Notes

- If no parseable message nodes are found, the script shows an explicit warning instead of exporting incomplete content.
- DOM selectors may need updates after ChatGPT UI changes.
