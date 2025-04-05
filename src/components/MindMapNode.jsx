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
  const isSelected = selectedNodes.includes(node.id);
  const isHovered = hoveredNodeId === node.id;
  const averageDimension = ((node.width || 100) + (node.height || 40)) / 2;
  const dynamicBorderWidth = Math.max(1, averageDimension * 0.02);
  
  // Calculate effective position for group dragging.
  const effectiveX = selectedNodes.includes(node.id)
    ? node.x + groupDelta.x
    : node.x;
  const effectiveY = selectedNodes.includes(node.id)
    ? node.y + groupDelta.y
    : node.y;
  

  let outlineStyle = "none";
  if (isSelected) {
    outlineStyle = `${dynamicBorderWidth}px solid #8896DD`;
  } else if (isHovered) {
    outlineStyle = `${dynamicBorderWidth}px solid white`;
  }
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
          padding: "5px",
          //boxShadow: isHighlighted
          //  ? "0 1px 10px 2px rgba(300,300,300,0.5)"
          //  : "none",
          backgroundColor: node.bgColor 
            ? node.bgColor 
            : linkingSource === node.id 
              ? "#333" 
              : "#1e1e1e",
          color: node.textColor || "#fff",
          borderRadius: "4px",
          cursor: "move",
          minWidth: "100px",
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
          
          //border: isHighlighted ? "2px solid white" : "none",
          outline: outlineStyle,
          outlineOffset: outlineStyle !== "none" ? `${dynamicBorderWidth}px` : "0px",
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
              height: "100%",
              fontSize: "inherit",
              color: "inherit",
              fontFamily: "inherit",
              fontWeight: "inherit",
              textDecoration: "inherit",
              textAlign: "inherit",
              border: "none",
              outline: "none",
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
