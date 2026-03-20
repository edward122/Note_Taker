// src/hooks/useKeyboardShortcuts.js
import { useEffect, useCallback } from "react";
import {
  collection,
  query,
  doc,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/firebase";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT, MAX_ZOOM } from "../components/constants";

/**
 * Hook that manages all keyboard shortcuts for the mind map editor.
 * Encapsulates the entire keydown handler and its effect lifecycle.
 */
export function useKeyboardShortcuts({
  // State
  nodes,
  links,
  selectedNodes,
  editingNodeId,
  showHotkeyHelp,
  mindMapId,
  // State setters
  setEditingNodeId,
  setShowSearch,
  setShowHotkeyHelp,
  setZoom,
  setSelectedNodes,
  setLinkingMode,
  setLinkingSource,
  setPan,
  setNodes,
  // Refs
  zoomRef,
  panRef,
  outerRef,
  // Action callbacks
  navigateSearch,
  zoomToFitAll,
  handleZoomIn,
  handleZoomOut,
  handleReset,
  selectAllNodes,
  addConnectedNode,
  handleDoubleClick,
  autoLayout,
  toggleLinkingMode,
  handleExport,
  duplicateNodeWithPosition,
  pushSelectionToUndoStack,
  pushAction,
  handleUndoSelection,
  handleRedoSelection,
}) {
  // Focus on selected nodes — extracted to avoid duplicate code
  const focusOnSelectedNodes = useCallback(() => {
    const selected = nodes.filter((n) => selectedNodes.includes(n.id));
    if (!selected.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selected.forEach((node) => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + width);
      maxY = Math.max(maxY, node.y + height);
    });

    const targetCenterWorld = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const outerRect = outerRef.current.getBoundingClientRect();
    const sidebarWidth = -125;
    const topBarHeight = 50;
    const canvasWidth = outerRect.width - sidebarWidth;
    const canvasHeight = outerRect.height - topBarHeight;

    const marginFactor = 0.6;
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    const zoomX = (canvasWidth * marginFactor) / boxWidth;
    const zoomY = (canvasHeight * marginFactor) / boxHeight;
    const newZoom = Math.min(zoomX, zoomY, MAX_ZOOM);

    const canvasCenterScreen = {
      x: sidebarWidth + canvasWidth / 2,
      y: topBarHeight + canvasHeight / 2,
    };

    const newPan = {
      x: canvasCenterScreen.x - targetCenterWorld.x * newZoom,
      y: canvasCenterScreen.y - targetCenterWorld.y * newZoom,
    };

    setZoom(newZoom);
    zoomRef.current = newZoom;
    setPan(newPan);
    panRef.current = newPan;
  }, [nodes, selectedNodes, outerRef, setZoom, setPan, zoomRef, panRef]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip shortcuts when typing in inputs (except Escape)
      if (
        document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA"
      ) {
        if (e.key === "Escape") {
          e.target.blur();
          setEditingNodeId(null);
          setShowSearch(false);
          setShowHotkeyHelp(false);
        }
        return;
      }

      // Help modal
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setShowHotkeyHelp(!showHotkeyHelp);
        return;
      }

      // Search
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      if (e.key === "F3") {
        e.preventDefault();
        navigateSearch(e.shiftKey ? "prev" : "next");
        return;
      }

      // Navigation
      if (e.key === "Home") { e.preventDefault(); zoomToFitAll(); return; }
      if (e.key === "0" && !e.ctrlKey) { e.preventDefault(); setZoom(1); zoomRef.current = 1; return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); handleZoomIn(); return; }
      if (e.key === "-") { e.preventDefault(); handleZoomOut(); return; }
      if (e.key.toLowerCase() === "r" && !e.ctrlKey) { e.preventDefault(); handleReset(); return; }

      // Selection
      if (e.ctrlKey && e.key.toLowerCase() === "a") { e.preventDefault(); selectAllNodes(); return; }
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedNodes([]);
        setLinkingMode(false);
        setLinkingSource(null);
        setShowSearch(false);
        setShowHotkeyHelp(false);
        return;
      }

      // Node creation / editing
      if (e.key === "Tab" && selectedNodes.length === 1) { e.preventDefault(); addConnectedNode(); return; }
      if (e.key === "Enter" && selectedNodes.length === 1) {
        e.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodes[0]);
        if (node) handleDoubleClick(node);
        return;
      }

      // Layout
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); autoLayout(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); toggleLinkingMode(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === "e") { e.preventDefault(); handleExport(); return; }

      // Focus on selected nodes
      if (e.key.toLowerCase() === "f" && selectedNodes.length > 0) {
        e.preventDefault();
        focusOnSelectedNodes();
        return;
      }

      // Duplicate
      if (e.ctrlKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        (async () => {
          if (selectedNodes.length > 0) {
            const offset = 50;
            const groupUndoSnapshot = {};
            await Promise.all(
              selectedNodes.map(async (nodeId) => {
                const node = nodes.find((n) => n.id === nodeId);
                if (node) {
                  const newNodeId = await duplicateNodeWithPosition(node, { x: node.x + offset, y: node.y + offset });
                  if (newNodeId) {
                    groupUndoSnapshot[newNodeId] = { id: newNodeId, isNew: true };
                  }
                }
              })
            );
            if (Object.keys(groupUndoSnapshot).length > 0) {
              pushSelectionToUndoStack(groupUndoSnapshot);
            }
          }
        })();
      }

      // Delete
      if (!editingNodeId && selectedNodes.length > 0 && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        if (window.confirm("Are you sure you want to delete the selected nodes?")) {
          // Snapshot nodes AND their connected links for undo
          const nodesBefore = {};
          const linksBefore = {};
          const nodesAfter = {};
          const linksAfter = {};
          const selectedSet = new Set(selectedNodes);

          selectedNodes.forEach((id) => {
            const node = nodes.find((n) => n.id === id);
            if (node) {
              nodesBefore[id] = structuredClone(node);
              nodesAfter[id] = null; // will be deleted
            }
          });

          // Find all links connected to any deleted node
          if (links) {
            links.forEach((link) => {
              if (selectedSet.has(link.source) || selectedSet.has(link.target)) {
                linksBefore[link.id] = structuredClone(link);
                linksAfter[link.id] = null; // will be deleted
              }
            });
          }

          pushAction({
            type: 'delete',
            nodes: { before: nodesBefore, after: nodesAfter },
            links: { before: linksBefore, after: linksAfter },
          });

          (async () => {
            const batch = writeBatch(db);
            for (const id of selectedNodes) {
              const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
              batch.delete(nodeRef);
              const outQ = query(collection(db, "mindMaps", mindMapId, "links"), where("source", "==", id));
              const outSnap = await getDocs(outQ);
              outSnap.docs.forEach((d) => batch.delete(doc(db, "mindMaps", mindMapId, "links", d.id)));
              const inQ = query(collection(db, "mindMaps", mindMapId, "links"), where("target", "==", id));
              const inSnap = await getDocs(inQ);
              inSnap.docs.forEach((d) => batch.delete(doc(db, "mindMaps", mindMapId, "links", d.id)));
            }
            try { await batch.commit(); } catch (error) { console.error("Error deleting nodes:", error); }
            setNodes((prev) => prev.filter((n) => !selectedNodes.includes(n.id)));
            setSelectedNodes([]);
          })();
        }
      }

      // Undo / Redo (Ctrl+Z / Cmd+Z for undo, Ctrl+Y / Cmd+Shift+Z for redo)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); handleRedoSelection(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); handleUndoSelection(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); handleRedoSelection(); return; }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    nodes, links, selectedNodes, showHotkeyHelp, editingNodeId, mindMapId,
    navigateSearch, zoomToFitAll, handleZoomIn, handleZoomOut, handleReset,
    selectAllNodes, addConnectedNode, handleDoubleClick, autoLayout,
    toggleLinkingMode, handleExport, duplicateNodeWithPosition,
    pushSelectionToUndoStack, pushAction, handleUndoSelection, handleRedoSelection,
    focusOnSelectedNodes, setEditingNodeId, setShowSearch, setShowHotkeyHelp,
    setZoom, setSelectedNodes, setLinkingMode, setLinkingSource, setPan,
    setNodes, zoomRef, panRef,
  ]);
}
