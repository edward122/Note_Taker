import React, { memo, useRef, useCallback } from "react";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "./constants";
import RichTextEditor from "./RichTextEditor";

const MindMapNode = memo(({
  node,
  zoom,
  groupDelta,
  isHighlighted,
  currentUserEmail,
  selectedNodeSet,
  editingNodeId,
  editedText,
  handleResizeMouseDown,
  handleNodeClick,
  handleDoubleClick,
  handleTyping,
  handleTextBlur,
  setEditedText,
  setHoveredNodeId,
  linkingSource,
  onStart,
  onDrag,
  onStop,
  hoveredNodeId,
  lowDetail,
  updateNodeText,
}) => {
  const isDraggingRef = useRef(false);

  // Determine if node is selected or hovered.
  const isSelected = selectedNodeSet.has(node.id);
  const isHovered = hoveredNodeId === node.id;
  
  // Calculate average dimensions for scaling effects.
  const nodeWidth = node.width || DEFAULT_WIDTH;
  const nodeHeight = node.height || DEFAULT_HEIGHT;
  const averageDimension = (nodeWidth + nodeHeight) / 2;

  // Calculate effective position for group dragging.
  const effectiveX = isSelected ? node.x + groupDelta.x : node.x;
  const effectiveY = isSelected ? node.y + groupDelta.y : node.y;

  // Pointer-based drag handler replacing react-draggable
  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return; // Left click only
    if (editingNodeId === node.id) return; // Don't drag while editing

    // Call parent onStart
    const shouldContinue = onStart(e, { x: effectiveX, y: effectiveY });
    if (shouldContinue === false) return;

    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      onDrag(moveEvent, { x: 0, y: 0 });
    };

    const handlePointerUp = (upEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      onStop(upEvent, { x: 0, y: 0 });
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  }, [node.id, effectiveX, effectiveY, editingNodeId, onStart, onDrag, onStop]);

  // Handle checkbox clicks in display mode (without entering edit mode)
  const handleContentClick = useCallback((e) => {
    const checkBox = e.target.closest(".rt-check-box");
    if (checkBox && updateNodeText) {
      e.preventDefault();
      e.stopPropagation();
      const isChecked = checkBox.getAttribute("data-checked") === "true";
      checkBox.setAttribute("data-checked", isChecked ? "false" : "true");
      // Toggle parent's checked class
      const parent = checkBox.closest(".rt-checklist-item");
      if (parent) {
        parent.classList.toggle("rt-checked", !isChecked);
      }
      // Get the updated HTML from the container
      const container = e.currentTarget;
      if (container) {
        updateNodeText(node.id, container.innerHTML, { trackUndo: false });
      }
    }
  }, [node.id, updateNodeText]);

  // Extreme zoom-out: simplified colored rectangle
  if (lowDetail) {
    return (
      <div
        data-mindmap-node
        onPointerDown={handlePointerDown}
        onClick={(e) => {
          e.stopPropagation();
          handleNodeClick(node, e);
        }}
        style={{
          position: "absolute",
          transform: `translate3d(${effectiveX}px, ${effectiveY}px, 0)`,
          width: `${nodeWidth}px`,
          height: `${nodeHeight}px`,
          backgroundColor: node.bgColor || (linkingSource === node.id ? "#333" : "#1e1e1e"),
          borderRadius: "4px",
          cursor: "grab",
          boxSizing: "border-box",
          outline: isSelected ? "3px solid #8896DD" : "none",
          willChange: "transform",
          contain: "strict",
        }}
      />
    );
  }

  const dynamicOutlineWidth = averageDimension * 0.02;
  const minOutlineWidth = 4;
  const effectiveOutlineWidth = Math.max(dynamicOutlineWidth, minOutlineWidth);

  const computedOutlineColor = isSelected
    ? "#8896DD"
    : isHovered
      ? "white"
      : "transparent";

  // Dynamic box shadow that scales with node size.
  const shadowOffsetY = averageDimension * 0.03;
  const shadowBlur = averageDimension * 0.1;

  // Compute effective font size for dynamic text shadow.
  const effectiveFontSize = node.fontSize ? parseFloat(node.fontSize) : 14;
  const textShadowOffset = effectiveFontSize * 0.1;
  const textShadowBlur = effectiveFontSize * 0.2;
  const textShadowStyle = `${textShadowOffset}px ${textShadowOffset}px ${textShadowBlur}px rgba(0, 0, 0, 0.7)`;

  return (
    <div
      data-mindmap-node
      onMouseEnter={() => setHoveredNodeId(node.id)}
      onMouseLeave={() => setHoveredNodeId(null)}
      onPointerDown={handlePointerDown}
      onClick={(e) => {
        e.stopPropagation();
        handleNodeClick(node, e);
      }}
      onDoubleClick={() => handleDoubleClick(node)}
      style={{
        position: "absolute",
        transform: `translate3d(${effectiveX}px, ${effectiveY}px, 0)`,
        padding: "10px",
        backgroundColor: node.bgColor 
        ? node.bgColor 
        : linkingSource === node.id 
          ? "#333" 
          : "#1e1e1e",
        color: node.textColor || "#fff",
        borderRadius: "8px",
        cursor: "grab",
        minWidth: "120px",
        width: `${nodeWidth}px`,
        height: `${nodeHeight}px`,
        overflow: "hidden",
        boxSizing: "border-box",
        fontSize: node.fontSize ? `${node.fontSize}px` : "14px",
        textAlign: node.textAlign || "left",
        fontStyle: node.textStyle && node.textStyle.includes("italic") ? "italic" : "normal",
        textDecoration: node.textStyle && node.textStyle.includes("underline") ? "underline" : "none",
        fontWeight: node.textStyle && node.textStyle.includes("bold") ? "bold" : "normal",
        fontFamily: node.fontFamily || "Arial, sans-serif",
        outlineWidth: `${effectiveOutlineWidth}px`,
        outlineStyle: "solid",
        outlineColor: computedOutlineColor,
        outlineOffset: `${effectiveOutlineWidth}px`,
        transition: isSelected
          ? "outline-color 0.25s ease-in-out, box-shadow 0.2s ease-in-out, background-color 0.15s ease-in-out, color 0.15s ease-in-out"
          : "none",
        boxShadow: `0 ${shadowOffsetY}px ${shadowBlur}px rgba(0, 0, 0, 0.5)`,
        textShadow: textShadowStyle,
        willChange: "transform",
        contain: "layout style paint",
      }}
    >
      {editingNodeId === node.id ? (
        <RichTextEditor
          initialContent={editedText}
          onChange={(html) => {
            setEditedText(html);
            handleTyping(node.id);
          }}
          onBlur={(html) => {
            setEditedText(html);
            handleTextBlur(node.id);
          }}
          nodeId={node.id}
          textShadowStyle={textShadowStyle}
        />
      ) : node.type === "image" ? (
        <img
          src={node.imageUrl}
          alt="Node content"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            pointerEvents: "none",
          }}
        />
      ) : (
        node.text && node.text.trim() && node.text.trim() !== "<br>" ? (
          <div
            className="rt-content"
            style={{ whiteSpace: "pre-wrap", lineHeight: "1.5" }}
            dangerouslySetInnerHTML={{ __html: node.text }}
            onClick={handleContentClick}
          />
        ) : (
          <span style={{ whiteSpace: "pre-wrap", opacity: 0.35, fontStyle: "italic" }}>Untitled</span>
        )
      )}
      {node.lockedBy && node.lockedBy !== currentUserEmail && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(255,0,0,0.7)",
            color: "#fff",
            fontSize: "10px",
            padding: "2px",
            borderRadius: "2px",
          }}
        >
          Locked by {node.lockedBy}
        </div>
      )}
      {node.typing && node.lockedBy && node.lockedBy !== currentUserEmail && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            backgroundColor: "rgba(0,0,255,0.7)",
            color: "#fff",
            fontSize: "10px",
            padding: "2px",
            borderRadius: "2px",
          }}
        >
          Typing...
        </div>
      )}
    </div>
  );
});

export default MindMapNode;