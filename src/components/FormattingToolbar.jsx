import React, { memo, useCallback, useState, useEffect } from "react";

const TOOLBAR_BUTTONS = [
  { command: "bold", icon: "B", title: "Bold (Ctrl+B)", style: { fontWeight: "bold" } },
  { command: "italic", icon: "I", title: "Italic (Ctrl+I)", style: { fontStyle: "italic" } },
  { command: "underline", icon: "U", title: "Underline (Ctrl+U)", style: { textDecoration: "underline" } },
  { command: "strikeThrough", icon: "S", title: "Strikethrough", style: { textDecoration: "line-through" } },
  { type: "divider" },
  { command: "insertUnorderedList", icon: "•", title: "Bullet List", style: { fontSize: "18px", lineHeight: "14px" } },
  { command: "insertOrderedList", icon: "1.", title: "Numbered List", style: { fontSize: "13px", fontWeight: "600" } },
  { command: "checklist", icon: "☑", title: "Checklist", style: { fontSize: "15px" }, custom: true },
  { type: "divider" },
  { command: "formatBlock_h1", icon: "H1", title: "Heading 1", style: { fontSize: "12px", fontWeight: "800" }, custom: true },
  { command: "formatBlock_h2", icon: "H2", title: "Heading 2", style: { fontSize: "12px", fontWeight: "700" }, custom: true },
  { command: "formatBlock_h3", icon: "H3", title: "Heading 3", style: { fontSize: "12px", fontWeight: "600" }, custom: true },
  { command: "formatBlock_p", icon: "¶", title: "Normal Text", style: { fontSize: "14px" }, custom: true },
];

const FormattingToolbar = memo(({ nodeId, nodeX, nodeY, zoom, pan }) => {
  const [activeFormats, setActiveFormats] = useState(new Set());

  // Poll active formatting state
  useEffect(() => {
    const checkFormats = () => {
      const formats = new Set();
      try {
        if (document.queryCommandState("bold")) formats.add("bold");
        if (document.queryCommandState("italic")) formats.add("italic");
        if (document.queryCommandState("underline")) formats.add("underline");
        if (document.queryCommandState("strikeThrough")) formats.add("strikeThrough");
        if (document.queryCommandState("insertUnorderedList")) formats.add("insertUnorderedList");
        if (document.queryCommandState("insertOrderedList")) formats.add("insertOrderedList");
      } catch (e) { /* ignore */ }
      setActiveFormats(formats);
    };

    const interval = setInterval(checkFormats, 250);
    document.addEventListener("selectionchange", checkFormats);
    return () => {
      clearInterval(interval);
      document.removeEventListener("selectionchange", checkFormats);
    };
  }, []);

  const execCommand = useCallback((command) => {
    // Keep focus on the contentEditable
    if (command.startsWith("formatBlock_")) {
      const tag = command.replace("formatBlock_", "");
      document.execCommand("formatBlock", false, `<${tag}>`);
    } else if (command === "checklist") {
      insertChecklist();
    } else {
      document.execCommand(command, false, null);
    }
  }, []);

  const insertChecklist = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    // Create a checklist item using spans (not input, which breaks in contentEditable)
    const checklistHtml = `<div class="rt-checklist-item"><span class="rt-check-box" data-checked="false" contenteditable="false"></span><span class="rt-checklist-text">&ZeroWidthSpace;</span></div>`;
    document.execCommand("insertHTML", false, checklistHtml);
  }, []);

  // Position: above the node, in screen space
  const screenX = nodeX * zoom + pan.x;
  const screenY = nodeY * zoom + pan.y;

  return (
    <div
      className="formatting-toolbar"
      style={{
        position: "fixed",
        left: `${screenX}px`,
        top: `${screenY - 52}px`,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "6px 8px",
        borderRadius: "10px",
        background: "rgba(30, 30, 30, 0.92)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        animation: "toolbarSlideIn 0.15s ease-out",
        userSelect: "none",
      }}
      onMouseDown={(e) => {
        e.preventDefault(); // Prevent stealing focus from editor
        e.stopPropagation();
      }}
    >
      {TOOLBAR_BUTTONS.map((btn, i) => {
        if (btn.type === "divider") {
          return (
            <div
              key={`divider-${i}`}
              style={{
                width: "1px",
                height: "22px",
                backgroundColor: "rgba(255, 255, 255, 0.12)",
                margin: "0 3px",
              }}
            />
          );
        }

        const isActive = activeFormats.has(btn.command);

        return (
          <button
            key={btn.command}
            title={btn.title}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              execCommand(btn.command);
            }}
            style={{
              width: "30px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              backgroundColor: isActive
                ? "rgba(136, 150, 221, 0.35)"
                : "transparent",
              color: isActive ? "#a8b4f0" : "rgba(255, 255, 255, 0.75)",
              transition: "all 0.12s ease",
              fontSize: "14px",
              fontFamily: "'Inter', 'SF Pro Text', -apple-system, sans-serif",
              padding: 0,
              margin: 0,
              outline: "none",
              boxShadow: "none",
              ...btn.style,
            }}
          >
            {btn.icon}
          </button>
        );
      })}
    </div>
  );
});

export default FormattingToolbar;
