// Right-click context menu component
import React from "react";

const ContextMenu = ({
  contextMenuu,
  rightClickMoved,
  selectedNodes,
  nodes,
  handleCopy,
  handlePaste,
  handleReset,
  handleBringToFront,
  handleSendToBack,
  handleDownloadImage,
  closeContextMenu,
}) => {
  if (!contextMenuu.visible) return null;
  if (rightClickMoved) return null;
  
  const selectedImageNodes = selectedNodes
    .map(nodeId => nodes.find(n => n.id === nodeId))
    .filter(node => node && node.type === 'image' && node.imageUrl);
  
  return (
    <div
      style={{
        position: "fixed",
        top: contextMenuu.y,
        left: contextMenuu.x,
        backgroundColor: "#333",
        color: "#fff",
        border: "1px solid #555",
        borderRadius: "4px",
        padding: "5px",
        zIndex: 1000,
        minWidth: "120px",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {contextMenuu.type === "canvas" && (
        <>
          <div className="context-menu-item"
            style={{ padding: "4px 8px", cursor: "pointer" }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handlePaste(e);
              closeContextMenu();
            }}
          >
            Paste
          </div>
          <div className="context-menu-item"
            style={{ padding: "4px 8px", cursor: "pointer" }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleReset();
              closeContextMenu();
            }}
          >
            Reset
          </div>
        </>
      )}
      {contextMenuu.type === "node" && (
        <>
          <div className="context-menu-item"
            style={{ padding: "4px 8px", cursor: "pointer" }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopy(e);
              closeContextMenu();
            }}
          >
            Copy
          </div>
          {selectedImageNodes.length > 0 && (
            <div className="context-menu-item"
              style={{ padding: "4px 8px", cursor: "pointer" }}
              onMouseDown={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeContextMenu();
                
                for (const imageNode of selectedImageNodes) {
                  await handleDownloadImage(imageNode);
                  if (selectedImageNodes.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }
                }
              }}
            >
              PNG Download {selectedImageNodes.length > 1 ? `(${selectedImageNodes.length})` : ''}
            </div>
          )}
          <div className="context-menu-item"
            style={{ padding: "4px 8px", cursor: "pointer" }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleBringToFront();
              closeContextMenu();
            }}
          >
            + Bring to Front
          </div>
          <div className="context-menu-item"
            style={{ padding: "4px 8px", cursor: "pointer" }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSendToBack();
              closeContextMenu();
            }}
          >
            - Send to Back
          </div>
        </>
      )}
    </div>
  );
};

export default ContextMenu;
