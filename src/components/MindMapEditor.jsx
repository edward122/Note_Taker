// src/components/MindMapEditor.jsx
import React, { useEffect, useState, useRef, useMemo, useCallback, memo } from "react";
import throttle from "lodash.throttle";
import { useNavigate } from 'react-router-dom';
import { useParams } from "react-router-dom";
import {
  collection,
  query,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { db, storage } from "../firebase/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { Typography, Button } from "@mui/material";
import MindMapNode from "./MindMapNode";
import CanvasLinks from "./CanvasLinks";
import { computePyramidLayoutWithLevels, computeHorizontalTreeLayout, computeRadialLayout } from "./layoutUtils";
import { fetchImage } from "../utils/imageUtils";
import ChatBox from "./ChatBox";
import FormattingToolbar from "./FormattingToolbar";
import "./new.css";

// Extracted modules
import { DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, clamp, isMobile, HOTKEYS, presetSizes, rectsIntersect } from "./constants";
import { useOptimizedNodes, useOptimizedLinks, useVisibleNodes, useVisibleLinks, useNodeSelector } from "../hooks/useStateManagers";
import ToolbarComponent from "./Toolbar";
import Sidebar from "./Sidebar";
import ContextMenu from "./ContextMenu";
import SearchBar from "./SearchBar";
import HotkeyHelpModal from "./HotkeyHelpModal";
import { MiniMap, MiniMapToggle } from "./MiniMap";
import { useFirebaseSubscriptions } from "../hooks/useFirebaseSubscriptions";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useClipboard } from "../hooks/useClipboard";
import { useSettings } from "../hooks/useSettings";
import SettingsModal from "./SettingsModal";
import RemoteCursors, { RemoteSelectionOverlays, getColorForUid } from "./RemoteCursors";


// Stable empty function references to avoid re-renders from inline () => {}
const NOOP = () => {};
const NOOP_FALSE = () => false;

// Virtual Node Renderer Component with Node Pooling
const VirtualNodeRenderer = memo(({
  nodes,
  nodeMap,
  zoom,
  pan,
  outerRef,
  visibleNodes,
  selectedNodes,
  selectedNodeSet,
  groupDelta,
  editingNodeId,
  editedText,
  hoveredNodeId,
  linkingSource,
  currentUserEmail,
  isNodeHighlighted,
  handleResizeMouseDown,
  handleNodeClick,
  handleDoubleClick,
  handleTyping,
  handleTextBlur,
  setEditedText,
  setHoveredNodeId,
  dragStartRef,
  multiDragStartRef,
  setIsDragging,
  setNodes,
  setGroupDelta,
  mindMapId,
  pushSingleNodeToUndoStack,
  pushSelectionToUndoStack,
  setSelectedNodes,
  updateGroupDelta,
  panRef,
  zoomRef,
  lowDetail,
  snapSettingsRef,
  groupDeltaRef,
  updateNodeText,
}) => {
  // Snap helper
  const snapPos = (x, y) => {
    const snap = snapSettingsRef?.current;
    if (snap && snap.snapToGrid && snap.gridSize > 0) {
      const g = snap.gridSize;
      return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
    }
    return { x, y };
  };
  // Alignment guide lines state
  const [guideLines, setGuideLines] = useState([]);
  const snapCorrectionRef = useRef({ dx: 0, dy: 0 });
  const SNAP_THRESHOLD = 8; // pixels in world coordinates

  // Real-time snap: detect alignment with other nodes' edges/centers
  // excludeSet: Set of node IDs to skip (the dragged node(s))
  const snapToNodes = useCallback((excludeSet, rawX, rawY, draggedW, draggedH) => {
    const snap = snapSettingsRef?.current;
    if (!snap || !snap.snapToGrid) return { x: rawX, y: rawY, guides: [] };

    const guides = [];
    let snappedX = rawX;
    let snappedY = rawY;
    let bestDx = SNAP_THRESHOLD + 1;
    let bestDy = SNAP_THRESHOLD + 1;

    // Dragged bounding box reference points
    const dLeft = rawX;
    const dCenterX = rawX + draggedW / 2;
    const dRight = rawX + draggedW;
    const dTop = rawY;
    const dCenterY = rawY + draggedH / 2;
    const dBottom = rawY + draggedH;

    for (const other of nodes) {
      if (excludeSet.has(other.id)) continue;
      const ow = other.width || 100;
      const oh = other.height || 40;
      const oLeft = other.x;
      const oCenterX = other.x + ow / 2;
      const oRight = other.x + ow;
      const oTop = other.y;
      const oCenterY = other.y + oh / 2;
      const oBottom = other.y + oh;

      // X-axis alignment checks
      const xChecks = [
        { d: dLeft, o: oLeft, offset: 0 },
        { d: dLeft, o: oRight, offset: 0 },
        { d: dRight, o: oLeft, offset: -draggedW },
        { d: dRight, o: oRight, offset: -draggedW },
        { d: dCenterX, o: oCenterX, offset: -draggedW / 2 },
      ];
      for (const chk of xChecks) {
        const dist = Math.abs(chk.d - chk.o);
        if (dist < SNAP_THRESHOLD && dist < bestDx) {
          bestDx = dist;
          snappedX = chk.o + chk.offset;
        }
      }

      // Y-axis alignment checks
      const yChecks = [
        { d: dTop, o: oTop, offset: 0 },
        { d: dTop, o: oBottom, offset: 0 },
        { d: dBottom, o: oTop, offset: -draggedH },
        { d: dBottom, o: oBottom, offset: -draggedH },
        { d: dCenterY, o: oCenterY, offset: -draggedH / 2 },
      ];
      for (const chk of yChecks) {
        const dist = Math.abs(chk.d - chk.o);
        if (dist < SNAP_THRESHOLD && dist < bestDy) {
          bestDy = dist;
          snappedY = chk.o + chk.offset;
        }
      }
    }

    // Build guide lines
    if (bestDx <= SNAP_THRESHOLD) {
      const sLeft = snappedX;
      const sCenterX = snappedX + draggedW / 2;
      const sRight = snappedX + draggedW;
      let guideX = sLeft;
      for (const other of nodes) {
        if (excludeSet.has(other.id)) continue;
        const ow = other.width || 100;
        for (const val of [other.x, other.x + ow / 2, other.x + ow]) {
          if (Math.abs(sLeft - val) < 1 || Math.abs(sCenterX - val) < 1 || Math.abs(sRight - val) < 1) {
            guideX = val;
          }
        }
      }
      guides.push({ type: 'vertical', x: guideX });
    }
    if (bestDy <= SNAP_THRESHOLD) {
      const sTop = snappedY;
      const sCenterY = snappedY + draggedH / 2;
      const sBottom = snappedY + draggedH;
      let guideY = sTop;
      for (const other of nodes) {
        if (excludeSet.has(other.id)) continue;
        const oh = other.height || 40;
        for (const val of [other.y, other.y + oh / 2, other.y + oh]) {
          if (Math.abs(sTop - val) < 1 || Math.abs(sCenterY - val) < 1 || Math.abs(sBottom - val) < 1) {
            guideY = val;
          }
        }
      }
      guides.push({ type: 'horizontal', y: guideY });
    }

    // Grid snap fallback for axes without node alignment
    if (snap.gridSize > 0) {
      const g = snap.gridSize;
      if (bestDx > SNAP_THRESHOLD) snappedX = Math.round(rawX / g) * g;
      if (bestDy > SNAP_THRESHOLD) snappedY = Math.round(rawY / g) * g;
    }

    return { x: snappedX, y: snappedY, guides, dx: snappedX - rawX, dy: snappedY - rawY };
  }, [nodes, SNAP_THRESHOLD]);

  // Pre-sort visible nodes by zIndex to avoid sorting during render
  const sortedVisibleNodes = useMemo(() =>
    [...visibleNodes].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1)),
    [visibleNodes]
  );

  // Stable mobile handler refs
  const mobileHandlers = isMobile ? {
    handleResizeMouseDown: NOOP,
    handleNodeClick: NOOP,
    handleDoubleClick: NOOP,
    handleTyping: NOOP,
    handleTextBlur: NOOP,
    setEditedText: NOOP,
    setHoveredNodeId: NOOP,
  } : null;

  // Node component factory
  const createNodeComponent = useCallback((node) => {
    return (
      <MindMapNode
        key={node.id}
        node={node}
        zoom={zoomRef.current}
        groupDelta={groupDelta}
        isHighlighted={isNodeHighlighted(node)}
        currentUserEmail={currentUserEmail}
        selectedNodeSet={selectedNodeSet}
        editingNodeId={editingNodeId}
        editedText={editedText}
        handleResizeMouseDown={mobileHandlers ? mobileHandlers.handleResizeMouseDown : handleResizeMouseDown}
        handleNodeClick={mobileHandlers ? mobileHandlers.handleNodeClick : handleNodeClick}
        handleDoubleClick={mobileHandlers ? mobileHandlers.handleDoubleClick : handleDoubleClick}
        handleTyping={mobileHandlers ? mobileHandlers.handleTyping : handleTyping}
        handleTextBlur={mobileHandlers ? mobileHandlers.handleTextBlur : handleTextBlur}
        setEditedText={mobileHandlers ? mobileHandlers.setEditedText : setEditedText}
        setHoveredNodeId={mobileHandlers ? mobileHandlers.setHoveredNodeId : setHoveredNodeId}
        linkingSource={linkingSource}
        hoveredNodeId={hoveredNodeId}
        lowDetail={lowDetail}
        updateNodeText={updateNodeText}
        onStart={isMobile ? NOOP_FALSE : (e, data) => {
          if (editingNodeId === node.id) return false;
          setIsDragging(true);
          const rect = outerRef.current.getBoundingClientRect();
          const cursorWorldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
          const cursorWorldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
          const offsetX = cursorWorldX - node.x;
          const offsetY = cursorWorldY - node.y;
          dragStartRef.current = {
            offsetX,
            offsetY,
            initialX: node.x,
            initialY: node.y
          };
          if (selectedNodes.length < 2) {
            pushSingleNodeToUndoStack(node);
          }
          if (selectedNodes.length > 1 && selectedNodeSet.has(node.id)) {
            if (Object.keys(multiDragStartRef.current).length === 0) {
              selectedNodes.forEach((id) => {
                const found = nodeMap.get(id);
                if (found) {
                  multiDragStartRef.current[id] = { x: found.x, y: found.y };
                }
              });
            }
          }
        }}
        onDrag={isMobile ? NOOP : (e, data) => {
          const rect = outerRef.current.getBoundingClientRect();
          const cursorWorldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
          const cursorWorldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
          const rawX = cursorWorldX - dragStartRef.current.offsetX;
          const rawY = cursorWorldY - dragStartRef.current.offsetY;
          const deltaX = rawX - dragStartRef.current.initialX;
          const deltaY = rawY - dragStartRef.current.initialY;

          if (selectedNodes.length > 1 && selectedNodeSet.has(node.id)) {
            // Multi-node drag: update all positions directly in state
            // (eliminates groupDelta flicker on drop entirely)
            let finalDeltaX = deltaX;
            let finalDeltaY = deltaY;

            const snap = snapSettingsRef?.current;
            if (snap && snap.snapToGrid) {
              // Compute bounding box for snap alignment
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              selectedNodes.forEach((id) => {
                const startPos = multiDragStartRef.current[id];
                if (startPos) {
                  const n = nodeMap.get(id);
                  const w = n?.width || 100;
                  const h = n?.height || 40;
                  minX = Math.min(minX, startPos.x + deltaX);
                  minY = Math.min(minY, startPos.y + deltaY);
                  maxX = Math.max(maxX, startPos.x + deltaX + w);
                  maxY = Math.max(maxY, startPos.y + deltaY + h);
                }
              });
              const result = snapToNodes(selectedNodeSet, minX, minY, maxX - minX, maxY - minY);
              finalDeltaX = deltaX + result.dx;
              finalDeltaY = deltaY + result.dy;
              setGuideLines(result.guides);
            }

            // Update every selected node's position directly
            setNodes((prev) =>
              prev.map((n) => {
                if (!selectedNodeSet.has(n.id)) return n;
                const startPos = multiDragStartRef.current[n.id];
                if (!startPos) return n;
                return {
                  ...n,
                  x: startPos.x + finalDeltaX,
                  y: startPos.y + finalDeltaY
                };
              })
            );
          } else {
            // Single-node drag: real-time alignment snap
            const nw = node.width || 100;
            const nh = node.height || 40;
            const excludeSet = new Set([node.id]);
            const result = snapToNodes(excludeSet, rawX, rawY, nw, nh);
            setNodes((prev) =>
              prev.map((n) => (n.id === node.id ? { ...n, x: result.x, y: result.y } : n))
            );
            setGuideLines(result.guides);
          }
        }}
        onStop={isMobile ? NOOP : async (e, data) => {
          setGuideLines([]);
          // Compute final position from live cursor (nodeMap is stale in
          // this closure — it was captured during onStart, before the drag
          // moved anything)
          const rect = outerRef.current.getBoundingClientRect();
          const cursorWorldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
          const cursorWorldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
          const rawX = cursorWorldX - dragStartRef.current.offsetX;
          const rawY = cursorWorldY - dragStartRef.current.offsetY;
          const deltaX = rawX - dragStartRef.current.initialX;
          const deltaY = rawY - dragStartRef.current.initialY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

          if (distance < 0.01) {
            setIsDragging(false);
            multiDragStartRef.current = {};
            return;
          }

          if (selectedNodes.length > 1) {
            // Multi-node: apply snap correction if snap is enabled
            let finalDeltaX = deltaX;
            let finalDeltaY = deltaY;
            const snap = snapSettingsRef?.current;
            if (snap && snap.snapToGrid) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              selectedNodes.forEach((id) => {
                const startPos = multiDragStartRef.current[id];
                if (startPos) {
                  const w = 100, h = 40; // approximate for snap
                  minX = Math.min(minX, startPos.x + deltaX);
                  minY = Math.min(minY, startPos.y + deltaY);
                  maxX = Math.max(maxX, startPos.x + deltaX + w);
                  maxY = Math.max(maxY, startPos.y + deltaY + h);
                }
              });
              const result = snapToNodes(selectedNodeSet, minX, minY, maxX - minX, maxY - minY);
              finalDeltaX = deltaX + result.dx;
              finalDeltaY = deltaY + result.dy;
            }

            pushSelectionToUndoStack();
            // Compute final positions from start positions + delta
            const newPositions = {};
            selectedNodes.forEach((id) => {
              const startPos = multiDragStartRef.current[id];
              if (startPos) {
                newPositions[id] = {
                  x: startPos.x + finalDeltaX,
                  y: startPos.y + finalDeltaY
                };
              }
            });
            // Persist to Firebase
            const batch = writeBatch(db);
            Object.entries(newPositions).forEach(([id, pos]) => {
              const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
              batch.update(nodeRef, { x: pos.x, y: pos.y });
            });
            try {
              await batch.commit();
            } catch (error) {
              console.error("Error updating nodes in batch:", error);
            }
            multiDragStartRef.current = {};
          } else {
            // Single-node: compute from snap result using cursor
            const nw = node.width || 100;
            const nh = node.height || 40;
            const excludeSet = new Set([node.id]);
            const result = snapToNodes(excludeSet, rawX, rawY, nw, nh);
            pushSingleNodeToUndoStack(node);
            try {
              const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
              await updateDoc(nodeRef, { x: result.x, y: result.y });
            } catch (error) {
              console.error("Error updating node position:", error);
            }
          }
          setIsDragging(false);
        }}
      />
    );
  }, [
    zoomRef, groupDelta, isNodeHighlighted, currentUserEmail, selectedNodes,
    selectedNodeSet, nodeMap, snapToNodes,
    editingNodeId, editedText, handleResizeMouseDown, handleNodeClick,
    handleDoubleClick, handleTyping, handleTextBlur, setEditedText,
    setHoveredNodeId, linkingSource, hoveredNodeId, outerRef,
    panRef, dragStartRef, multiDragStartRef, setIsDragging, setNodes,
    setGroupDelta, mindMapId, pushSingleNodeToUndoStack, pushSelectionToUndoStack,
    setSelectedNodes, updateGroupDelta, lowDetail, snapSettingsRef, groupDeltaRef,
    updateNodeText
  ]);
  
  // Render pre-sorted visible nodes + alignment guides
  return (
    <>
      {sortedVisibleNodes.map((node) => createNodeComponent(node))}
      {/* Smart alignment guide lines */}
      {guideLines.map((g, i) => (
        g.type === 'vertical' ? (
          <svg
            key={`guide-v-${i}`}
            style={{
              position: 'absolute',
              left: `${g.x - 6}px`,
              top: '-10000px',
              width: '13px',
              height: '20000px',
              pointerEvents: 'none',
              zIndex: 99999,
              overflow: 'visible',
            }}
          >
            {/* Glow */}
            <line x1="6.5" y1="0" x2="6.5" y2="20000"
              stroke="rgba(99, 102, 241, 0.15)" strokeWidth="5" />
            {/* Main dashed line */}
            <line x1="6.5" y1="0" x2="6.5" y2="20000"
              stroke="#818cf8" strokeWidth="1"
              strokeDasharray="6 3" />
          </svg>
        ) : (
          <svg
            key={`guide-h-${i}`}
            style={{
              position: 'absolute',
              top: `${g.y - 6}px`,
              left: '-10000px',
              height: '13px',
              width: '20000px',
              pointerEvents: 'none',
              zIndex: 99999,
              overflow: 'visible',
            }}
          >
            {/* Glow */}
            <line x1="0" y1="6.5" x2="20000" y2="6.5"
              stroke="rgba(99, 102, 241, 0.15)" strokeWidth="5" />
            {/* Main dashed line */}
            <line x1="0" y1="6.5" x2="20000" y2="6.5"
              stroke="#818cf8" strokeWidth="1"
              strokeDasharray="6 3" />
          </svg>
        )
      ))}
    </>
  );
});

const MindMapEditor = () => {
  const { id: mindMapId } = useParams();
  const { settings, updateSettings, resetSettings } = useSettings();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const snapSettingsRef = useRef({ snapToGrid: settings.snapToGrid, gridSize: settings.gridSize });
  snapSettingsRef.current = { snapToGrid: settings.snapToGrid, gridSize: settings.gridSize };
  const navigate = useNavigate();

  // Toggle editor-specific body styles (overflow:hidden, height:100%)
  // so they don't leak into other pages like the dashboard
  useEffect(() => {
    document.documentElement.classList.add('mindmap-editor-active');
    return () => document.documentElement.classList.remove('mindmap-editor-active');
  }, []);

  // Optimized state management for nodes
  const [rawNodes, setRawNodes] = useState([]); // Raw nodes from Firebase
  const {
    nodes,
    updateNode: updateNodeOptimized,
    updateNodes: updateNodesOptimized,
    addNode: addNodeOptimized,
    removeNode: removeNodeOptimized,
    getNode,
    getNodesByIds,
    flush: flushNodeUpdates,
    stateManager: nodeStateManager
  } = useOptimizedNodes(rawNodes);

  // Optimized state management for links
  const [rawLinks, setRawLinks] = useState([]); // Raw links from Firebase
  const {
    links,
    updateLink: updateLinkOptimized,
    addLink: addLinkOptimized,
    removeLink: removeLinkOptimized,
    getLink,
    getLinksBySource,
    getLinksByTarget,
    getLinksByNode,
    removeLinksForNode,
    flush: flushLinkUpdates,
    stateManager: linkStateManager
  } = useOptimizedLinks(rawLinks);

  const [editingNodeId, setEditingNodeId] = useState(null);
  const [editedText, setEditedText] = useState("");
  const [linkingMode, setLinkingMode] = useState(false);
  const [linkingSource, setLinkingSource] = useState(null);
  const [copiedNodes, setCopiedNodes] = useState([]);
  
  // Memoized toggle function
  const toggleLinkingMode = useCallback(() => {
    setLinkingMode((prev) => !prev);
    setLinkingSource(null);
  }, []);

  // Selection state
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  // Real-time collaboration (presence, persistent in Firestore)
  const [currentUserEmail, setCurrentUserEmail] = useState(null);
  const [currentUserUid, setCurrentUserUid] = useState(null);
  const [presenceUsers, setPresenceUsers] = useState([]);

  // Ephemeral state for cursor tracking via RTDB
  // NOTE: localCursor state removed for performance — use localCursorRef.current instead
  const [cursors, setCursors] = useState([]);
  const localCursorRef = useRef({ x: 0, y: 0 });
  

  // Zoom and pan state for canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const mouseStart = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  
  // Performance optimization refs
  const lastRenderTime = useRef(0);
  const animationFrameId = useRef(null);
  const syncTimeoutRef = useRef(null);
  const isPanningRef = useRef(false);

  // === CRITICAL PERF: Bypass React during pan/zoom ===
  // Directly manipulate the container's CSS transform via ref,
  // only sync to React state when the interaction settles.
  const applyTransformDirect = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = 
        `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
    }
  }, []);

  // Debounced sync: push ref values into React state after interaction settles
  const scheduleStateSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      setPan({ ...panRef.current });
      setZoom(zoomRef.current);
    }, 80); // Sync after 80ms of inactivity (fast response on zoom-in)
  }, []);

  // Local hover state for highlighting
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  // Undo/redo system (extracted to hook)
  const {
    selectionUndoStack,
    selectionRedoStack,
    pushSelectionToUndoStack,
    pushSingleNodeToUndoStack,
    pushAction,
    snapshotNode,
    snapshotLinksForNodes,
    handleUndoSelection,
    handleRedoSelection,
  } = useUndoRedo({ mindMapId, nodes, links, selectedNodes, setNodes: (updater) => {
    if (typeof updater === 'function') {
      const currentNodes = nodeStateManager.getNodes();
      const newNodes = updater(currentNodes);
      setRawNodes(newNodes);
    } else {
      setRawNodes(updater);
    }
  }, setLinks: (updater) => {
    if (typeof updater === 'function') {
      setRawLinks((prev) => updater(prev));
    } else {
      setRawLinks(updater);
    }
  }});

  // Ref for the canvas container (zoomable/pannable)
  const containerRef = useRef(null);
  const outerRef = useRef(null);

  // Optimized visible nodes calculation (moved after outerRef declaration)
  const visibleNodes = useVisibleNodes(nodes, pan, zoom, outerRef);

  // Optimized visible links calculation
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleLinks = useVisibleLinks(links, visibleNodeIds);

  // === PERFORMANCE: O(1) lookup maps rebuilt only when data changes ===
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const selectedNodeSet = useMemo(() => new Set(selectedNodes), [selectedNodes]);

  // Simplified rendering only at extreme zoom-out (below 8%)
  const lowDetail = zoom < 0.08;

  const [tempBgColor, setTempBgColor] = useState("#1e1e1e");
  const [tempTextColor, setTempTextColor] = useState("#fff");
  const [tempText, setTempText] = useState("");
  const [tempWidth, setTempWidth] = useState(DEFAULT_WIDTH);
  const [tempHeight, setTempHeight] = useState(DEFAULT_HEIGHT);
  const [tempFontFamily, setTempFontFamily] = useState("cursive");
  const [tempFontSize, setTempFontSize] = useState(14);

  // Z-index management
  const [tempZIndex, setTempZIndex] = useState(1);

  // Optimized node operations with batching
  const setNodes = useCallback((updater) => {
    if (typeof updater === 'function') {
      const currentNodes = nodeStateManager.getNodes();
      const newNodes = updater(currentNodes);
      setRawNodes(newNodes);
    } else {
      setRawNodes(updater);
    }
  }, [nodeStateManager]);



  // Optimized batch node updates
  const updateMultipleNodes = useCallback((nodeUpdates, immediate = false) => {
    const hasChanges = updateNodesOptimized(nodeUpdates, immediate);
    
    // Also update Firebase if immediate and there are changes
    if (immediate && hasChanges) {
      const batch = writeBatch(db);
      Object.entries(nodeUpdates).forEach(([id, updates]) => {
        if (Object.keys(updates).length > 0) {
          const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
          batch.update(nodeRef, updates);
        }
      });
      batch.commit().catch(console.error);
    }
    
    return hasChanges;
  }, [updateNodesOptimized, mindMapId]);
  
  // Z-index functions with optimized updates
  const handleBringToFront = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    
    pushSelectionToUndoStack();
    
    // Find the highest z-index among all nodes
    const maxZIndex = Math.max(...nodes.map(n => n.zIndex || 1), 1);
    const newZIndex = maxZIndex + 1;
    
    // Optimized batch update
    const updates = {};
    selectedNodes.forEach(id => {
      updates[id] = { zIndex: newZIndex };
    });
    
    updateMultipleNodes(updates, true);
  }, [selectedNodes, nodes, updateMultipleNodes]);

  const handleSendToBack = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    
    pushSelectionToUndoStack();
    
    // Find the lowest z-index among all nodes
    const minZIndex = Math.min(...nodes.map(n => n.zIndex || 1), 1);
    const newZIndex = Math.max(minZIndex - 1, 0);
    
    // Optimized batch update
    const updates = {};
    selectedNodes.forEach(id => {
      updates[id] = { zIndex: newZIndex };
    });
    
    updateMultipleNodes(updates, true);
  }, [selectedNodes, nodes, updateMultipleNodes]);

  const handleZIndexChange = useCallback(async (newZIndex) => {
    if (selectedNodes.length === 0) return;
    
    pushSelectionToUndoStack();
    
    // Optimized batch update
    const updates = {};
    selectedNodes.forEach(id => {
      updates[id] = { zIndex: newZIndex };
    });
    
    updateMultipleNodes(updates, true);
  }, [selectedNodes, updateMultipleNodes]);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const multiDragStartRef = useRef({});
  const [isDragging, setIsDragging] = useState(false);
  const groupDeltaRef = useRef({ x: 0, y: 0 });
  const [groupDelta, setGroupDelta] = useState({ x: 0, y: 0 });
  const isAnimatingRef = useRef(false);
  
  // Memoized active customization node
  const activeCustomizationNode = useMemo(() => 
    selectedNodes.length ? nodes.find((n) => n.id === selectedNodes[0]) : null,
    [selectedNodes, nodes]
  );



  // Memoized update group delta function
  const updateGroupDelta = useCallback((delta) => {
    groupDeltaRef.current = delta;
    if (!isAnimatingRef.current) {
      isAnimatingRef.current = true;
      requestAnimationFrame(() => {
        setGroupDelta({ ...groupDeltaRef.current });
        isAnimatingRef.current = false;
      });
    }
  }, []);

  // Sidebar temp state for styling
  const [tempTextStyle, setTempTextStyle] = useState([]);
  const [tempTextAlign, setTempTextAlign] = useState("left");

  // presetSizes imported from constants.js
  const rightClickStartRef = useRef(null);
  const [rightClickMoved, setRightClickMoved] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const [contextMenuu, setContextMenu] = useState({ visible: false, x: 0, y: 0, type: null });
  
  // Memoized context menu close function
  const closeContextMenu = useCallback(() => 
    setContextMenu({ visible: false, x: 0, y: 0, type: null }), []);
  
  // Memoized canvas context menu handler
  const handleCanvasContextMenu = useCallback((e) => {
    if (rightClickMoved) {
      e.preventDefault();
      return;
    }
    
    if (selectedNodes.length) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: "node"
      });
      return;
    }
    
    if (!e.target.closest(".mindmap-node")) {
    setContextMenu({
      visible: true,
      x: e.clientX,
        y: e.clientY,
      type: "canvas"
    });
    } else {
      setContextMenu({
        visible: true,
        x: e.clientX,
          y: e.clientY,
        type: "node"
      });
    } 
  }, [rightClickMoved, selectedNodes.length]);

  // Memoized reset handler
  const handleReset = useCallback(() => {
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    zoomRef.current = 1;
    console.log("Reset pan/zoom");
    closeContextMenu();
  }, [closeContextMenu]);



  // Loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [operationInProgress, setOperationInProgress] = useState(false);

  // Notification system
  

  // Keyboard shortcuts and help system
  const [showHotkeyHelp, setShowHotkeyHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(() => {
    try {
      const raw = localStorage.getItem('mindmap-settings');
      if (raw) return JSON.parse(raw).showMiniMapByDefault ?? true;
    } catch {}
    return true;
  });
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);

  // HOTKEYS imported from constants.js

  // Search functionality
  const performSearch = useCallback((query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    const results = nodes.filter(node => 
      node.text && node.text.toLowerCase().includes(query.toLowerCase())
    ).map(node => node.id);
    
    setSearchResults(results);
    setCurrentSearchIndex(0);
    
    // Highlight first result
    if (results.length > 0) {
      setSelectedNodes([results[0]]);
      focusOnNode(results[0]);
    }
  }, [nodes]);

  // Focus on a specific node
  const focusOnNode = useCallback((nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const rect = outerRef.current.getBoundingClientRect();
    const sidebarWidth = 250;
    const topBarHeight = 50;
    const canvasWidth = rect.width - sidebarWidth;
    const canvasHeight = rect.height - topBarHeight;

    const targetX = node.x + (node.width || DEFAULT_WIDTH) / 2;
    const targetY = node.y + (node.height || DEFAULT_HEIGHT) / 2;

    const newPan = {
      x: (canvasWidth / 2) - targetX * zoom,
      y: (canvasHeight / 2) - targetY * zoom,
    };

    setPan(newPan);
    panRef.current = newPan;
  }, [nodes, zoom]);

  // Navigate search results
  const navigateSearch = useCallback((direction) => {
    if (searchResults.length === 0) return;
    
    let newIndex;
    if (direction === 'next') {
      newIndex = (currentSearchIndex + 1) % searchResults.length;
    } else {
      newIndex = currentSearchIndex === 0 ? searchResults.length - 1 : currentSearchIndex - 1;
    }
    
    setCurrentSearchIndex(newIndex);
    setSelectedNodes([searchResults[newIndex]]);
    focusOnNode(searchResults[newIndex]);
  }, [searchResults, currentSearchIndex, focusOnNode]);

  // Auto-layout function
  const autoLayout = useCallback(async () => {
    if (nodes.length === 0) return;
    
    setOperationInProgress(true);
    try {
      // Simple force-directed layout
      const centerX = 0;
      const centerY = 0;
      const radius = 200;
      const angleStep = (2 * Math.PI) / nodes.length;
      
      const batch = writeBatch(db);
      nodes.forEach((node, index) => {
        const angle = index * angleStep;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
        batch.update(nodeRef, { x, y });
      });
      
      await batch.commit();
    } catch (error) {
      console.error("Error auto-layouting nodes:", error);
    } finally {
      setOperationInProgress(false);
    }
  }, [nodes, mindMapId]);

  // Select all nodes
  const selectAllNodes = useCallback(() => {
    setSelectedNodes(nodes.map(n => n.id));
  }, [nodes]);

  // Zoom to fit all nodes
  const zoomToFitAll = useCallback(() => {
    if (nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((node) => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + width);
      maxY = Math.max(maxY, node.y + height);
    });

    const rect = outerRef.current.getBoundingClientRect();
    const sidebarWidth = 250;
    const topBarHeight = 50;
    const canvasWidth = rect.width - sidebarWidth;
    const canvasHeight = rect.height - topBarHeight;

    const marginFactor = 0.8;
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    const zoomX = (canvasWidth * marginFactor) / boxWidth;
    const zoomY = (canvasHeight * marginFactor) / boxHeight;
    const newZoom = Math.min(zoomX, zoomY, MAX_ZOOM);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newPan = {
      x: (canvasWidth / 2) - centerX * newZoom,
      y: (canvasHeight / 2) - centerY * newZoom,
    };

    setZoom(newZoom);
    zoomRef.current = newZoom;
    setPan(newPan);
    panRef.current = newPan;
  }, [nodes]);

  // Add connected node at mouse position
  const addConnectedNode = useCallback(async () => {
    if (selectedNodes.length !== 1) return;
    
    const parentNode = nodes.find(n => n.id === selectedNodes[0]);
    if (!parentNode) return;

    try {
      // Use mouse position if available, otherwise offset from parent
      const newX = localCursorRef.current.x || (parentNode.x + 150);
      const newY = localCursorRef.current.y || parentNode.y;

      const nw = settings.defaultNodeWidth || DEFAULT_WIDTH;
      const nh = settings.defaultNodeHeight || DEFAULT_HEIGHT;
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: newX - nw / 2,
        y: newY - nh / 2,
        width: nw,
        height: nh,
        lockedBy: null,
        typing: false,
        bgColor: settings.defaultBgColor || null,
        textColor: settings.defaultTextColor || "#EAEAEA",
        fontSize: settings.defaultFontSize || 14,
        fontFamily: settings.defaultFontFamily || "cursive",
        textAlign: settings.defaultTextAlign || "left",
        textStyle: settings.defaultTextStyle || [],
        createdAt: serverTimestamp(),
      });

      // Create link between parent and new node (skip undo in createLink, we handle it below)
      const linkData = { source: selectedNodes[0], target: docRef.id };
      const linkDocRef = await addDoc(collection(db, "mindMaps", mindMapId, "links"), linkData);

      // Push compound undo action: new node + new link
      pushAction({
        type: 'compound',
        nodes: {
          before: { [docRef.id]: null },
          after: { [docRef.id]: { id: docRef.id, isNew: true } },
        },
        links: {
          before: { [linkDocRef.id]: null },
          after: { [linkDocRef.id]: { id: linkDocRef.id, ...linkData } },
        },
      });

      // Select the new node and start editing
      setSelectedNodes([docRef.id]);
      
      // Auto-start editing the new node
      setTimeout(() => {
        setEditingNodeId(docRef.id);
        setEditedText("New Node");
      }, 100);
      
    } catch (error) {
      console.error("Error adding connected node:", error);
    }
  }, [selectedNodes, nodes, mindMapId, settings, pushAction]);


  // Firebase subscriptions (extracted to hook)
  useFirebaseSubscriptions({
    mindMapId, currentUserUid, currentUserEmail,
    setCurrentUserEmail, setCurrentUserUid, setRawNodes, setRawLinks,
    setPresenceUsers, setCursors, setIsLoading, setError,
    setSelectedNodes, localCursorRef, containerRef, outerRef, pan, zoom,
    panRef, zoomRef,
    nodes, selectedNodes,
    editingNodeId, isDragging,
  });








  const handleNodeClick = (node, e) => {
    e.stopPropagation();

    if (linkingMode) {
      if (!linkingSource) {
        setLinkingSource(node.id);
      } else if (linkingSource === node.id) {
        setLinkingSource(null);
      } else {
        const source = linkingSource;
        createLink(source, node.id)
          .then((linkId) => {
            if (linkId) {
              // Track link creation for undo
              pushAction({
                type: 'link_create',
                nodes: { before: {}, after: {} },
                links: {
                  before: { [linkId]: null },
                  after: { [linkId]: { id: linkId, source: source, target: node.id } },
                },
              });
              setLinkingSource(null);
            }
          })
          .catch((error) => {
            console.error("Error creating link:", error);
          });
      }
    } else {
      // Multi-select: toggle node selection on ctrl/meta click.
      if (e.ctrlKey || e.metaKey) {
        setSelectedNodes((prev) =>
          prev.includes(node.id)
            ? prev.filter((id) => id !== node.id)
            : [...prev, node.id],
        );
      } else {
        // Otherwise, select just this node.
        setSelectedNodes([node.id]);
      }
    }
  };







  const handleResizeMouseDown = (node, e, direction = 'se') => {
    if (e.button !== 0) return;
    
    // Create a Map for O(1) node lookups instead of O(n) find operations
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    
    // Determine which nodes to resize (single node or all selected nodes)
    const nodesToResize = selectedNodes.length > 1 && selectedNodeSet.has(node.id) 
      ? selectedNodes.map(id => nodeMap.get(id)).filter(Boolean)
      : [node];
    
    // Push all nodes to undo stack
    nodesToResize.forEach(n => pushSingleNodeToUndoStack(n));
    
    e.stopPropagation();
    e.preventDefault();
    
    const startX = e.clientX;
    const startY = e.clientY;
    
    // Store initial dimensions and positions for all nodes
    const initialData = new Map(nodesToResize.map(n => [n.id, {
      id: n.id,
      width: n.width || DEFAULT_WIDTH,
      height: n.height || DEFAULT_HEIGHT,
      x: n.x,
      y: n.y
    }]));
    
    // Store final states for Firebase update
    let finalStates = {};
    let animationId = null;
    let lastMoveTime = 0;
    
    // Memoize resize calculation function
    const calculateNewDimensions = (nodeData, deltaX, deltaY, direction) => {
      let newWidth = nodeData.width;
      let newHeight = nodeData.height;
      let newX = nodeData.x;
      let newY = nodeData.y;
      
      // Apply resize based on direction
      switch (direction) {
        case 'se': // Southeast (bottom-right)
          newWidth = Math.max(50, nodeData.width + deltaX);
          newHeight = Math.max(20, nodeData.height + deltaY);
          break;
        case 'sw': // Southwest (bottom-left)
          newWidth = Math.max(50, nodeData.width - deltaX);
          newHeight = Math.max(20, nodeData.height + deltaY);
          newX = nodeData.x + Math.min(deltaX, nodeData.width - 50);
          break;
        case 'ne': // Northeast (top-right)
          newWidth = Math.max(50, nodeData.width + deltaX);
          newHeight = Math.max(20, nodeData.height - deltaY);
          newY = nodeData.y + Math.min(deltaY, nodeData.height - 20);
          break;
        case 'nw': // Northwest (top-left)
          newWidth = Math.max(50, nodeData.width - deltaX);
          newHeight = Math.max(20, nodeData.height - deltaY);
          newX = nodeData.x + Math.min(deltaX, nodeData.width - 50);
          newY = nodeData.y + Math.min(deltaY, nodeData.height - 20);
          break;
        case 'n': // North (top)
          newHeight = Math.max(20, nodeData.height - deltaY);
          newY = nodeData.y + Math.min(deltaY, nodeData.height - 20);
          break;
        case 's': // South (bottom)
          newHeight = Math.max(20, nodeData.height + deltaY);
          break;
        case 'w': // West (left)
          newWidth = Math.max(50, nodeData.width - deltaX);
          newX = nodeData.x + Math.min(deltaX, nodeData.width - 50);
          break;
        case 'e': // East (right)
          newWidth = Math.max(50, nodeData.width + deltaX);
          break;
      }
      
      return { newWidth, newHeight, newX, newY };
    };
    
    // Throttled update function using requestAnimationFrame
    const updateNodes = (deltaX, deltaY) => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      
      animationId = requestAnimationFrame(() => {
        const nodesToUpdate = new Map();
        
        // Calculate all new dimensions first
        for (const [nodeId, nodeData] of initialData) {
          const dimensions = calculateNewDimensions(nodeData, deltaX, deltaY, direction);
          nodesToUpdate.set(nodeId, dimensions);
          
          // Store final state for this node
          finalStates[nodeId] = dimensions;
        }
        
        // Single state update with all changes
        setNodes((prevNodes) =>
          prevNodes.map((n) => {
            const update = nodesToUpdate.get(n.id);
            if (!update) return n;
            
            return {
              ...n,
              width: update.newWidth,
              height: update.newHeight,
              x: update.newX,
              y: update.newY
            };
          })
        );
      });
    };
    
    // Throttled mouse move handler
    const onMouseMove = (moveEvent) => {
      const now = performance.now();
      
      // Throttle to ~60fps (16ms)
      if (now - lastMoveTime < 16) return;
      lastMoveTime = now;
      
      const deltaX = (moveEvent.clientX - startX) / zoom;
      const deltaY = (moveEvent.clientY - startY) / zoom;
      
      updateNodes(deltaX, deltaY);
    };

    const onMouseUp = async () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      
      // Cancel any pending animation frame
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      
      // Batch Firebase updates for better performance
      try {
        if (Object.keys(finalStates).length > 0) {
          // Use Firebase batch write for atomic updates
          const batch = writeBatch(db);
          
          for (const [nodeId, finalState] of Object.entries(finalStates)) {
            const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
            batch.update(nodeRef, finalState);
          }
          
          await batch.commit();
        }
      } catch (error) {
        console.error("Error updating node sizes:", error);
      }
    };
    
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseup", onMouseUp);
  };
  // --- ZOOM HANDLERS ---
  const handleZoomIn = () => {
    const container = outerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(MAX_ZOOM, oldZoom + ZOOM_STEP);
    
    const pointInWorld = {
      x: (centerX - panRef.current.x) / oldZoom,
      y: (centerY - panRef.current.y) / oldZoom,
    };
    
    const newPan = {
      x: centerX - pointInWorld.x * newZoom,
      y: centerY - pointInWorld.y * newZoom,
    };
    
    zoomRef.current = newZoom;
    panRef.current = newPan;
    applyTransformDirect();
    // Button clicks are discrete — sync to React state immediately
    setZoom(newZoom);
    setPan(newPan);
  };

  const handleZoomOut = () => {
    const container = outerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const oldZoom = zoomRef.current;
    const newZoom = Math.max(MIN_ZOOM, oldZoom - ZOOM_STEP);
    
    const pointInWorld = {
      x: (centerX - panRef.current.x) / oldZoom,
      y: (centerY - panRef.current.y) / oldZoom,
    };
    
    const newPan = {
      x: centerX - pointInWorld.x * newZoom,
      y: centerY - pointInWorld.y * newZoom,
    };
    
    zoomRef.current = newZoom;
    panRef.current = newPan;
    applyTransformDirect();
    // Button clicks are discrete — sync to React state immediately
    setZoom(newZoom);
    setPan(newPan);
  };
  useEffect(() => {
    const container = outerRef.current;
    const container2 = containerRef.current;
    if (!container || !container2) return;

    // Wheel zoom: bypass React entirely, only sync state after settling
    const handleWheelCustom = (e) => {
      let scaleBy = e.shiftKey ? 1.15 : 1.05;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const oldZoom = zoomRef.current;
      let newZoom;
      if (e.deltaY < 0) {
        newZoom = Math.min(MAX_ZOOM, oldZoom * scaleBy);
      } else {
        newZoom = oldZoom / scaleBy;
      }

      const mousePointTo = {
        x: (cursorX - panRef.current.x) / oldZoom,
        y: (cursorY - panRef.current.y) / oldZoom,
      };

      const newPan = {
        x: cursorX - mousePointTo.x * newZoom,
        y: cursorY - mousePointTo.y * newZoom,
      };

      // Update refs and DOM directly — NO React re-render
      zoomRef.current = newZoom;
      panRef.current = newPan;
      applyTransformDirect();
      scheduleStateSync();
    };

    container.addEventListener("wheel", handleWheelCustom, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheelCustom);
    };
  }, []); // No dependencies — refs handle everything



  // --- PANNING ---
  const handleContextMenu = (e) => {
    e.preventDefault();
    
  };


  
  const handleMouseDown = (e) => {
    if (e.button !== 2) return;
    if (
      document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA"
    ) {} else {
      e.preventDefault();
    }
    panStart.current = { ...panRef.current };
    rightClickStartRef.current = { x: e.clientX, y: e.clientY };
    mouseStart.current = { x: e.clientX, y: e.clientY };
    isPanningRef.current = true;
    
    // Direct DOM panning — bypass React entirely
    const updatePan = (moveEvent) => {
      const dx = moveEvent.clientX - mouseStart.current.x;
      const dy = moveEvent.clientY - mouseStart.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 15) {
        setRightClickMoved(true);
      }

      const deltaX = moveEvent.clientX - mouseStart.current.x;
      const deltaY = moveEvent.clientY - mouseStart.current.y;
      panRef.current = {
        x: panStart.current.x + deltaX,
        y: panStart.current.y + deltaY
      };
      applyTransformDirect();
    };

    document.addEventListener("mousemove", updatePan);
    document.addEventListener("mouseup", function handleMouseUp() {
      document.removeEventListener("mousemove", updatePan);
      document.removeEventListener("mouseup", handleMouseUp);
      isPanningRef.current = false;
      // Sync to React state now that panning is done
      setPan({ ...panRef.current });
    });
  };

  // --- NODE ACTIONS ---
  const handleAddNode = useCallback(async ({ atCursor = false } = {}) => {
    if (!mindMapId) return;
    if (operationInProgress) return;
    
    try {
      let nodeX, nodeY;
      
      if (atCursor) {
        // Place at cursor position
        nodeX = localCursorRef.current.x - DEFAULT_WIDTH / 2;
        nodeY = localCursorRef.current.y - DEFAULT_HEIGHT / 2;
      } else {
        // Place at canvas center
        const currentPan = panRef.current;
        const currentZoom = zoomRef.current;
        const rect = outerRef.current.getBoundingClientRect();
        const sidebarWidth = 250;
        const topBarHeight = 50;
        const canvasWidth = rect.width - sidebarWidth;
        const canvasHeight = rect.height - topBarHeight;
        nodeX = ((canvasWidth / 2) - currentPan.x) / currentZoom;
        nodeY = ((canvasHeight / 2) - currentPan.y) / currentZoom;
      }
      
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "",
        x: settings.snapToGrid ? Math.round(nodeX / settings.gridSize) * settings.gridSize : nodeX,
        y: settings.snapToGrid ? Math.round(nodeY / settings.gridSize) * settings.gridSize : nodeY,
        width: settings.defaultNodeWidth || DEFAULT_WIDTH,
        height: settings.defaultNodeHeight || DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        bgColor: settings.defaultBgColor || null,
        textColor: settings.defaultTextColor || "#EAEAEA",
        fontSize: settings.defaultFontSize || 14,
        fontFamily: settings.defaultFontFamily || "cursive",
        textAlign: settings.defaultTextAlign || "left",
        textStyle: settings.defaultTextStyle || [],
        createdAt: serverTimestamp(),
      });
      
      if (settings.autoSelectNewNodes !== false) setSelectedNodes([docRef.id]);
      
      // Auto-start editing the new node so the user can type immediately
      setTimeout(() => {
        setEditingNodeId(docRef.id);
        setEditedText("");
      }, 150);
      
    } catch (error) {
      console.error("Error adding node:", error);
    }
  }, [mindMapId, operationInProgress, settings]);

  const handleDoubleClick = useCallback((node) => {
    if (linkingMode) return;
    if (node.type === "image") return;
    if (node.lockedBy && node.lockedBy !== currentUserEmail) {
      return;
    }
    
    if (editingNodeId === node.id) {
      return; // Prevent double-click from reverting text changes
    }
    
    const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
    updateDoc(nodeRef, { lockedBy: currentUserEmail, typing: true }).catch((error) => {
      console.error("Error locking node:", error);
    });
    
    setEditingNodeId(node.id);
    setEditedText(node.text);
  }, [linkingMode, currentUserEmail, mindMapId, editingNodeId]);

  const handleTextBlur = useCallback(async (nodeId) => {
    try {
      pushSelectionToUndoStack();
      
      // Strip HTML tags to check if content is empty
      const plainText = editedText.replace(/<[^>]*>/g, "").trim();
      const finalText = plainText ? editedText : "Untitled";
      
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
      await updateDoc(nodeRef, {
        text: finalText,
        lockedBy: null,
        typing: false,
        lastModified: serverTimestamp(),
      });
      
      setEditingNodeId(null);
      setEditedText("");
      
    } catch (error) {
      console.error("Error updating node text:", error);
    }
  }, [editedText, selectedNodes, mindMapId]);

  const handleTyping = useCallback((nodeId) => {
    const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
    updateDoc(nodeRef, { typing: true }).catch((error) => {
      console.error("Error setting typing status:", error);
    });
  }, [mindMapId]);

  const updateNodeText = useCallback(async (nodeId, newText, { trackUndo = true } = {}) => {
    try {
      if (trackUndo) pushSelectionToUndoStack();
      
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
      await updateDoc(nodeRef, {
        text: newText.trim(),
        lastModified: serverTimestamp(),
      });
      
      // Update local state
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, text: newText.trim() } : n))
      );
      
    } catch (error) {
      console.error("Error updating node text:", error);
      throw error;
    }
  }, [mindMapId]);

  const addNode = useCallback(async (nodeData, { trackUndo = true } = {}) => {
    try {
      if (trackUndo) pushSelectionToUndoStack();
      
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: nodeData.text || "New Node",
        x: nodeData.x || 0,
        y: nodeData.y || 0,
        width: nodeData.width || settings.defaultNodeWidth || DEFAULT_WIDTH,
        height: nodeData.height || settings.defaultNodeHeight || DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        textColor: nodeData.textColor || settings.defaultTextColor || "#EAEAEA",
        fontSize: nodeData.fontSize || settings.defaultFontSize || 14,
        fontFamily: nodeData.fontFamily || settings.defaultFontFamily || "cursive",
        bgColor: nodeData.bgColor || settings.defaultBgColor || null,
        textAlign: nodeData.textAlign || settings.defaultTextAlign || "left",
        textStyle: nodeData.textStyle || settings.defaultTextStyle || [],
        type: nodeData.type || "text",
        imageUrl: nodeData.imageUrl || null,
        storagePath: nodeData.storagePath || null,
        createdAt: serverTimestamp(),
      });
      
      return docRef.id;
    } catch (error) {
      console.error("Error adding node:", error);
      throw error;
    }
  }, [mindMapId, settings]);

  const addLink = useCallback(async (linkData, { trackUndo = true } = {}) => {
    try {
      await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
        source: linkData.source,
        target: linkData.target,
      });
    } catch (error) {
      console.error("Error adding link:", error);
      throw error;
    }
  }, [mindMapId]);







  // For mouse down (start selection):
  // Mouse handlers attached to the outer container:
  // rectsIntersect imported from constants.js


  const handleOuterMouseDown = (e) => {
    if (isDragging) return;
    if (e.button !== 0) return; // left click only
    const outerRect = outerRef.current.getBoundingClientRect();
    // Store whether Control was held:
    setIsMultiSelect(e.ctrlKey || e.metaKey);
    // Convert screen to world coordinates:
    const startX = (e.clientX - outerRect.left - pan.x) / zoom;
    const startY = (e.clientY - outerRect.top - pan.y) / zoom;
    setSelectionBox({
      startX,
      startY,
      x: startX,
      y: startY,
      width: 0,
      height: 0,
    });
  };

  const handleOuterMouseMove = (e) => {
    if (!selectionBox) return;
    if (isDragging) return;
    const outerRect = outerRef.current.getBoundingClientRect();
    const currentX = (e.clientX - outerRect.left - pan.x) / zoom;
    const currentY = (e.clientY - outerRect.top - pan.y) / zoom;
    const x = Math.min(selectionBox.startX, currentX);
    const y = Math.min(selectionBox.startY, currentY);
    const width = Math.abs(currentX - selectionBox.startX);
    const height = Math.abs(currentY - selectionBox.startY);
    const newBox = { ...selectionBox, x, y, width, height };
  
    // Update the selection box state.
    setSelectionBox(newBox);

    const newSelection = visibleNodes
    .filter((node) => {
      const nodeRect = {
        x: node.x,
        y: node.y,
        width: node.width || DEFAULT_WIDTH,
        height: node.height || DEFAULT_HEIGHT,
      };
      return rectsIntersect(nodeRect, newBox);
    })
    .map((n) => n.id);
    
    if (selectedNodes != newSelection) {
      setSelectedNodes(newSelection);
    }
    //setSelectedNodes(newSelection);
  // Update selection instantly. For multi-select vs. single select,
  // you could merge the toggle logic if needed; here we simply replace the selection.
  };

  const handleOuterMouseUp = (e) => {
    if (!selectionBox) return;
    //setSelectionBox(null);
    //return;
    // Determine which nodes are within the selection box.
    // (This example uses full containment; you may adjust to partial intersection.)
    const newSelection = visibleNodes
      .filter((node) => {
        const nodeWidth = node.width || DEFAULT_WIDTH;
        const nodeHeight = node.height || DEFAULT_HEIGHT;
        return (
          node.x < selectionBox.x + selectionBox.width &&
          node.x + node.width > selectionBox.x &&
          node.y < selectionBox.y + selectionBox.height &&
          node.y + node.height > selectionBox.y
        );
      })
      .map((n) => n.id);

    // If Control was held during the marquee, merge/toggle selection
    if (isMultiSelect) {
      // For each node in newSelection, toggle it in selectedNodes
      setSelectedNodes((prev) => {
        const newSelected = [...prev];
        newSelection.forEach((id) => {
          if (newSelected.includes(id)) {
            // Toggle off:
            newSelected.splice(newSelected.indexOf(id), 1);
          } else {
            // Toggle on:
            newSelected.push(id);
          }
        });
        return newSelected;
      });
    } else {
      // Replace selection
      setSelectedNodes(newSelection);
    }
    setSelectionBox(null);
  };



  const duplicateNodeWithPosition = async (node, newPosition, nodeIdMapping = null) => {
    if (!mindMapId) return null;
    // Destructure original node's id and data.
    const { id: originalNodeId, ...nodeData } = node;
    let newNodeId;
    try {
      const newDocRef = await addDoc(
        collection(db, "mindMaps", mindMapId, "nodes"),
        {
          ...nodeData,
          x: newPosition.x,
          y: newPosition.y,
          lockedBy: null,
          typing: false,
        }
      );
      newNodeId = newDocRef.id;
      //console.log("Duplicated node with new id:", newNodeId);

      // Duplicate outgoing links.
      const outgoingQuery = query(
        collection(db, "mindMaps", mindMapId, "links"),
        where("source", "==", originalNodeId)
      );
      const outgoingSnapshot = await getDocs(outgoingQuery);
      for (const docSnap of outgoingSnapshot.docs) {
        const linkData = docSnap.data();
        // If we have a mapping and the target is part of the group copy, use its new id.
        const newTarget = nodeIdMapping && nodeIdMapping[linkData.target] ? nodeIdMapping[linkData.target] : null;
        // Only duplicate the link if the new target exists.
        if (newTarget) {
          await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
            ...linkData,
            source: newNodeId,
            target: newTarget,
          });
        }
      }

      // Duplicate incoming links.
      const incomingQuery = query(
        collection(db, "mindMaps", mindMapId, "links"),
        where("target", "==", originalNodeId)
      );
      const incomingSnapshot = await getDocs(incomingQuery);
      for (const docSnap of incomingSnapshot.docs) {
        const linkData = docSnap.data();
        const newSource = nodeIdMapping && nodeIdMapping[linkData.source] ? nodeIdMapping[linkData.source] : null;
        if (newSource) {
          await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
            ...linkData,
            source: newSource,
            target: newNodeId,
          });
        }
      }
    } catch (error) {
      console.error("Error duplicating node and links:", error);
      return null;
    }
    // Return the new node's id for undo purposes.
    return newNodeId;
  };

  const ensureParentProperty = (nodes, links) => {
    const nodeMap = {};
    nodes.forEach((node) => {
      nodeMap[node.id] = node;
    });
    let modified = false;
    // For each link, if the target node has no parent, assign it.
    links.forEach((link) => {
      const targetNode = nodeMap[link.target];
      if (targetNode && (targetNode.parent === undefined || targetNode.parent === null)) {
        targetNode.parent = link.source;
        modified = true;
      }
    });
    // For any node that still lacks a parent property, set it explicitly to null.
    nodes.forEach((node) => {
      if (node.parent === undefined) {
        node.parent = null;
        modified = true;
      }
    });
    return { nodes, modified };
  };

  const mergeMindMapDataHandler = async (aiData, dropPosition, whatLayout) => {
    if (!aiData.nodes || !aiData.links) return;
    // Compute layout and levels using the new function.
    const { nodes: fixedNodes, modified } = ensureParentProperty(aiData.nodes, aiData.links);
    const layoutResult = 
  whatLayout === "bottomLay"
    ? computePyramidLayoutWithLevels(fixedNodes, aiData.links, 150, 800, 1.5)
    : whatLayout === "rightLay"
    ? computeHorizontalTreeLayout(fixedNodes, aiData.links, 150, 800, 1.5)
    : computeRadialLayout(fixedNodes, aiData.links, 150, 800, 1.5);

    const { layout: computedLayout, levelMap } = layoutResult;
    //console.log("Computed layout:", computedLayout, "Level map:", levelMap);

    // Calculate bounding box for computed layout.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.values(computedLayout).forEach(({ x, y }) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    const groupCenterX = (minX + maxX) / 2;
    const groupCenterY = (minY + maxY) / 2;
    const offsetX = dropPosition.x - groupCenterX;
    const offsetY = dropPosition.y - groupCenterY;

    // Define a color palette.
    const palette = ["#2C3E50", "#1ABC9C", "#3498DB", "#9B59B6", "#E74C3C"];

    // Batch write for nodes.
    const nodeIdMapping = {};
    const undoMapping = {};
    const batchNodes = writeBatch(db);
    for (const node of fixedNodes) {
      const newNodeRef = doc(collection(db, "mindMaps", mindMapId, "nodes"));
      const layoutPos = computedLayout[node.id] || { x: 0, y: 0 };
      const level = levelMap[node.id] || 0;
      const colorIndex = level % palette.length;
      const assignedBgColor = palette[colorIndex];
      

      // Optionally, adjust dimensions and font sizes.
      let width = 100;
      let height = 40;
      let fontSize = 14;
      if (level === 0) {
        const textLength = node.text ? node.text.length : 0;
        width = Math.max(180, textLength * 1.25);
        height = Math.max(60, textLength * 1);
        fontSize = 28;
      } else {
        // For other nodes, you might adjust based on text length.
        const textLength = node.text ? node.text.length : 0;
        width = Math.max(100, textLength * 1.1);
        height = Math.max(45, textLength * 2);
        //fontSize = Math.min(14, Math.floor(14 * (1000 / width)));
      }

      const newNodeData = {
        ...node,
        x: layoutPos.x + offsetX,
        y: layoutPos.y + offsetY,
        id: newNodeRef.id,
        bgColor: node.bgColor || assignedBgColor,
        textColor: node.textColor || "#ECF0F1",
        width,
        height,
        fontSize,
      };
      //nodeIdMapping[node.id] = newNodeRef.id;
      //nodeIdMapping[node.id] = { ...newNodeData };
      nodeIdMapping[node.id] = newNodeRef.id;
      undoMapping[newNodeRef.id] = {newNodeData, isNew: true};
      //nodeIdMapping[`${node.id}-${index}`] = newNodeRef.id;
      batchNodes.set(newNodeRef, newNodeData);
    }
    await batchNodes.commit();
    
    console.log("Undo snapshot (nodes):", nodeIdMapping);
    const undoSnapshot = { nodes: { ...undoMapping } };
    pushSelectionToUndoStack(undoSnapshot);

    // Batch write for links.
    const batchLinks = writeBatch(db);
    for (const link of aiData.links) {
      const newSource = nodeIdMapping[link.source];
      const newTarget = nodeIdMapping[link.target];
      if (!newSource || !newTarget) {
        console.error("Skipping link: missing mapping for source or target");
        continue;
      }
      const newLinkRef = doc(collection(db, "mindMaps", mindMapId, "links"));
      batchLinks.set(newLinkRef, {
        ...link,
        source: newSource,
        target: newTarget,
      });
    }
    await batchLinks.commit();

    

    console.log("Merged AI-generated mind map at drop position:", dropPosition);
  };





  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    // Compute drop position from the event instead of localCursor.
    const rect = outerRef.current.getBoundingClientRect();
    const currentPan = panRef.current;
    const currentZoom = zoomRef.current;
    // Convert client coordinates to world coordinates:
    const dropX = (e.clientX - rect.left - currentPan.x) / currentZoom;
    const dropY = (e.clientY - rect.top - currentPan.y) / currentZoom;

    const groupUndoSnapshot = {};

    if (file.type === "application/json" || file.name.endsWith(".json")) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.nodes || !data.links) {
          throw new Error("Invalid file format");
        }
        // Calculate bounding box for the imported nodes.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        data.nodes.forEach((node) => {
          if (node.x < minX) minX = node.x;
          if (node.y < minY) minY = node.y;
          if (node.x > maxX) maxX = node.x;
          if (node.y > maxY) maxY = node.y;
        });
        const groupCenterX = (minX + maxX) / 2;
        const groupCenterY = (minY + maxY) / 2;
        // Compute offset to align the group's center with the drop (cursor) position.
        const offsetX = dropX - groupCenterX;
        const offsetY = dropY - groupCenterY;

        const nodeIdMapping = {};

        // Batch write for nodes.
        const batchNodes = writeBatch(db);
        data.nodes.forEach((node) => {
          const oldId = node.id; // preserve old ID for mapping
          const newNodeRef = doc(collection(db, "mindMaps", mindMapId, "nodes"));
          const newNodeData = {
            ...node,
            x: node.x + offsetX,
            y: node.y + offsetY,
            id: newNodeRef.id, // override with new document id
          };
          batchNodes.set(newNodeRef, newNodeData);
          nodeIdMapping[oldId] = newNodeRef.id;
          groupUndoSnapshot[newNodeRef.id] = { id: newNodeRef.id, isNew: true };
        });
        await batchNodes.commit();

        // Batch write for links.
        const batchLinks = writeBatch(db);
        data.links.forEach((link) => {
          const newSource = nodeIdMapping[link.source];
          const newTarget = nodeIdMapping[link.target];
          if (!newSource || !newTarget) {
            console.error("Skipping link: missing mapping for source or target");
            return;
          }
          const { id, ...linkData } = link;
          const linkRef = doc(collection(db, "mindMaps", mindMapId, "links"));
          batchLinks.set(linkRef, {
            ...linkData,
            source: newSource,
            target: newTarget,
          });
        });
        await batchLinks.commit();

        console.log("Imported mind map JSON file at cursor position using batch writes.");
      } catch (error) {
        console.error("Error importing mind map:", error);
      }
    }

    // Otherwise, if it's an image file, handle as an image node.
    else if (file.type.startsWith("image/")) {
      try {
        const timestamp = Date.now();
        const fileName = file.name || "pastedImage.png";
        const imagePath = `images/${timestamp}_${fileName}`;
        const storageReference = storageRef(storage, imagePath);
        await uploadBytes(storageReference, file);
        const downloadURL = await getDownloadURL(storageReference);
        await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
          type: "image",
          imageUrl: downloadURL,
          storagePath: imagePath,
          x: dropX - 60 / zoomRef.current * .5,
          y: dropY - DEFAULT_HEIGHT / zoomRef.current * .5,
          width: 60 / zoomRef.current,
          height: DEFAULT_HEIGHT / zoomRef.current,
          lockedBy: null,
          typing: false,
        }).then((docRef) => {
          if (docRef) {
            groupUndoSnapshot[docRef.id] = { id: docRef.id, isNew: true };
          }
        });
      } catch (error) {
        console.error("Error uploading image:", error);
      }
    }

    if (Object.keys(groupUndoSnapshot).length > 0) {
      pushSelectionToUndoStack(groupUndoSnapshot);
    }
  };




  // Clipboard operations (extracted to hook)
  const { handlePaste, handleCopy } = useClipboard({
    mindMapId,
    editingNodeId,
    selectedNodes,
    nodes,
    localCursor: localCursorRef.current,
    zoomRef,
    duplicateNodeWithPosition,
    pushSelectionToUndoStack,
    pushAction,
    closeContextMenu,
  });








  // --- SIDEBAR FOR CUSTOMIZATION ---
  const handleSidebarSave = async () => {
    if (!selectedNodes.length) return;
    pushSelectionToUndoStack();
    // Assuming activeCustomizationNode is the reference node for the current sidebar values.
    const updatedProps = {};
    if (activeCustomizationNode) {
      if (activeCustomizationNode.bgColor !== tempBgColor) {
        updatedProps.bgColor = tempBgColor;
      }
      if (activeCustomizationNode.textColor !== tempTextColor) {
        updatedProps.textColor = tempTextColor;
      }
      if (activeCustomizationNode.fontSize !== tempFontSize) {
        updatedProps.fontSize = tempFontSize;
      }
      // For textStyle, you might compare arrays:
      if (JSON.stringify(activeCustomizationNode.textStyle) !== JSON.stringify(tempTextStyle)) {
        updatedProps.textStyle = tempTextStyle;
      }
      if (activeCustomizationNode.textAlign !== tempTextAlign) {
        updatedProps.textAlign = tempTextAlign;
      }
      if (activeCustomizationNode.fontFamily !== tempFontFamily) {
        updatedProps.fontFamily = tempFontFamily;
      }
      if (activeCustomizationNode.zIndex !== tempZIndex) {
        updatedProps.zIndex = tempZIndex;
      }
    }

    if (Object.keys(updatedProps).length === 0) {
      // Nothing changed; do nothing.
      return;
    }

    // Batch update all selected nodes with only the changed properties.
    const batch = writeBatch(db);
    
    // Filter out any selected nodes that don't exist in the current nodes array
    const validSelectedNodes = selectedNodes.filter(id => 
      nodes.some(node => node.id === id)
    );
    
    if (validSelectedNodes.length === 0) {
      console.warn("No valid nodes to update");
      return;
    }
    
    validSelectedNodes.forEach((id) => {
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
      batch.update(nodeRef, updatedProps);
    });
    
    try {
      await batch.commit();
      // Update local state:
      setNodes((prev) =>
        prev.map((n) =>
          validSelectedNodes.includes(n.id) ? { ...n, ...updatedProps } : n
        )
      );
    } catch (error) {
      console.error("Error updating nodes:", error);
      // Clear invalid selections
      setSelectedNodes(prev => prev.filter(id => 
        nodes.some(node => node.id === id)
      ));
    }
  };


  


  const handleRemoveLinks = async () => {
    if (!selectedNodes || selectedNodes.length === 0) return;
    try {
      const batch = writeBatch(db);

      // For each selected node, get its outgoing and incoming links and add a delete for each to the batch.
      for (const nodeId of selectedNodes) {
        // Outgoing links where the node is the source.
        const outgoingQuery = query(
          collection(db, "mindMaps", mindMapId, "links"),
          where("source", "==", nodeId)
        );
        const outgoingSnapshot = await getDocs(outgoingQuery);
        outgoingSnapshot.docs.forEach((docSnap) => {
          const linkRef = doc(db, "mindMaps", mindMapId, "links", docSnap.id);
          batch.delete(linkRef);
        });

        // Incoming links where the node is the target.
        const incomingQuery = query(
          collection(db, "mindMaps", mindMapId, "links"),
          where("target", "==", nodeId)
        );
        const incomingSnapshot = await getDocs(incomingQuery);
        incomingSnapshot.docs.forEach((docSnap) => {
          const linkRef = doc(db, "mindMaps", mindMapId, "links", docSnap.id);
          batch.delete(linkRef);
        });
      }

      // Commit the batch to delete all links at once.
      await batch.commit();
      console.log("All links removed from the selected nodes.");
    } catch (error) {
      console.error("Error removing links:", error);
    }
  };

  useEffect(() => {
    if (activeCustomizationNode) {
      setTempBgColor(activeCustomizationNode.bgColor || "#1e1e1e");
      setTempTextColor(activeCustomizationNode.textColor || "#fff");
      setTempFontSize(activeCustomizationNode.fontSize || "14");
      setTempTextStyle(activeCustomizationNode.textStyle || []); // e.g. may be stored as an array
      setTempTextAlign(activeCustomizationNode.textAlign || "left");
      setTempFontFamily(activeCustomizationNode.fontFamily || "cursive");
      setTempZIndex(activeCustomizationNode.zIndex || 1);
      // And set any other properties (e.g., text, width, height, font, etc.)
    }
  }, [activeCustomizationNode]);



  const handleExport = () => {
    const data = { nodes, links };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mindmap_${mindMapId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Keyboard shortcuts (extracted to hook) — must be after handleExport/duplicateNodeWithPosition
  useKeyboardShortcuts({
    nodes, links, selectedNodes, editingNodeId, showHotkeyHelp, mindMapId,
    setEditingNodeId, setShowSearch, setShowHotkeyHelp, setZoom,
    setSelectedNodes, setLinkingMode, setLinkingSource, setPan, setNodes,
    zoomRef, panRef, outerRef,
    navigateSearch, zoomToFitAll, handleZoomIn, handleZoomOut, handleReset,
    selectAllNodes, addConnectedNode, handleDoubleClick, autoLayout,
    toggleLinkingMode, handleExport, duplicateNodeWithPosition,
    pushSelectionToUndoStack, pushAction, handleUndoSelection, handleRedoSelection,
  });

  // --- HIGHLIGHTING --- (memoized for stable reference)
  const isNodeHighlighted = useCallback((node) => {
    return hoveredNodeId === node.id || selectedNodeSet.has(node.id);
  }, [hoveredNodeId, selectedNodeSet]);

  // NOTE: renderLinks and legacyVisibleNodes/legacyVisibleLinks removed — replaced by CanvasLinks component


  // Follow-user functionality
  const [followingUserId, setFollowingUserId] = useState(null);
  
  // Effect to follow a remote user's cursor
  useEffect(() => {
    if (!followingUserId) return;
    const followedCursor = cursors.find(c => c.uid === followingUserId);
    if (!followedCursor || Date.now() - followedCursor.lastActive > 8000) {
      setFollowingUserId(null);
      return;
    }
    // Center viewport on followed user's world position
    if (outerRef.current) {
      const rect = outerRef.current.getBoundingClientRect();
      const newPan = {
        x: rect.width / 2 - followedCursor.x * zoom,
        y: rect.height / 2 - followedCursor.y * zoom,
      };
      setPan(newPan);
      panRef.current = newPan;
    }
  }, [cursors, followingUserId, zoom]);

  const getVisibleArea = () => {
    if (!outerRef.current) {
      return { visibleLeft: 0, visibleTop: 0, visibleWidth: 0, visibleHeight: 0 };
    }
    // get the container dimensions in screen coordinates
    const rect = outerRef.current.getBoundingClientRect();
    // Compute the world coordinates:
    const visibleLeft = -pan.x / zoom;
    const visibleTop = -pan.y / zoom;
    const visibleWidth = rect.width / zoom;
    const visibleHeight = rect.height / zoom;
    return { visibleLeft, visibleTop, visibleWidth, visibleHeight };
  };
  





  useEffect(() => {
    if (activeCustomizationNode) {
      if (
        activeCustomizationNode.bgColor !== tempBgColor ||
        activeCustomizationNode.textColor !== tempTextColor ||
        activeCustomizationNode.fontSize !== tempFontSize ||
        JSON.stringify(activeCustomizationNode.textStyle) !== JSON.stringify(tempTextStyle) ||
        activeCustomizationNode.textAlign !== tempTextAlign ||
        activeCustomizationNode.fontFamily !== tempFontFamily ||
        activeCustomizationNode.zIndex !== tempZIndex
      ) {
        const timer = setTimeout(() => {
          handleSidebarSave();
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [tempBgColor, tempTextColor, tempFontSize, tempTextStyle, tempTextAlign, tempFontFamily, tempZIndex, activeCustomizationNode]);

  // Helper function to download image nodes as PNG
  const handleDownloadImage = async (node) => {
    try {
      if (!node || node.type !== 'image' || !node.imageUrl) {
        console.error("Invalid image node for download");
        return;
      }

      // Use the utility function to fetch the image properly
      const response = await fetchImage(node.imageUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch image");
      }

      const blob = await response.blob();
      
      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      
      // Generate filename based on node text or a default name
      const fileName = node.text 
        ? `${node.text.replace(/[^a-zA-Z0-9]/g, '_')}.png`
        : `mindmap_image_${Date.now()}.png`;
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the object URL
      URL.revokeObjectURL(downloadUrl);
      
      console.log(`Downloaded image: ${fileName}`);
    } catch (error) {
      console.error("Error downloading image:", error);
      // You could add a toast notification here if you have one
    }
  };


  const getCanvasCenter = () => {
    if (!outerRef.current) return { x: 0, y: 0 };

    // Dimensions of the outer container
    const rect = outerRef.current.getBoundingClientRect();

    // Define fixed UI offsets (adjust these as needed)
    const sidebarWidth = 250;
    const topBarHeight = 50;

    // Compute available canvas width/height
    const canvasWidth = rect.width - sidebarWidth;
    const canvasHeight = rect.height - topBarHeight;

    // Find the center in screen coordinates.
    // If your canvas starts after the sidebar and top bar,
    // you might need to add them back in:
    const centerScreenX = sidebarWidth + canvasWidth / 2;
    const centerScreenY = topBarHeight + canvasHeight / 2;

    // Convert the screen center to world coordinates:
    const worldX = (centerScreenX - panRef.current.x) / zoomRef.current;
    const worldY = (centerScreenY - panRef.current.y) / zoomRef.current;

    return { x: worldX, y: worldY };
  };



  // Make sure to close context menu and color pickers on click anywhere.
  useEffect(() => {
    const handleClick = (e) => {
      if (contextMenuu.visible) {
        closeContextMenu();
      }
      
      // Close color pickers if clicking outside
      if (showBgColorPicker && !e.target.closest('[data-color-picker="bg"]')) {
        setShowBgColorPicker(false);
      }
      if (showTextColorPicker && !e.target.closest('[data-color-picker="text"]')) {
        setShowTextColorPicker(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenuu.visible, showBgColorPicker, showTextColorPicker]);
  









  
  // Add state/refs for touch handling
  const lastTouch = useRef(null);
  const lastDistance = useRef(null);

  // Touch event handlers for mobile panning and pinch-to-zoom
  const handleTouchStart = (e) => {
    if (!isMobile) return;
    e.preventDefault(); // Always prevent default to avoid iOS browser zoom
    if (e.touches.length === 1) {
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, pan: { ...panRef.current } };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastDistance.current = Math.sqrt(dx * dx + dy * dy);
      lastTouch.current = null;
    }
  };

  const throttledSetZoom = useRef(throttle((newZoom) => {
    setZoom(newZoom);
    zoomRef.current = newZoom;
  }, 16)); // ~60fps

  const handleTouchMove = (e) => {
    if (!isMobile) return;
    e.preventDefault();
    if (e.touches.length === 1 && lastTouch.current) {
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      const newPan = {
        x: lastTouch.current.pan.x + dx,
        y: lastTouch.current.pan.y + dy,
      };
      setPan(newPan);
      panRef.current = newPan;
    } else if (e.touches.length === 2 && lastDistance.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDistance = Math.sqrt(dx * dx + dy * dy);
      const scale = newDistance / lastDistance.current;
      
      const oldZoom = zoomRef.current;
      let newZoom = clamp(oldZoom * scale, MIN_ZOOM, MAX_ZOOM);
      
      // Calculate the zoom center (midpoint between the two touches)
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      // Get container bounds to adjust touch coordinates
      const container = outerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const adjustedCenterX = centerX - rect.left;
        const adjustedCenterY = centerY - rect.top;
        
        // Calculate the point in world coordinates before zoom
        const pointInWorld = {
          x: (adjustedCenterX - panRef.current.x) / oldZoom,
          y: (adjustedCenterY - panRef.current.y) / oldZoom,
        };
        
        // Calculate new pan to keep the same world point under the zoom center
        const newPan = {
          x: adjustedCenterX - pointInWorld.x * newZoom,
          y: adjustedCenterY - pointInWorld.y * newZoom,
        };
        
        setPan(newPan);
        panRef.current = newPan;
      }
      
      throttledSetZoom.current(newZoom);
      lastDistance.current = newDistance;
    }
  };

  const handleTouchEnd = (e) => {
    if (!isMobile) return;
    if (e.touches.length === 0) {
      lastTouch.current = null;
      lastDistance.current = null;
    }
  };

  // Notification Component

  // Loading Overlay Component
  const LoadingOverlay = () => {
    if (!isLoading && !operationInProgress) return null;
    
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            width: '50px',
            height: '50px',
            border: '4px solid #333',
            borderTop: '4px solid #fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <Typography 
          variant="h6" 
          style={{ color: '#fff', marginTop: '20px' }}
        >
          {isLoading ? 'Loading mind map...' : 'Processing...'}
        </Typography>
      </div>
    );
  };

  // Error Component
  const ErrorComponent = () => {
    if (!error) return null;
    
    return (
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#f44336',
          color: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 2000,
          textAlign: 'center',
          maxWidth: '400px',
        }}
      >
        <Typography variant="h6" style={{ marginBottom: '10px' }}>
          Error
        </Typography>
        <Typography variant="body1" style={{ marginBottom: '20px' }}>
          {error}
        </Typography>
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            window.location.reload();
          }}
          style={{ backgroundColor: '#fff', color: '#f44336' }}
        >
          Retry
        </Button>
      </div>
    );
  };

  // Search Bar Component

  // Hotkey Help Modal

  // Mini-map Navigation Component (Performance Optimized)

  // Performance-aware mini-map toggle

  // Helper function to calculate bounding box of selected nodes
  const getSelectedNodesBounds = () => {
    if (selectedNodes.length === 0) return null;
    
    const selectedNodeData = selectedNodes
      .map(id => nodes.find(n => n.id === id))
      .filter(Boolean);
    
    if (selectedNodeData.length === 0) return null;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    selectedNodeData.forEach(node => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      
      // Account for group delta during multi-node dragging
      const nodeIsSelected = selectedNodeSet.has(node.id);
      const x = node.x + (nodeIsSelected ? groupDelta.x : 0);
      const y = node.y + (nodeIsSelected ? groupDelta.y : 0);
      
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    });
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      nodes: selectedNodeData
    };
  };

  // Enhanced resize function for unified bounding box
  const handleUnifiedResize = (direction, e) => {
    if (e.button !== 0) return;
    if (selectedNodes.length === 0) return;
    
    const bounds = getSelectedNodesBounds();
    if (!bounds) return;
    
    // Push all selected nodes to undo stack as a single batch operation
    pushSelectionToUndoStack();
    
    e.stopPropagation();
    e.preventDefault();
    
    const startX = e.clientX;
    const startY = e.clientY;
    
    // Store initial data for all selected nodes
    const initialNodes = bounds.nodes.map(node => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width || DEFAULT_WIDTH,
      height: node.height || DEFAULT_HEIGHT,
      fontSize: node.fontSize || 14, // Store original font size
      // Store relative position within bounding box
      relativeX: (node.x - bounds.x) / bounds.width,
      relativeY: (node.y - bounds.y) / bounds.height,
      relativeWidth: (node.width || DEFAULT_WIDTH) / bounds.width,
      relativeHeight: (node.height || DEFAULT_HEIGHT) / bounds.height
    }));
    
    const initialBounds = { ...bounds };
    let finalStates = {};
    
    const onMouseMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoom;
      const deltaY = (moveEvent.clientY - startY) / zoom;
      
      let newBoundsX = initialBounds.x;
      let newBoundsY = initialBounds.y;
      let newBoundsWidth = initialBounds.width;
      let newBoundsHeight = initialBounds.height;
      
      // Calculate new bounding box based on resize direction
      switch (direction) {
        case 'nw':
          newBoundsX = initialBounds.x + deltaX;
          newBoundsY = initialBounds.y + deltaY;
          newBoundsWidth = Math.max(100, initialBounds.width - deltaX);
          newBoundsHeight = Math.max(50, initialBounds.height - deltaY);
          break;
        case 'ne':
          newBoundsY = initialBounds.y + deltaY;
          newBoundsWidth = Math.max(100, initialBounds.width + deltaX);
          newBoundsHeight = Math.max(50, initialBounds.height - deltaY);
          break;
        case 'sw':
          newBoundsX = initialBounds.x + deltaX;
          newBoundsWidth = Math.max(100, initialBounds.width - deltaX);
          newBoundsHeight = Math.max(50, initialBounds.height + deltaY);
          break;
        case 'se':
          newBoundsWidth = Math.max(100, initialBounds.width + deltaX);
          newBoundsHeight = Math.max(50, initialBounds.height + deltaY);
          break;
        case 'n':
          newBoundsY = initialBounds.y + deltaY;
          newBoundsHeight = Math.max(50, initialBounds.height - deltaY);
          break;
        case 's':
          newBoundsHeight = Math.max(50, initialBounds.height + deltaY);
          break;
        case 'w':
          newBoundsX = initialBounds.x + deltaX;
          newBoundsWidth = Math.max(100, initialBounds.width - deltaX);
          break;
        case 'e':
          newBoundsWidth = Math.max(100, initialBounds.width + deltaX);
          break;
      }
      
      // Update all nodes proportionally
      setNodes(prevNodes =>
        prevNodes.map(node => {
          const initialNode = initialNodes.find(n => n.id === node.id);
          if (!initialNode) return node;
          
          // Calculate new position and size based on relative position in bounding box
          const newX = newBoundsX + (initialNode.relativeX * newBoundsWidth);
          const newY = newBoundsY + (initialNode.relativeY * newBoundsHeight);
          const newWidth = Math.max(50, initialNode.relativeWidth * newBoundsWidth);
          const newHeight = Math.max(20, initialNode.relativeHeight * newBoundsHeight);
          
          // Calculate font size scaling based on average of width and height scaling
          // Only scale text if multiple nodes are selected, not for single nodes
          let newFontSize = initialNode.fontSize; // Default to original font size
          if (selectedNodes.length > 1) {
            const widthScale = newWidth / initialNode.width;
            const heightScale = newHeight / initialNode.height;
            const averageScale = (widthScale + heightScale) / 2;
            newFontSize = Math.max(8, Math.round(initialNode.fontSize * averageScale)); // Minimum 8px font
          }
          
          // Store final state
          finalStates[node.id] = {
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
            fontSize: newFontSize
          };
          
          return {
            ...node,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
            fontSize: newFontSize
          };
        })
      );
    };

    const onMouseUp = async () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      
      // Update all nodes in Firebase
      try {
        const updatePromises = Object.keys(finalStates).map(async (nodeId) => {
          const finalState = finalStates[nodeId];
          const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
          await updateDoc(nodeRef, finalState);
        });
        
        await Promise.all(updatePromises);
      } catch (error) {
        console.error("Error updating nodes:", error);
      }
    };
    
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  // Unified Resize Bounding Box Component
  const ResizeBoundingBox = () => {
    if (selectedNodes.length === 0) return null;
    
    const bounds = getSelectedNodesBounds();
    if (!bounds) return null;

    // Calculate average dimension of selected nodes for dynamic handle sizing
    const avgNodeDimension = bounds.nodes.reduce((sum, node) => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      return sum + (width + height) / 2;
    }, 0) / bounds.nodes.length;

    // Scale handle size based on average node size
    const baseHandleSize = 14; // Base size from CSS
    const handleScale = Math.max(0.7, Math.min(2.0, avgNodeDimension / 120)); // Scale between 0.7x and 2x
    const dynamicHandleSize = Math.round(baseHandleSize * handleScale);
    const handleOffset = Math.round(dynamicHandleSize / 2);

    return (
      <div
        style={{
          position: "absolute",
          left: bounds.x - 8,
          top: bounds.y - 8,
          width: bounds.width + 16,
          height: bounds.height + 16,
          border: "2px dashed #8896DD",
          backgroundColor: "rgba(136, 150, 221, 0.05)",
          pointerEvents: "none",
          zIndex: 999,
          transition: "none", // Prevent any inherited transitions
          boxSizing: "border-box", // Ensure consistent sizing
        }}
      >
        {/* Corner handles */}
        <div
          className="resize-handle unified nw"
          onMouseDown={(e) => handleUnifiedResize('nw', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            top: `-${handleOffset}px`,
            left: `-${handleOffset}px`
          }}
        />
        <div
          className="resize-handle unified ne"
          onMouseDown={(e) => handleUnifiedResize('ne', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            top: `-${handleOffset}px`,
            right: `-${handleOffset}px`
          }}
        />
        <div
          className="resize-handle unified sw"
          onMouseDown={(e) => handleUnifiedResize('sw', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            bottom: `-${handleOffset}px`,
            left: `-${handleOffset}px`
          }}
        />
        <div
          className="resize-handle unified se"
          onMouseDown={(e) => handleUnifiedResize('se', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            bottom: `-${handleOffset}px`,
            right: `-${handleOffset}px`
          }}
        />
        
        {/* Side handles */}
        <div
          className="resize-handle unified n"
          onMouseDown={(e) => handleUnifiedResize('n', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            top: `-${handleOffset}px`,
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        />
        <div
          className="resize-handle unified s"
          onMouseDown={(e) => handleUnifiedResize('s', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            bottom: `-${handleOffset}px`,
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        />
        <div
          className="resize-handle unified w"
          onMouseDown={(e) => handleUnifiedResize('w', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            top: '50%',
            left: `-${handleOffset}px`,
            transform: 'translateY(-50%)'
          }}
        />
        <div
          className="resize-handle unified e"
          onMouseDown={(e) => handleUnifiedResize('e', e)}
          style={{ 
            pointerEvents: "auto",
            width: `${dynamicHandleSize}px`,
            height: `${dynamicHandleSize}px`,
            top: '50%',
            right: `-${handleOffset}px`,
            transform: 'translateY(-50%)'
          }}
        />
        
        {/* Connecting lines for professional look */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 8,
          right: 8,
          height: "2px",
          backgroundColor: "#8896DD",
          opacity: 0.6
        }} />
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 8,
          right: 8,
          height: "2px",
          backgroundColor: "#8896DD",
          opacity: 0.6
        }} />
        <div style={{
          position: "absolute",
          left: 0,
          top: 8,
          bottom: 8,
          width: "2px",
          backgroundColor: "#8896DD",
          opacity: 0.6
        }} />
        <div style={{
          position: "absolute",
          right: 0,
          top: 8,
          bottom: 8,
          width: "2px",
          backgroundColor: "#8896DD",
          opacity: 0.6
        }} />
      </div>
    );
  };

  // Optimized link operations with batching
  const setLinks = useCallback((updater) => {
    if (typeof updater === 'function') {
      const currentLinks = linkStateManager.getLinks();
      const newLinks = updater(currentLinks);
      setRawLinks(newLinks);
    } else {
      setRawLinks(updater);
    }
  }, [linkStateManager]);

  // Optimized single link update
  const updateSingleLink = useCallback((id, updates, immediate = false) => {
    updateLinkOptimized(id, updates, immediate);
    
    // Also update Firebase if immediate
    if (immediate && Object.keys(updates).length > 0) {
      const linkRef = doc(db, "mindMaps", mindMapId, "links", id);
      updateDoc(linkRef, updates).catch(console.error);
    }
  }, [updateLinkOptimized, mindMapId]);

  // Optimized batch link updates
  const updateMultipleLinks = useCallback((linkUpdates, immediate = false) => {
    const hasChanges = updateLinkOptimized(linkUpdates, immediate);
    
    // Also update Firebase if immediate and there are changes
    if (immediate && hasChanges) {
      const batch = writeBatch(db);
      Object.entries(linkUpdates).forEach(([id, updates]) => {
        if (Object.keys(updates).length > 0) {
          const linkRef = doc(db, "mindMaps", mindMapId, "links", id);
          batch.update(linkRef, updates);
        }
      });
      batch.commit().catch(console.error);
    }
    
    return hasChanges;
  }, [updateLinkOptimized, mindMapId]);

  // Optimized link creation with immediate Firebase sync
  const createLink = useCallback(async (source, target, { trackUndo = false } = {}) => {
    try {
      const linkData = { source, target };
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "links"), linkData);
      // The optimized state will be updated by Firebase subscription
      return docRef.id;
    } catch (error) {
      console.error("Error creating link:", error);
      return null;
    }
  }, [mindMapId]);

  // Optimized link deletion with batch Firebase sync
  const deleteLink = useCallback(async (linkId, { trackUndo = true } = {}) => {
    try {
      // Snapshot the link before deleting for undo
      if (trackUndo) {
        const linkToDelete = links.find(l => l.id === linkId);
        if (linkToDelete) {
          pushAction({
            type: 'link_delete',
            nodes: { before: {}, after: {} },
            links: {
              before: { [linkId]: structuredClone(linkToDelete) },
              after: { [linkId]: null },
            },
          });
        }
      }
      await deleteDoc(doc(db, "mindMaps", mindMapId, "links", linkId));
      // The optimized state will be updated by Firebase subscription
      return true;
    } catch (error) {
      console.error("Error deleting link:", error);
      return false;
    }
  }, [mindMapId, links, pushAction]);

  // Optimized function to delete all links for a node
  const deleteLinksForNode = useCallback(async (nodeId) => {
    const connectedLinks = getLinksByNode(nodeId);
    if (connectedLinks.length === 0) return;

    try {
      const batch = writeBatch(db);
      connectedLinks.forEach(link => {
        const linkRef = doc(db, "mindMaps", mindMapId, "links", link.id);
        batch.delete(linkRef);
      });
      await batch.commit();
      return true;
    } catch (error) {
      console.error("Error deleting links for node:", error);
      return false;
    }
  }, [getLinksByNode, mindMapId]);

  return (
    <div
      style={{
        // Remove inline backgroundColor to use the new.css gradient background.
        userSelect: "none",
        cursor: isDragging || rightClickMoved ? "grabbing" : "default",
        height: "100vh",
        position: "relative",
        touchAction: "none" // Prevent iOS Safari pinch-to-zoom on canvas
      }}
      ref={outerRef}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        if (isMobile) return; // Disable mouse events on mobile
        if (e.target === outerRef.current) {
          handleOuterMouseDown(e);
          if (e.button !== 2) return;
          handleMouseDown(e);
        }
      }}
      onDoubleClick={(e) => {
        if (isMobile) return;
        if (e.target === outerRef.current) {
          handleAddNode({ atCursor: true });
        }
      }}
      onMouseMove={(e) => {
        if (isMobile) return;
        handleOuterMouseMove(e);
      }}
      onMouseUp={(e) => {
        if (isMobile) return;
        handleOuterMouseUp(e);
        if (e.button === 2) {
          rightClickStartRef.current = null;
          if (
            document.activeElement.tagName === "INPUT" ||
            document.activeElement.tagName === "TEXTAREA"
          ) return;
          handleCanvasContextMenu(e);
          if (rightClickMoved) {
            setTimeout(() => setRightClickMoved(false), 0);
            closeContextMenu();
          }
        }
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Remote cursors rendered below */}
      {/* Top Toolbar */}
      <ToolbarComponent
        navigate={navigate}
        mindMapId={mindMapId}
        outerRef={outerRef}
        handleAddNode={handleAddNode}
        linkingMode={linkingMode}
        setLinkingMode={setLinkingMode}
        setLinkingSource={setLinkingSource}
        linkingSource={linkingSource}
        handleExport={handleExport}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        setShowHotkeyHelp={setShowHotkeyHelp}
        onSettingsOpen={() => setShowSettingsModal(true)}
      />
      {/* Right Sidebar */}
      {!isMobile && (
        <Sidebar
          activeCustomizationNode={activeCustomizationNode}
          selectedNodes={selectedNodes}
          tempFontFamily={tempFontFamily}
          setTempFontFamily={setTempFontFamily}
          tempFontSize={tempFontSize}
          setTempFontSize={setTempFontSize}
          tempTextStyle={tempTextStyle}
          setTempTextStyle={setTempTextStyle}
          tempTextAlign={tempTextAlign}
          setTempTextAlign={setTempTextAlign}
          tempBgColor={tempBgColor}
          setTempBgColor={setTempBgColor}
          tempTextColor={tempTextColor}
          setTempTextColor={setTempTextColor}
          tempZIndex={tempZIndex}
          setTempZIndex={setTempZIndex}
          showBgColorPicker={showBgColorPicker}
          setShowBgColorPicker={setShowBgColorPicker}
          showTextColorPicker={showTextColorPicker}
          setShowTextColorPicker={setShowTextColorPicker}
          handleBringToFront={handleBringToFront}
          handleSendToBack={handleSendToBack}
          handleZIndexChange={handleZIndexChange}
          handleRemoveLinks={handleRemoveLinks}
        />
      )}

      {/* Auto-collapsing Active Users Panel */}
      {(() => {
        const otherUsers = presenceUsers.filter(u => u.email !== currentUserEmail);
        const isSolo = otherUsers.length === 0;
        
        // Solo mode: compact green dot
        if (isSolo) {
          return (
            <div
              style={{
                position: "fixed",
                top: 68,
                right: isMobile ? 10 : 290,
                zIndex: 250,
              }}
            >
              <div
                className="active-users-compact"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: "rgba(20, 22, 24, 0.85)",
                  backdropFilter: "blur(8px)",
                  color: "#fff",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  border: "1px solid #333",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                  cursor: "default",
                  transition: "all 0.2s ease",
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#4CAF50',
                    boxShadow: '0 0 6px rgba(76, 175, 80, 0.5)',
                    animation: 'pulse 2s infinite',
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" style={{ color: '#999', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  Only you
                </Typography>
              </div>
            </div>
          );
        }
        
        // Multi-user mode: full expanded panel with activity and follow
        return (
          <div
            style={{
              position: "fixed",
              top: 60,
              right: isMobile ? 10 : 290,
              background: "radial-gradient(circle at center,rgba(29, 32, 34, 0.95) 0%, #0f1011 100%)",
              backdropFilter: "blur(8px)",
              color: "#fff",
              padding: "12px",
              borderRadius: "12px",
              zIndex: 250,
              minWidth: "220px",
              maxWidth: "260px",
              border: "1px solid #333",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              animation: "fadeIn 0.3s ease",
            }}
          >
            <Typography variant="subtitle2" style={{ fontWeight: 'bold', marginBottom: '8px', color: '#4CAF50' }}>
              Active Users ({presenceUsers.length})
            </Typography>
            {presenceUsers.map((user, index) => {
              const isCurrentUser = user.email === currentUserEmail;
              // Find remote cursor data for this user to show activity
              const remoteCursor = !isCurrentUser 
                ? cursors.find(c => c.email === user.email && c.uid !== currentUserUid)
                : null;
              const activity = remoteCursor?.activity || 'idle';
              const activityLabel = activity === 'editing' ? '✏️ Editing'
                : activity === 'selecting' ? '🔲 Selecting'
                : activity === 'dragging' ? '✊ Dragging'
                : '💤 Idle';
              const userColor = isCurrentUser ? '#4CAF50' : getColorForUid(remoteCursor?.uid || user.email || `user-${index}`);
              const isFollowing = remoteCursor?.uid && followingUserId === remoteCursor.uid;
              
              return (
                <div 
                  key={user.email || index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 0',
                    borderBottom: index < presenceUsers.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none'
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: userColor,
                      boxShadow: `0 0 6px ${userColor}60`,
                      animation: 'pulse 2s infinite',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography 
                      variant="caption" 
                      style={{ 
                        color: isCurrentUser ? '#4CAF50' : '#fff',
                        fontWeight: isCurrentUser ? 'bold' : 'normal',
                        display: 'block',
                        lineHeight: '1.2',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isCurrentUser ? `${user.email?.split('@')[0]} (You)` : user.email?.split('@')[0]}
                    </Typography>
                    {!isCurrentUser && (
                      <Typography 
                        variant="caption" 
                        style={{ color: '#888', fontSize: '9px', display: 'block', lineHeight: '1.2' }}
                      >
                        {activityLabel}
                      </Typography>
                    )}
                  </div>
                  {/* Follow button for remote users */}
                  {!isCurrentUser && remoteCursor?.uid && (
                    <button
                      onClick={() => setFollowingUserId(isFollowing ? null : remoteCursor.uid)}
                      title={isFollowing ? 'Stop following' : 'Follow user'}
                      style={{
                        background: isFollowing ? userColor : 'rgba(255,255,255,0.08)',
                        border: `1px solid ${isFollowing ? userColor : 'rgba(255,255,255,0.15)'}`,
                        color: isFollowing ? '#fff' : '#aaa',
                        borderRadius: '6px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                        lineHeight: '14px',
                      }}
                    >
                      {isFollowing ? '👁️ Following' : '👁️'}
                    </button>
                  )}
                </div>
              );
            })}
            
            {/* Connection Status */}
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <Typography variant="caption" style={{ color: '#666', fontSize: '10px' }}>
                Connected • Real-time sync active
              </Typography>
            </div>
          </div>
        );
      })()}
  
      {/* Remote cursors overlay */}
      <RemoteCursors
        cursors={cursors}
        currentUserUid={currentUserUid}
        zoom={zoom}
        pan={pan}
      />
  
      {/* Canvas Container */}
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          if (e.target === containerRef.current) setSelectedNodes([]);
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: ".1px",
          height: ".1px",
          overflow: "visible",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "top left",
          willChange: "transform",
        }}
      >
        <CanvasLinks
          visibleLinks={visibleLinks}
          nodeMap={nodeMap}
          selectedNodeSet={selectedNodeSet}
          groupDelta={groupDelta}
        />
        {/* Remote user selection highlights (rendered in world space) */}
        <RemoteSelectionOverlays
          cursors={cursors}
          currentUserUid={currentUserUid}
          nodeMap={nodeMap}
        />
        <VirtualNodeRenderer
          nodes={nodes}
          nodeMap={nodeMap}
          zoom={zoomRef.current}
          pan={pan}
          outerRef={outerRef}
          visibleNodes={visibleNodes}
          selectedNodes={selectedNodes}
          selectedNodeSet={selectedNodeSet}
          groupDelta={groupDelta}
          editingNodeId={editingNodeId}
          editedText={editedText}
          hoveredNodeId={hoveredNodeId}
          linkingSource={linkingSource}
          currentUserEmail={currentUserEmail}
          isNodeHighlighted={isNodeHighlighted}
          handleResizeMouseDown={isMobile ? NOOP : handleResizeMouseDown}
          handleNodeClick={isMobile ? NOOP : handleNodeClick}
          handleDoubleClick={isMobile ? NOOP : handleDoubleClick}
          handleTyping={isMobile ? NOOP : handleTyping}
          handleTextBlur={isMobile ? NOOP : handleTextBlur}
          setEditedText={isMobile ? NOOP : setEditedText}
          setHoveredNodeId={isMobile ? NOOP : setHoveredNodeId}
          dragStartRef={dragStartRef}
          multiDragStartRef={multiDragStartRef}
          setIsDragging={setIsDragging}
          setNodes={setNodes}
          setGroupDelta={setGroupDelta}
          mindMapId={mindMapId}
          pushSingleNodeToUndoStack={pushSingleNodeToUndoStack}
          pushSelectionToUndoStack={pushSelectionToUndoStack}
          setSelectedNodes={setSelectedNodes}
          updateGroupDelta={updateGroupDelta}
          panRef={panRef}
          zoomRef={zoomRef}
          lowDetail={lowDetail}
          snapSettingsRef={snapSettingsRef}
          groupDeltaRef={groupDeltaRef}
          updateNodeText={updateNodeText}
        />
        <ResizeBoundingBox />
        {selectionBox && (() => {
          // Calculate average dimension based on nodes within the selection box, not the box itself
          const nodesInSelection = visibleNodes.filter(node => {
            const nodeRect = {
              x: node.x,
              y: node.y,
              width: node.width || DEFAULT_WIDTH,
              height: node.height || DEFAULT_HEIGHT,
            };
            return rectsIntersect(nodeRect, selectionBox);
          });
          
          // Calculate average dimension of nodes in selection, not the selection box itself
          let avgNodeDimension = 100; // Default for when no nodes selected
          if (nodesInSelection.length > 0) {
            const totalDimension = nodesInSelection.reduce((sum, node) => {
              const width = node.width || DEFAULT_WIDTH;
              const height = node.height || DEFAULT_HEIGHT;
              return sum + (width + height) / 2;
            }, 0);
            avgNodeDimension = totalDimension / nodesInSelection.length;
          }
          
          const computedStrokeWidth = Math.max(1, avgNodeDimension * 0.02);
          return (
            <svg
              style={{
                position: "absolute",
                left: selectionBox.x,
                top: selectionBox.y,
                width: selectionBox.width,
                height: selectionBox.height,
                pointerEvents: "none",
                zIndex: 500
              }}
            >
              <rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="rgba(128,128,128,0.1)"  // Light gray fill
                stroke="white"
                strokeWidth={computedStrokeWidth}
              />
            </svg>
          );
        })()}
      </div>
      {editingNodeId && (() => {
        const editNode = nodeMap.get(editingNodeId);
        if (!editNode) return null;
        return (
          <FormattingToolbar
            nodeId={editingNodeId}
            nodeX={editNode.x}
            nodeY={editNode.y}
            zoom={zoom}
            pan={pan}
          />
        );
      })()}
      <ContextMenu
        contextMenuu={contextMenuu}
        rightClickMoved={rightClickMoved}
        selectedNodes={selectedNodes}
        nodes={nodes}
        handleCopy={handleCopy}
        handlePaste={handlePaste}
        handleReset={handleReset}
        handleBringToFront={handleBringToFront}
        handleSendToBack={handleSendToBack}
        handleDownloadImage={handleDownloadImage}
        closeContextMenu={closeContextMenu}
      />
      <ChatBox
        localCursor={localCursorRef.current}
        canvasCenter={getCanvasCenter()}
        mergeMindMapData={mergeMindMapDataHandler}
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
        selectedNodes={selectedNodes}
        nodes={nodes}
        setNodes={setNodes}
        mindMapId={mindMapId}
        updateNodeText={(id, text) => updateNodeText(id, text, { trackUndo: false })}
        addNode={(data) => addNode(data, { trackUndo: false })}
        addLink={(data) => addLink(data, { trackUndo: false })}
        pushToUndoStack={pushSelectionToUndoStack}
      />
      <LoadingOverlay />
      <ErrorComponent />
      <SearchBar
        showSearch={showSearch}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        performSearch={performSearch}
        searchResults={searchResults}
        currentSearchIndex={currentSearchIndex}
        navigateSearch={navigateSearch}
        setShowSearch={setShowSearch}
        setSearchResults={setSearchResults}
      />
      <HotkeyHelpModal showHotkeyHelp={showHotkeyHelp} setShowHotkeyHelp={setShowHotkeyHelp} />
      <MiniMap
        nodes={nodes}
        links={links}
        selectedNodes={selectedNodes}
        pan={pan}
        zoom={zoom}
        outerRef={outerRef}
        showMiniMap={showMiniMap}
        setShowMiniMap={setShowMiniMap}
        setPan={setPan}
        panRef={panRef}
      />
      <MiniMapToggle showMiniMap={showMiniMap} setShowMiniMap={setShowMiniMap} nodeCount={nodes.length} />
      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          updateSettings={updateSettings}
          resetSettings={resetSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
};  

export default MindMapEditor;