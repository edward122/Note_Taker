import React, { useRef, useCallback, useEffect, memo } from "react";

const RichTextEditor = memo(({
  initialContent,
  onChange,
  onBlur,
  nodeId,
  textShadowStyle,
}) => {
  const editorRef = useRef(null);
  const isComposingRef = useRef(false);

  // Initialize content on mount
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialContent || "";
      // Place cursor at end
      try {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        editorRef.current.focus();
      } catch (e) { /* ignore */ }
    }
  }, []); // Only on mount

  const emitChange = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;
    emitChange();
  }, [emitChange]);

  const handleKeyDown = useCallback((e) => {
    // Prevent node-level shortcuts from firing while editing
    e.stopPropagation();

    // Keyboard shortcuts for formatting
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          document.execCommand("bold", false, null);
          break;
        case "i":
          e.preventDefault();
          document.execCommand("italic", false, null);
          break;
        case "u":
          e.preventDefault();
          document.execCommand("underline", false, null);
          break;
        default:
          break;
      }
    }

    // Tab for indent/outdent in lists
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        document.execCommand("outdent", false, null);
      } else {
        document.execCommand("indent", false, null);
      }
    }

    // Enter inside a checklist item — create a new checklist item
    if (e.key === "Enter") {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const node = sel.anchorNode;
        const checkItem = node?.nodeType === 3
          ? node.parentElement?.closest(".rt-checklist-item")
          : node?.closest?.(".rt-checklist-item");
        if (checkItem) {
          e.preventDefault();
          const newItem = document.createElement("div");
          newItem.className = "rt-checklist-item";
          newItem.innerHTML = `<span class="rt-check-box" data-checked="false"></span><span class="rt-checklist-text" contenteditable="true">&ZeroWidthSpace;</span>`;
          checkItem.after(newItem);
          // Move cursor into the new text span
          const textSpan = newItem.querySelector(".rt-checklist-text");
          if (textSpan) {
            const range = document.createRange();
            range.selectNodeContents(textSpan);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          emitChange();
        }
      }
    }

    // Backspace on empty checklist item — remove it
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const node = sel.anchorNode;
        const checkItem = node?.nodeType === 3
          ? node.parentElement?.closest(".rt-checklist-item")
          : node?.closest?.(".rt-checklist-item");
        if (checkItem) {
          const textSpan = checkItem.querySelector(".rt-checklist-text");
          const textContent = textSpan?.textContent?.replace(/\u200B/g, "") || "";
          if (textContent === "") {
            e.preventDefault();
            // Move cursor to previous sibling or parent
            const prev = checkItem.previousElementSibling;
            checkItem.remove();
            if (prev) {
              const prevText = prev.querySelector(".rt-checklist-text") || prev;
              const range = document.createRange();
              range.selectNodeContents(prevText);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
            emitChange();
          }
        }
      }
    }
  }, [emitChange]);

  // Handle checkbox toggle clicks inside the editor
  const handleMouseDown = useCallback((e) => {
    e.stopPropagation(); // Always prevent node drag

    // Check if clicking on a checkbox indicator
    const checkBox = e.target.closest(".rt-check-box");
    if (checkBox) {
      e.preventDefault();
      e.stopPropagation();
      const isChecked = checkBox.getAttribute("data-checked") === "true";
      checkBox.setAttribute("data-checked", isChecked ? "false" : "true");
      
      // Toggle parent's checked class
      const parent = checkBox.closest(".rt-checklist-item");
      if (parent) {
        parent.classList.toggle("rt-checked", !isChecked);
      }
      emitChange();
    }
  }, [emitChange]);

  const handleBlur = useCallback((e) => {
    // Don't blur if clicking the formatting toolbar
    const related = e.relatedTarget;
    if (related && related.closest(".formatting-toolbar")) {
      e.preventDefault();
      editorRef.current?.focus();
      return;
    }
    if (editorRef.current) {
      onBlur(editorRef.current.innerHTML);
    }
  }, [onBlur]);

  return (
    <div
      ref={editorRef}
      className="rt-editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      data-placeholder="Type something..."
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onBlur={handleBlur}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        handleInput();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
        color: "inherit",
        fontSize: "inherit",
        fontFamily: "inherit",
        fontWeight: "inherit",
        fontStyle: "inherit",
        textDecoration: "inherit",
        textAlign: "inherit",
        textShadow: textShadowStyle,
        border: "none",
        outline: "none",
        resize: "none",
        padding: 0,
        margin: 0,
        boxSizing: "border-box",
        overflowY: "auto",
        overflowX: "hidden",
        wordWrap: "break-word",
        whiteSpace: "pre-wrap",
        cursor: "text",
        lineHeight: "1.5",
        minHeight: "100%",
      }}
    />
  );
});

export default RichTextEditor;
