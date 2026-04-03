// ==UserScript==
// @name         ChatGPT Conversation Exporter (Manual + Floating UI)
// @namespace    https://chatgpt.com/
// @version      0.3.0
// @description  Export current ChatGPT conversation to MD/JSON/TXT/PDF.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  var TOOLBAR_ID = "cgpt-export-toolbar";
  var STYLE_ID = "cgpt-export-style";
  var UI_STORAGE_KEY = "cgpt_export_ui_v1";
  var TZ = "Asia/Shanghai";

  var uiState = loadUiState();

  function loadUiState() {
    try {
      var raw = localStorage.getItem(UI_STORAGE_KEY);
      if (!raw) {
        return { collapsed: false };
      }
      var parsed = JSON.parse(raw);
      return {
        collapsed: parsed && parsed.collapsed === true
      };
    } catch (_err) {
      return { collapsed: false };
    }
  }

  function saveUiState() {
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiState));
    } catch (_err) {}
  }

  function hasAncestorMatching(el, selector) {
    var parent = el.parentElement;
    while (parent) {
      if (parent.matches && parent.matches(selector)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function formatTimestampForFilename(date, timeZone) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .formatToParts(date)
      .reduce(function (acc, p) {
        acc[p.type] = p.value;
        return acc;
      }, {});

    return parts.year + parts.month + parts.day + "-" + parts.hour + parts.minute + parts.second;
  }

  function formatIsoInTimezone(date, timeZone) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset"
    }).formatToParts(date);

    var map = {};
    for (var i = 0; i < parts.length; i += 1) {
      map[parts[i].type] = parts[i].value;
    }

    var offsetRaw = map.timeZoneName || "GMT+8";
    var match = offsetRaw.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    var offset = "+08:00";
    if (match) {
      var hour = match[1];
      var minute = match[2] || "00";
      if (hour.length === 2) {
        hour = hour[0] + "0" + hour[1];
      }
      offset = hour + ":" + minute;
    }

    return map.year + "-" + map.month + "-" + map.day + "T" + map.hour + ":" + map.minute + ":" + map.second + offset;
  }

  function slugify(title) {
    var normalized = (title || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || "chat";
  }

  function getConversationTitle() {
    var h1 = document.querySelector("main h1");
    if (h1 && h1.textContent && h1.textContent.trim()) {
      return h1.textContent.trim();
    }
    var pageTitle = document.title || "ChatGPT Conversation";
    pageTitle = pageTitle.replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim();
    return pageTitle || "ChatGPT Conversation";
  }

  function collectMessageNodes() {
    var nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    nodes = nodes.filter(function (node) {
      return !hasAncestorMatching(node, "[data-message-author-role]");
    });
    if (nodes.length > 0) {
      return nodes.map(function (node) {
        return {
          node: node,
          role: node.getAttribute("data-message-author-role") || "unknown"
        };
      });
    }

    var fallback = Array.from(
      document.querySelectorAll(
        "article[data-testid*='conversation-turn'], article[data-testid*='conversation'], main article"
      )
    ).filter(function (node) {
      return !node.closest("article article");
    });

    return fallback.map(function (node, idx) {
      var txt = (node.textContent || "").toLowerCase();
      var role = txt.includes("you said") || txt.includes("you:") || idx % 2 === 0 ? "user" : "assistant";
      return { node: node, role: role };
    });
  }

  function extractTableMarkdown(table) {
    var rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) {
      return "";
    }
    var matrix = rows.map(function (row) {
      return Array.from(row.querySelectorAll("th,td")).map(function (cell) {
        return (cell.innerText || "").trim().replace(/\|/g, "\\|");
      });
    });
    if (matrix[0].length === 0) {
      return "";
    }
    var lines = [];
    lines.push("| " + matrix[0].join(" | ") + " |");
    lines.push("| " + matrix[0].map(function () { return "---"; }).join(" | ") + " |");
    for (var i = 1; i < matrix.length; i += 1) {
      lines.push("| " + matrix[i].join(" | ") + " |");
    }
    return lines.join("\n");
  }

  function extractBlockMarkdown(node) {
    var tag = node.tagName.toLowerCase();

    if (tag === "pre") {
      var codeEl = node.querySelector("code");
      var codeText = codeEl ? codeEl.innerText : node.innerText;
      var lang = "";
      if (codeEl && codeEl.className) {
        var m = codeEl.className.match(/language-([a-z0-9_-]+)/i);
        if (m) {
          lang = m[1];
        }
      }
      return "```" + lang + "\n" + codeText.trimEnd() + "\n```";
    }

    if (tag === "ul" || tag === "ol") {
      var items = Array.from(node.querySelectorAll(":scope > li"));
      if (items.length === 0) {
        return node.innerText.trim();
      }
      return items
        .map(function (li, idx) {
          var prefix = tag === "ol" ? String(idx + 1) + ". " : "- ";
          var text = (li.innerText || "").trim().replace(/\n+/g, " ");
          return prefix + text;
        })
        .join("\n");
    }

    if (tag === "blockquote") {
      return (node.innerText || "")
        .trim()
        .split("\n")
        .map(function (line) {
          return "> " + line.trim();
        })
        .join("\n");
    }

    if (tag === "table") {
      return extractTableMarkdown(node);
    }

    if (/^h[1-6]$/.test(tag)) {
      return "#".repeat(Number(tag[1])) + " " + (node.innerText || "").trim();
    }

    return (node.innerText || "").trim();
  }

  function htmlToMarkdown(node) {
    var clone = node.cloneNode(true);
    clone.querySelectorAll("button,svg,style,script,textarea,input,form").forEach(function (el) {
      el.remove();
    });

    var blockSelector = "h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote";
    var blocks = Array.from(clone.querySelectorAll(blockSelector)).filter(function (el) {
      return !hasAncestorMatching(el, blockSelector);
    });

    if (blocks.length === 0) {
      return (clone.innerText || "").trim();
    }

    return blocks
      .map(function (block) {
        return extractBlockMarkdown(block);
      })
      .filter(function (x) {
        return x && x.trim();
      })
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function makeMessageRecord(msgNode, role, index) {
    var messageId = msgNode.getAttribute("data-message-id") || msgNode.id || "message_" + String(index + 1);
    var timeEl = msgNode.querySelector("time");
    var createdAt = timeEl ? (timeEl.getAttribute("datetime") || null) : null;

    return {
      id: messageId,
      role: role || "unknown",
      created_at: createdAt,
      content_parts: [{ type: "markdown", text: htmlToMarkdown(msgNode) }],
      citations: [],
      attachments: []
    };
  }

  function buildConversationRecord() {
    var items = collectMessageNodes();
    if (!items || items.length === 0) {
      throw new Error("No parseable chat messages found. ChatGPT DOM may have changed.");
    }
    var now = new Date();
    var title = getConversationTitle();
    var messages = items.map(function (x, idx) { return makeMessageRecord(x.node, x.role, idx); }).filter(function (m) {
      var t = m.content_parts[0] && m.content_parts[0].text;
      return t && t.trim();
    });
    if (messages.length === 0) {
      throw new Error("Messages were detected but content extraction failed.");
    }
    return {
      source: "chatgpt_web_dom",
      thread_url: window.location.href,
      title: title,
      exported_at: formatIsoInTimezone(now, TZ),
      messages: messages
    };
  }

  function safeYamlValue(value) {
    var v = String(value == null ? "" : value);
    return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function recordToMarkdown(record) {
    var lines = [];
    lines.push("---");
    lines.push("title: " + safeYamlValue(record.title));
    lines.push("source: " + safeYamlValue(record.source));
    lines.push("thread_url: " + safeYamlValue(record.thread_url));
    lines.push("exported_at: " + safeYamlValue(record.exported_at));
    lines.push("message_count: " + record.messages.length);
    lines.push("---");
    lines.push("");
    lines.push("# " + record.title);
    lines.push("");
    lines.push("## Table of Contents");
    lines.push("");
    for (var i = 0; i < record.messages.length; i += 1) {
      var m = record.messages[i];
      lines.push("- [" + String(i + 1) + ". " + m.role.toUpperCase() + "](#msg-" + String(i + 1) + "-" + m.role.toLowerCase() + ")");
    }
    lines.push("");
    for (var j = 0; j < record.messages.length; j += 1) {
      var msg = record.messages[j];
      lines.push("## <a id=\"msg-" + String(j + 1) + "-" + msg.role.toLowerCase() + "\"></a>" + String(j + 1) + ". " + msg.role.toUpperCase());
      lines.push("");
      if (msg.created_at) {
        lines.push("_Created at: " + msg.created_at + "_");
        lines.push("");
      }
      for (var k = 0; k < msg.content_parts.length; k += 1) {
        lines.push(msg.content_parts[k].text || "");
      }
      lines.push("");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function recordToPlainText(record) {
    var lines = [];
    lines.push("Title: " + record.title);
    lines.push("Source: " + record.source);
    lines.push("Thread URL: " + record.thread_url);
    lines.push("Exported At: " + record.exported_at);
    lines.push("Message Count: " + record.messages.length);
    lines.push("");
    for (var i = 0; i < record.messages.length; i += 1) {
      var msg = record.messages[i];
      lines.push("=== " + String(i + 1) + ". " + msg.role.toUpperCase() + " ===");
      if (msg.created_at) {
        lines.push("Created At: " + msg.created_at);
      }
      lines.push("");
      for (var j = 0; j < msg.content_parts.length; j += 1) {
        lines.push(msg.content_parts[j].text || "");
      }
      lines.push("");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function isSafeHref(href) {
    var x = String(href || "").trim().toLowerCase();
    return x.startsWith("http://") || x.startsWith("https://") || x.startsWith("mailto:") || x.startsWith("#") || x.startsWith("/");
  }

  function sanitizeRenderedHtml(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");

    var allowedTags = {
      H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
      P: true, BR: true, HR: true,
      UL: true, OL: true, LI: true,
      BLOCKQUOTE: true,
      PRE: true, CODE: true,
      TABLE: true, THEAD: true, TBODY: true, TR: true, TH: true, TD: true,
      A: true, STRONG: true, EM: true
    };

    function walk(node) {
      var children = Array.from(node.childNodes);
      for (var i = 0; i < children.length; i += 1) {
        var child = children[i];
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!allowedTags[child.tagName]) {
            var text = document.createTextNode(child.textContent || "");
            node.replaceChild(text, child);
            continue;
          }

          var attrs = Array.from(child.attributes);
          for (var j = 0; j < attrs.length; j += 1) {
            var attr = attrs[j];
            var name = attr.name.toLowerCase();
            if (name.startsWith("on") || name === "style" || name === "src") {
              child.removeAttribute(attr.name);
              continue;
            }
            if (child.tagName === "A" && name === "href") {
              if (!isSafeHref(attr.value)) {
                child.setAttribute("href", "#");
              }
              child.setAttribute("target", "_blank");
              child.setAttribute("rel", "noopener noreferrer");
              continue;
            }
            if (child.tagName === "CODE" && name === "class") {
              continue;
            }
            if (name !== "href" && name !== "class") {
              child.removeAttribute(attr.name);
            }
          }

          walk(child);
        } else if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        }
      }
    }

    walk(tpl.content);
    return tpl.innerHTML;
  }

  function renderInlineMarkdown(text) {
    var escaped = escapeHtml(text);
    var tokens = [];
    escaped = escaped.replace(/`([^`]+)`/g, function (_m, code) {
      var id = "__CODE_TOKEN_" + tokens.length + "__";
      tokens.push("<code>" + code + "</code>");
      return id;
    });

    escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, label, href) {
      var safeHref = isSafeHref(href) ? href : "#";
      return "<a href=\"" + safeHref + "\">" + label + "</a>";
    });
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    escaped = escaped.replace(/__CODE_TOKEN_(\d+)__/g, function (_m, idx) {
      var n = Number(idx);
      return tokens[n] || "";
    });
    return escaped;
  }

  function isTableSeparator(line) {
    var x = String(line || "").trim();
    return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(x);
  }

  function splitTableRow(line) {
    var x = String(line || "").trim();
    if (x.startsWith("|")) x = x.slice(1);
    if (x.endsWith("|")) x = x.slice(0, -1);
    return x.split("|").map(function (c) { return c.trim(); });
  }

  function renderTable(lines, startIdx) {
    if (startIdx + 1 >= lines.length) return null;
    if (lines[startIdx].indexOf("|") === -1) return null;
    if (!isTableSeparator(lines[startIdx + 1])) return null;

    var header = splitTableRow(lines[startIdx]);
    var rows = [];
    var i = startIdx + 2;
    while (i < lines.length && lines[i].indexOf("|") !== -1 && String(lines[i]).trim() !== "") {
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }

    var thead = "<thead><tr>" + header.map(function (h) { return "<th>" + renderInlineMarkdown(h) + "</th>"; }).join("") + "</tr></thead>";
    var tbody = "<tbody>" + rows.map(function (r) {
      return "<tr>" + r.map(function (c) { return "<td>" + renderInlineMarkdown(c) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    return { html: "<table>" + thead + tbody + "</table>", next: i };
  }

  function renderMarkdownBlocks(markdown) {
    var lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    var out = [];
    var i = 0;

    function isListStart(line) {
      return /^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(line);
    }

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        var lang = trimmed.replace(/^```/, "").trim();
        var codeLines = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        out.push("<pre><code" + (lang ? " class=\"lang-" + escapeHtml(lang) + "\"" : "") + ">" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
        continue;
      }

      var table = renderTable(lines, i);
      if (table) {
        out.push(table.html);
        i = table.next;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        out.push("<blockquote>" + renderMarkdownBlocks(quoteLines.join("\n")) + "</blockquote>");
        continue;
      }

      var h = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        var level = h[1].length;
        out.push("<h" + level + ">" + renderInlineMarkdown(h[2]) + "</h" + level + ">");
        i += 1;
        continue;
      }

      if (isListStart(trimmed)) {
        var ordered = /^\s*\d+\.\s+/.test(trimmed);
        var tag = ordered ? "ol" : "ul";
        var lis = [];
        while (i < lines.length && isListStart(lines[i])) {
          var item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
          lis.push("<li>" + renderInlineMarkdown(item) + "</li>");
          i += 1;
        }
        out.push("<" + tag + ">" + lis.join("") + "</" + tag + ">");
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        out.push("<hr>");
        i += 1;
        continue;
      }

      var para = [trimmed];
      i += 1;
      while (i < lines.length) {
        var n = lines[i].trim();
        if (!n || /^```/.test(n) || /^>\s?/.test(n) || /^(#{1,6})\s+/.test(n) || isListStart(n) || /^---+$/.test(n)) {
          break;
        }
        var maybeTable = renderTable(lines, i);
        if (maybeTable) break;
        para.push(n);
        i += 1;
      }
      out.push("<p>" + renderInlineMarkdown(para.join(" ")) + "</p>");
    }

    return out.join("\n");
  }

  function renderMarkdownToSafeHtml(markdown) {
    return sanitizeRenderedHtml(renderMarkdownBlocks(markdown));
  }

  function recordToPrintableHtml(record) {
    var sections = [];
    sections.push("<h1>" + escapeHtml(record.title) + "</h1>");
    sections.push("<p class='meta'><strong>Source:</strong> " + escapeHtml(record.source) + "<br><strong>Thread URL:</strong> " + escapeHtml(record.thread_url) + "<br><strong>Exported At:</strong> " + escapeHtml(record.exported_at) + "</p>");
    for (var i = 0; i < record.messages.length; i += 1) {
      var msg = record.messages[i];
      var content = "";
      for (var j = 0; j < msg.content_parts.length; j += 1) {
        content += msg.content_parts[j].text || "";
        if (j < msg.content_parts.length - 1) {
          content += "\n\n";
        }
      }
      var bodyHtml = renderMarkdownToSafeHtml(content);
      sections.push("<section class='msg-block'><h2>" + String(i + 1) + ". " + escapeHtml(msg.role.toUpperCase()) + "</h2>" + (msg.created_at ? "<p class='meta'><em>Created at: " + escapeHtml(msg.created_at) + "</em></p>" : "") + "<div class='md-content'>" + bodyHtml + "</div></section>");
    }
    return "<!doctype html><html><head><meta charset='utf-8'><title>" + escapeHtml(record.title) + "</title><style>" +
      "body{font-family:'Segoe UI',Arial,sans-serif;color:#111;padding:24px;max-width:980px;margin:0 auto;line-height:1.55;}" +
      "h1{margin:0 0 14px;}h2{margin:0 0 8px;font-size:18px;}h3,h4,h5,h6{margin:14px 0 8px;}" +
      ".meta{color:#475569;font-size:12px;margin:0 0 12px;}" +
      ".msg-block{margin:0 0 22px;padding:12px 12px 4px;border:1px solid #e2e8f0;border-radius:10px;page-break-inside:avoid;background:#fff;}" +
      ".md-content p{margin:8px 0;}" +
      ".md-content ul,.md-content ol{margin:8px 0 10px 20px;padding:0;}" +
      ".md-content li{margin:4px 0;}" +
      ".md-content blockquote{margin:10px 0;padding:8px 12px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;}" +
      ".md-content pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;line-height:1.45;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;overflow:auto;}" +
      ".md-content code{font-family:ui-monospace,Consolas,monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px;}" +
      ".md-content pre code{background:transparent;padding:0;border-radius:0;}" +
      ".md-content table{width:100%;border-collapse:collapse;margin:10px 0 12px;font-size:13px;}" +
      ".md-content th,.md-content td{border:1px solid #e2e8f0;padding:6px 8px;vertical-align:top;text-align:left;}" +
      ".md-content th{background:#f8fafc;font-weight:600;}" +
      ".md-content a{color:#2563eb;text-decoration:underline;word-break:break-all;}" +
      ".md-content hr{border:none;border-top:1px solid #e2e8f0;margin:14px 0;}" +
      "</style></head><body>" + sections.join("\n") + "</body></html>";
  }

  function downloadText(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 3000);
  }

  function buildFilenameBase(record) {
    return formatTimestampForFilename(new Date(), TZ) + "__" + slugify(record.title);
  }

  function setStatus(text, isError) {
    var status = document.querySelector("#cgpt-export-status");
    if (!status) {
      return;
    }
    status.textContent = text;
    status.style.color = isError ? "#b91c1c" : "#334155";
  }

  function printHtmlWithHiddenFrame(html) {
    return new Promise(function (resolve, reject) {
      try {
        var iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.setAttribute("aria-hidden", "true");
        iframe.onload = function () {
          try {
            var win = iframe.contentWindow;
            if (!win) throw new Error("Print frame unavailable.");
            setTimeout(function () {
              try {
                win.focus();
                win.print();
                setTimeout(function () {
                  iframe.remove();
                }, 2000);
                resolve();
              } catch (err) {
                iframe.remove();
                reject(err);
              }
            }, 80);
          } catch (err) {
            iframe.remove();
            reject(err);
          }
        };
        document.body.appendChild(iframe);
        var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!doc) {
          iframe.remove();
          reject(new Error("Print document unavailable."));
          return;
        }
        doc.open();
        doc.write(html);
        doc.close();
      } catch (err) {
        reject(err);
      }
    });
  }

  function exportJson() {
    try {
      var record = buildConversationRecord();
      var file = buildFilenameBase(record) + ".json";
      downloadText(JSON.stringify(record, null, 2), file, "application/json;charset=utf-8");
      setStatus("JSON exported: " + file, false);
    } catch (err) {
      alert("[Chat Exporter] " + err.message);
      setStatus(err.message, true);
    }
  }

  function exportMarkdown() {
    try {
      var record = buildConversationRecord();
      var md = recordToMarkdown(record);
      var file = buildFilenameBase(record) + ".md";
      downloadText(md, file, "text/markdown;charset=utf-8");
      setStatus("Markdown exported: " + file, false);
    } catch (err) {
      alert("[Chat Exporter] " + err.message);
      setStatus(err.message, true);
    }
  }

  function exportTxt() {
    try {
      var record = buildConversationRecord();
      var txt = recordToPlainText(record);
      var file = buildFilenameBase(record) + ".txt";
      downloadText(txt, file, "text/plain;charset=utf-8");
      setStatus("TXT exported: " + file, false);
    } catch (err) {
      alert("[Chat Exporter] " + err.message);
      setStatus(err.message, true);
    }
  }

  function exportPdf() {
    try {
      var record = buildConversationRecord();
      var html = recordToPrintableHtml(record);
      printHtmlWithHiddenFrame(html)
        .then(function () {
          setStatus("PDF print dialog opened (Save as PDF).", false);
        })
        .catch(function () {
          var fallbackFile = buildFilenameBase(record) + ".pdf-print.html";
          downloadText(html, fallbackFile, "text/html;charset=utf-8");
          setStatus("Print blocked. Downloaded HTML fallback: " + fallbackFile + " (open it and Ctrl+P).", true);
        });
    } catch (err) {
      alert("[Chat Exporter] " + err.message);
      setStatus(err.message, true);
    }
  }

  function updateToolbarVisualState() {
    var root = document.getElementById(TOOLBAR_ID);
    if (!root) return;
    root.classList.toggle("cgpt-collapsed", !!uiState.collapsed);
    var collapseBtn = root.querySelector("#cgpt-export-collapse");
    if (collapseBtn) {
      collapseBtn.textContent = uiState.collapsed ? "<" : ">";
      collapseBtn.title = uiState.collapsed ? "Expand" : "Collapse";
    }
  }

  function toggleCollapse() {
    uiState.collapsed = !uiState.collapsed;
    saveUiState();
    updateToolbarVisualState();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ":root {",
      "  --cgpt-panel-bg: rgba(248, 250, 252, 0.88);",
      "  --cgpt-panel-border: rgba(15, 23, 42, 0.10);",
      "  --cgpt-panel-shadow: 0 14px 34px rgba(15, 23, 42, 0.14);",
      "  --cgpt-text-primary: #0f172a;",
      "  --cgpt-text-muted: #334155;",
      "  --cgpt-btn-bg: rgba(255, 255, 255, 0.92);",
      "  --cgpt-btn-border: rgba(15, 23, 42, 0.12);",
      "  --cgpt-btn-hover: rgba(241, 245, 249, 0.98);",
      "  --cgpt-accent: #2563eb;",
      "}",
      "#" + TOOLBAR_ID + " {",
      "  position: fixed;",
      "  top: 50%;",
      "  right: 18px;",
      "  transform: translateY(-50%);",
      "  z-index: 2147483647;",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 8px;",
      "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
      "}",
      "#" + TOOLBAR_ID + " .cgpt-export-collapse {",
      "  width: 30px;",
      "  height: 84px;",
      "  border: 1px solid var(--cgpt-btn-border);",
      "  border-radius: 999px;",
      "  background: var(--cgpt-btn-bg);",
      "  color: var(--cgpt-text-primary);",
      "  cursor: pointer;",
      "  backdrop-filter: blur(10px);",
      "  font-size: 13px;",
      "  font-weight: 700;",
      "  transition: background 160ms ease, transform 160ms ease, border-color 160ms ease;",
      "}",
      "#" + TOOLBAR_ID + " .cgpt-export-collapse:hover {",
      "  background: var(--cgpt-btn-hover);",
      "  border-color: rgba(15, 23, 42, 0.18);",
      "}",
      "#" + TOOLBAR_ID + " .cgpt-export-collapse:focus-visible {",
      "  outline: 2px solid var(--cgpt-accent);",
      "  outline-offset: 2px;",
      "}",
      "#" + TOOLBAR_ID + " .cgpt-export-panel {",
      "  min-width: 220px;",
      "  max-width: 244px;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 9px;",
      "  padding: 12px;",
      "  border-radius: 16px;",
      "  border: 1px solid var(--cgpt-panel-border);",
      "  background: var(--cgpt-panel-bg);",
      "  box-shadow: var(--cgpt-panel-shadow);",
      "  backdrop-filter: blur(14px);",
      "  transition: transform 180ms ease, opacity 180ms ease;",
      "}",
      "#" + TOOLBAR_ID + ".cgpt-collapsed .cgpt-export-panel {",
      "  display: none;",
      "}",
      "#" + TOOLBAR_ID + " .cgpt-export-title {",
      "  color: var(--cgpt-text-primary);",
      "  font-size: 12px;",
      "  letter-spacing: 0.02em;",
      "  font-weight: 600;",
      "}",
      "#" + TOOLBAR_ID + " .cgpt-export-actions {",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 7px;",
      "}",
      "#" + TOOLBAR_ID + " button.cgpt-btn {",
      "  width: 100%;",
      "  border: 1px solid var(--cgpt-btn-border);",
      "  border-radius: 10px;",
      "  padding: 8px 10px;",
      "  font-size: 12px;",
      "  font-weight: 600;",
      "  cursor: pointer;",
      "  color: var(--cgpt-text-primary);",
      "  text-align: center;",
      "  background: var(--cgpt-btn-bg);",
      "  transition: background 160ms ease, transform 140ms ease, border-color 160ms ease;",
      "}",
      "#" + TOOLBAR_ID + " button.cgpt-btn:hover {",
      "  background: var(--cgpt-btn-hover);",
      "  border-color: rgba(15, 23, 42, 0.18);",
      "}",
      "#" + TOOLBAR_ID + " button.cgpt-btn:active {",
      "  transform: translateY(1px);",
      "}",
      "#" + TOOLBAR_ID + " button.cgpt-btn:focus-visible {",
      "  outline: 2px solid var(--cgpt-accent);",
      "  outline-offset: 2px;",
      "}",
      "#cgpt-export-md { border-color: rgba(37, 99, 235, 0.35); color: #1d4ed8; }",
      "#cgpt-export-json { border-color: rgba(15, 118, 110, 0.35); color: #0f766e; }",
      "#cgpt-export-txt { border-color: rgba(71, 85, 105, 0.35); color: #334155; }",
      "#cgpt-export-pdf { border-color: rgba(185, 28, 28, 0.35); color: #b91c1c; }",
      "#cgpt-export-status {",
      "  font-size: 11px;",
      "  line-height: 1.35;",
      "  word-break: break-word;",
      "  color: var(--cgpt-text-muted);",
      "}",
      "@media (max-width: 900px) {",
      "  #" + TOOLBAR_ID + " {",
      "    top: auto;",
      "    right: 10px;",
      "    bottom: 10px;",
      "    transform: none;",
      "  }",
      "  #" + TOOLBAR_ID + " .cgpt-export-collapse { height: 36px; width: 36px; }",
      "  #" + TOOLBAR_ID + " .cgpt-export-panel { min-width: 210px; max-width: 220px; }",
      "}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function injectToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    var root = document.createElement("div");
    root.id = TOOLBAR_ID;
    root.innerHTML =
      "<button class='cgpt-export-collapse' id='cgpt-export-collapse' type='button' title='Collapse'>></button>" +
      "<div class='cgpt-export-panel'>" +
      "<div class='cgpt-export-title'>Chat Export</div>" +
      "<div class='cgpt-export-actions'>" +
      "<button class='cgpt-btn' id='cgpt-export-md' type='button'>Export MD</button>" +
      "<button class='cgpt-btn' id='cgpt-export-json' type='button'>Export JSON</button>" +
      "<button class='cgpt-btn' id='cgpt-export-txt' type='button'>Export TXT</button>" +
      "<button class='cgpt-btn' id='cgpt-export-pdf' type='button'>Export PDF</button>" +
      "</div>" +
      "<div id='cgpt-export-status'>Ready</div>" +
      "</div>";
    document.body.appendChild(root);

    root.querySelector("#cgpt-export-md").addEventListener("click", exportMarkdown);
    root.querySelector("#cgpt-export-json").addEventListener("click", exportJson);
    root.querySelector("#cgpt-export-txt").addEventListener("click", exportTxt);
    root.querySelector("#cgpt-export-pdf").addEventListener("click", exportPdf);
    root.querySelector("#cgpt-export-collapse").addEventListener("click", toggleCollapse);
    updateToolbarVisualState();
  }

  function boot() {
    injectStyle();
    injectToolbar();
    updateToolbarVisualState();
  }

  var bootTimer = setInterval(function () {
    if (!document.body || !document.head) return;
    boot();
    clearInterval(bootTimer);
  }, 500);

  var observer = new MutationObserver(function () {
    if (!document.getElementById(TOOLBAR_ID)) {
      boot();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
