import React, { memo } from "react";
import Draggable from "react-draggable";

const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 40;

const MindMapNode = memo(({
  node,
  zoom,
  groupDelta,
  isHighlighted,
  currentUserEmail,
  selectedNodes,
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
}) => {
  // Determine if node is selected or hovered.
  const isSelected = selectedNodes.includes(node.id);
  const isHovered = hoveredNodeId === node.id;
  
  // Calculate average dimensions for scaling effects.
  const averageDimension = ((node.width || DEFAULT_WIDTH) + (node.height || DEFAULT_HEIGHT)) / 2;
  const dynamicOutlineWidth = averageDimension * 0.02;
  const minOutlineWidth = 4; // Minimum outline width.
  const effectiveOutlineWidth = Math.max(dynamicOutlineWidth, minOutlineWidth);

  // Instead of removing the outline when not selected, we always set:
  // - outlineWidth: fixed (effectiveOutlineWidth)
  // - outlineStyle: "solid"
  // - outlineColor: blue for selected, white for hovered, transparent otherwise.
  const computedOutlineColor = isSelected
    ? "#8896DD"
    : isHovered
      ? "white"
      : "transparent";

  // Calculate effective position for group dragging.
  const effectiveX = selectedNodes.includes(node.id) ? node.x + groupDelta.x : node.x;
  const effectiveY = selectedNodes.includes(node.id) ? node.y + groupDelta.y : node.y;

  // Default colors and fonts.
  const defaultBgColor = node.bgColor || (linkingSource === node.id ? "#333" : "#472F2F");
  const defaultTextColor = node.textColor || "#EAEAEA";

  // Dynamic box shadow that scales with node size.
  const shadowOffsetY = averageDimension * 0.03;
  const shadowBlur = averageDimension * 0.1;

  // Compute effective font size for dynamic text shadow.
  const effectiveFontSize = node.fontSize ? parseFloat(node.fontSize) : 14;
  const textShadowOffset = effectiveFontSize * 0.1; // 10% of font size.
  const textShadowBlur = effectiveFontSize * 0.2;   // 20% of font size.
  const textShadowStyle = `${textShadowOffset}px ${textShadowOffset}px ${textShadowBlur}px rgba(0, 0, 0, 0.7)`;

  return (
    <Draggable
      scale={zoom}
      position={{ x: effectiveX, y: effectiveY }}
      onStart={onStart}
      onDrag={onDrag}
      onStop={onStop}
    >
      <div
        onMouseEnter={() => setHoveredNodeId(node.id)}
        onMouseLeave={() => setHoveredNodeId(null)}
        onClick={(e) => {
          e.stopPropagation();
          handleNodeClick(node, e);
        }}
        onDoubleClick={() => handleDoubleClick(node)}
        style={{
          position: "absolute",
          transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
          padding: "10px", // Spacious padding.
          backgroundColor: node.bgColor 
          ? node.bgColor 
          : linkingSource === node.id 
            ? "#333" 
            : "#1e1e1e",
          color: node.textColor || "#fff",
          borderRadius: "8px", // Consistent border radius.
          cursor: "grab",      // Draggable cue.
          minWidth: "120px",
          width: node.width ? `${node.width}px` : `${DEFAULT_WIDTH}px`,
          height: node.height ? `${node.height}px` : `${DEFAULT_HEIGHT}px`,
          overflow: "hidden",
          boxSizing: "border-box",
          fontSize: node.fontSize ? `${node.fontSize}px` : "14px",
          textAlign: node.textAlign || "left",
          fontStyle: node.textStyle && node.textStyle.includes("italic") ? "italic" : "normal",
          textDecoration: node.textStyle && node.textStyle.includes("underline") ? "underline" : "none",
          fontWeight: node.textStyle && node.textStyle.includes("bold") ? "bold" : "normal",
          fontFamily: node.fontFamily || "cursive",
          // Outline properties for fade-out effect.
          outlineWidth: `${effectiveOutlineWidth}px`,
          outlineStyle: "solid",
          outlineColor: computedOutlineColor,
          outlineOffset: `${effectiveOutlineWidth}px`,
          transition: isSelected
            ? "outline-color 0.25s ease-in-out, box-shadow 0.2s ease-in-out, background-color 0.15s ease-in-out, color 0.15s ease-in-out"
            : "none",
          // Dynamic box shadow.
          boxShadow: `0 ${shadowOffsetY}px ${shadowBlur}px rgba(0, 0, 0, 0.5)`,
          // Dynamic text shadow based on font size.
          textShadow: textShadowStyle,
        }}
      >
        {editingNodeId === node.id ? (
          <textarea
            value={editedText}
            onChange={(e) => {
              setEditedText(e.target.value);
              handleTyping(node.id);
            }}
            onBlur={() => handleTextBlur(node.id)}
            autoFocus
            style={{
              backgroundColor: "inherit",
              width: "100%",
              height: "107%",
              fontSize: "inherit",
              color: "inherit",
              fontStyle: "inherit",
              fontFamily: "inherit",
              fontWeight: "inherit",
              textDecoration: "inherit",
              textAlign: "inherit",
              border: "none",
              outline: "none",
              resize: "none",
              textShadow: textShadowStyle,
              padding: 0,           // Reset default padding
              margin: 0,            // Reset any default margin
              boxSizing: "border-box",// Ensure box-sizing consistency
              //overscrollBehavior: "none",
              //overflow: "hidden",
            }}
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
          <span style={{ whiteSpace: "pre-wrap" }}>{node.text}</span>
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
        {/* Resize handle */}
        <div
          onMouseDown={(e) => handleResizeMouseDown(node, e)}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: "10%",
            height: "10%",
            opacity: 0.5,
            cursor: "nwse-resize",
            backgroundColor: "#ccc",
          }}
        ></div>
      </div>
    </Draggable>
  );
});

export default MindMapNode;
