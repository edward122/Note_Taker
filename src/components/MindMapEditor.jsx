// src/components/MindMapEditor.jsx
// Global CSS: html, body { overflow: hidden; height: 100%; margin: 0; padding: 0; }
import React, { useEffect, useState, useRef, useMemo, useCallback, memo } from "react";
import throttle from "lodash.throttle";

//import Node from "/.Node.jsx";
import { useNavigate } from 'react-router-dom';
import { useParams } from "react-router-dom";
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  where,
  getDocs,
  writeBatch,

} from "firebase/firestore";
import { remove } from "firebase/database";
import { db, auth, storage } from "../firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";

import {deleteObject, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import MindMapNode from "./MindMapNode";
import { computePyramidLayoutWithLevels, computeHorizontalTreeLayout, computeRadialLayout } from "./layoutUtils";
import {
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Button,
  Checkbox,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
  Autocomplete,
  Box,
  Paper,
  Toolbar,
  AppBar,
  Stack
} from "@mui/material";
import Draggable from "react-draggable";
import PaletteIcon from "@mui/icons-material/Palette";
import { BlockPicker, ChromePicker } from 'react-color';

import "./new.css";
import ChatBox from "./ChatBox";

import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';

// Import RTDB functions
import { getDatabase, ref, set, onValue, off } from "firebase/database";

const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 40;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.1;
const MIN_PAN = -200;
const MAX_PAN = 200;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Add at the top, after imports
const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent));

// ===== OPTIMIZED STATE MANAGEMENT SYSTEM =====

/**
 * Immutable state updater with structural sharing
 * Only creates new objects for changed nodes, keeps unchanged nodes as-is
 */
class NodeStateManager {
  constructor() {
    this.nodeMap = new Map(); // Fast O(1) lookups
    this.changeQueue = new Map(); // Batch pending changes
    this.batchTimeout = null;
    this.subscribers = new Set();
  }

  // Set initial nodes with Map-based indexing
  setNodes(nodes) {
    this.nodeMap.clear();
    nodes.forEach(node => {
      this.nodeMap.set(node.id, node);
    });
    this.notifySubscribers();
  }

  // Get all nodes as array (cached and memoized)
  getNodes() {
    return Array.from(this.nodeMap.values());
  }

  // Get node by ID with O(1) lookup
  getNode(id) {
    return this.nodeMap.get(id);
  }

  // Optimized single node update - only change what's different
  updateNode(id, updates, immediate = false) {
    const currentNode = this.nodeMap.get(id);
    if (!currentNode) return false;

    // Check if any properties actually changed
    const hasChanges = Object.keys(updates).some(key => 
      currentNode[key] !== updates[key]
    );
    
    if (!hasChanges) return false; // No actual changes, skip update

    if (immediate) {
      // Immediate update for critical operations
      const updatedNode = { ...currentNode, ...updates };
      this.nodeMap.set(id, updatedNode);
      this.notifySubscribers();
      return true;
    } else {
      // Batch update for performance
      this.queueChange(id, updates);
      return true;
    }
  }

  // Batch multiple node updates for optimal performance
  updateNodes(nodeUpdates, immediate = false) {
    let hasAnyChanges = false;

    for (const [id, updates] of Object.entries(nodeUpdates)) {
      const currentNode = this.nodeMap.get(id);
      if (!currentNode) continue;

      // Check if any properties actually changed
      const hasChanges = Object.keys(updates).some(key => 
        currentNode[key] !== updates[key]
      );
      
      if (!hasChanges) continue;

      if (immediate) {
        const updatedNode = { ...currentNode, ...updates };
        this.nodeMap.set(id, updatedNode);
        hasAnyChanges = true;
      } else {
        this.queueChange(id, updates);
        hasAnyChanges = true;
      }
    }

    if (immediate && hasAnyChanges) {
      this.notifySubscribers();
    }

    return hasAnyChanges;
  }

  // Queue changes for batched processing
  queueChange(id, updates) {
    const existing = this.changeQueue.get(id) || {};
    this.changeQueue.set(id, { ...existing, ...updates });

    // Debounced batch processing
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatchedChanges();
    }, 16); // ~60fps batching
  }

  // Process all batched changes at once
  processBatchedChanges() {
    if (this.changeQueue.size === 0) return;

    let hasChanges = false;
    for (const [id, updates] of this.changeQueue) {
      const currentNode = this.nodeMap.get(id);
      if (currentNode) {
        const updatedNode = { ...currentNode, ...updates };
        this.nodeMap.set(id, updatedNode);
        hasChanges = true;
      }
    }

    this.changeQueue.clear();
    this.batchTimeout = null;

    if (hasChanges) {
      this.notifySubscribers();
    }
  }

  // Add or remove nodes
  addNode(node) {
    this.nodeMap.set(node.id, node);
    this.notifySubscribers();
  }

  removeNode(id) {
    const existed = this.nodeMap.delete(id);
    if (existed) {
      this.notifySubscribers();
    }
    return existed;
  }

  // Subscribe to state changes
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Notify all subscribers of state changes
  notifySubscribers() {
    const nodes = this.getNodes();
    this.subscribers.forEach(callback => callback(nodes));
  }

  // Force immediate processing of any pending changes
  flush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.processBatchedChanges();
    }
  }

  // Get multiple nodes efficiently
  getNodesByIds(ids) {
    return ids.map(id => this.nodeMap.get(id)).filter(Boolean);
  }

  // Check if node exists
  hasNode(id) {
    return this.nodeMap.has(id);
  }

  // Get node count
  size() {
    return this.nodeMap.size;
  }
}

/**
 * Hook for optimized node state management
 */
const useOptimizedNodes = (initialNodes = []) => {
  const stateManagerRef = useRef(null);
  const [nodes, setNodesState] = useState(initialNodes);
  const [, forceUpdate] = useState({});

  // Initialize state manager
  if (!stateManagerRef.current) {
    stateManagerRef.current = new NodeStateManager();
    stateManagerRef.current.setNodes(initialNodes);
  }

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = stateManagerRef.current.subscribe((newNodes) => {
      setNodesState(newNodes);
    });
    return unsubscribe;
  }, []);

  // Update nodes when external changes occur
  useEffect(() => {
    stateManagerRef.current.setNodes(initialNodes);
  }, [initialNodes]);

  // Optimized update functions
  const updateNode = useCallback((id, updates, immediate = false) => {
    return stateManagerRef.current.updateNode(id, updates, immediate);
  }, []);

  const updateNodes = useCallback((nodeUpdates, immediate = false) => {
    return stateManagerRef.current.updateNodes(nodeUpdates, immediate);
  }, []);

  const addNode = useCallback((node) => {
    stateManagerRef.current.addNode(node);
  }, []);

  const removeNode = useCallback((id) => {
    return stateManagerRef.current.removeNode(id);
  }, []);

  const getNode = useCallback((id) => {
    return stateManagerRef.current.getNode(id);
  }, []);

  const getNodesByIds = useCallback((ids) => {
    return stateManagerRef.current.getNodesByIds(ids);
  }, []);

  const flush = useCallback(() => {
    stateManagerRef.current.flush();
  }, []);

  return {
    nodes,
    updateNode,
    updateNodes,
    addNode,
    removeNode,
    getNode,
    getNodesByIds,
    flush,
    stateManager: stateManagerRef.current
  };
};

/**
 * Memoized node selector to prevent unnecessary re-renders
 */
const useNodeSelector = (nodes, selector, deps = []) => {
  return useMemo(() => selector(nodes), [nodes, ...deps]);
};

/**
 * Optimized visible nodes calculation with memoization
 */
const useVisibleNodes = (nodes, pan, zoom, containerRef) => {
  return useMemo(() => {
    if (!containerRef.current || nodes.length === 0) return nodes;

    const rect = containerRef.current.getBoundingClientRect();
    const buffer = Math.max(50, 200 / zoom);
    
    const visibleLeft = -pan.x / zoom - buffer;
    const visibleTop = -pan.y / zoom - buffer;
    const visibleWidth = rect.width / zoom + buffer * 2;
    const visibleHeight = rect.height / zoom + buffer * 2;

    return nodes.filter((node) => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      return (
        node.x + width >= visibleLeft &&
        node.x <= visibleLeft + visibleWidth &&
        node.y + height >= visibleTop &&
        node.y <= visibleTop + visibleHeight
      );
    });
  }, [nodes, Math.round(pan.x / 50) * 50, Math.round(pan.y / 50) * 50, Math.round(zoom * 20) / 20, containerRef]);
};

// ===== END OPTIMIZED STATE MANAGEMENT SYSTEM =====

/**
 * Optimized Links State Manager
 * Handles links with the same optimizations as nodes
 */
class LinksStateManager {
  constructor() {
    this.linkMap = new Map(); // Fast O(1) lookups by link ID
    this.sourceMap = new Map(); // Map from source node ID to Set of link IDs
    this.targetMap = new Map(); // Map from target node ID to Set of link IDs
    this.changeQueue = new Map(); // Batch pending changes
    this.batchTimeout = null;
    this.subscribers = new Set();
  }

  // Set initial links with Map-based indexing
  setLinks(links) {
    this.linkMap.clear();
    this.sourceMap.clear();
    this.targetMap.clear();
    
    links.forEach(link => {
      this.linkMap.set(link.id, link);
      
      // Index by source
      if (!this.sourceMap.has(link.source)) {
        this.sourceMap.set(link.source, new Set());
      }
      this.sourceMap.get(link.source).add(link.id);
      
      // Index by target
      if (!this.targetMap.has(link.target)) {
        this.targetMap.set(link.target, new Set());
      }
      this.targetMap.get(link.target).add(link.id);
    });
    
    this.notifySubscribers();
  }

  // Get all links as array
  getLinks() {
    return Array.from(this.linkMap.values());
  }

  // Get link by ID with O(1) lookup
  getLink(id) {
    return this.linkMap.get(id);
  }

  // Get links by source node ID - O(1) lookup
  getLinksBySource(nodeId) {
    const linkIds = this.sourceMap.get(nodeId);
    if (!linkIds) return [];
    return Array.from(linkIds).map(id => this.linkMap.get(id)).filter(Boolean);
  }

  // Get links by target node ID - O(1) lookup
  getLinksByTarget(nodeId) {
    const linkIds = this.targetMap.get(nodeId);
    if (!linkIds) return [];
    return Array.from(linkIds).map(id => this.linkMap.get(id)).filter(Boolean);
  }

  // Get all links connected to a node (both source and target)
  getLinksByNode(nodeId) {
    const sourceLinks = this.getLinksBySource(nodeId);
    const targetLinks = this.getLinksByTarget(nodeId);
    const allLinks = [...sourceLinks, ...targetLinks];
    // Remove duplicates if any
    return allLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.id === link.id)
    );
  }

  // Optimized single link update
  updateLink(id, updates, immediate = false) {
    const currentLink = this.linkMap.get(id);
    if (!currentLink) return false;

    // Check if any properties actually changed
    const hasChanges = Object.keys(updates).some(key => 
      currentLink[key] !== updates[key]
    );
    
    if (!hasChanges) return false;

    if (immediate) {
      const updatedLink = { ...currentLink, ...updates };
      this._updateLinkInMaps(currentLink, updatedLink);
      this.notifySubscribers();
      return true;
    } else {
      this.queueChange(id, updates);
      return true;
    }
  }

  // Internal method to update link in all maps when source/target changes
  _updateLinkInMaps(oldLink, newLink) {
    // Remove from old indices if source/target changed
    if (oldLink.source !== newLink.source) {
      const oldSourceSet = this.sourceMap.get(oldLink.source);
      if (oldSourceSet) {
        oldSourceSet.delete(oldLink.id);
        if (oldSourceSet.size === 0) {
          this.sourceMap.delete(oldLink.source);
        }
      }
      
      // Add to new source index
      if (!this.sourceMap.has(newLink.source)) {
        this.sourceMap.set(newLink.source, new Set());
      }
      this.sourceMap.get(newLink.source).add(newLink.id);
    }

    if (oldLink.target !== newLink.target) {
      const oldTargetSet = this.targetMap.get(oldLink.target);
      if (oldTargetSet) {
        oldTargetSet.delete(oldLink.id);
        if (oldTargetSet.size === 0) {
          this.targetMap.delete(oldLink.target);
        }
      }
      
      // Add to new target index
      if (!this.targetMap.has(newLink.target)) {
        this.targetMap.set(newLink.target, new Set());
      }
      this.targetMap.get(newLink.target).add(newLink.id);
    }

    // Update main link map
    this.linkMap.set(newLink.id, newLink);
  }

  // Queue changes for batched processing
  queueChange(id, updates) {
    const existing = this.changeQueue.get(id) || {};
    this.changeQueue.set(id, { ...existing, ...updates });

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatchedChanges();
    }, 16); // ~60fps batching
  }

  // Process all batched changes at once
  processBatchedChanges() {
    if (this.changeQueue.size === 0) return;

    let hasChanges = false;
    for (const [id, updates] of this.changeQueue) {
      const currentLink = this.linkMap.get(id);
      if (currentLink) {
        const updatedLink = { ...currentLink, ...updates };
        this._updateLinkInMaps(currentLink, updatedLink);
        hasChanges = true;
      }
    }

    this.changeQueue.clear();
    this.batchTimeout = null;

    if (hasChanges) {
      this.notifySubscribers();
    }
  }

  // Add a new link
  addLink(link) {
    this.linkMap.set(link.id, link);
    
    // Add to source index
    if (!this.sourceMap.has(link.source)) {
      this.sourceMap.set(link.source, new Set());
    }
    this.sourceMap.get(link.source).add(link.id);
    
    // Add to target index
    if (!this.targetMap.has(link.target)) {
      this.targetMap.set(link.target, new Set());
    }
    this.targetMap.get(link.target).add(link.id);
    
    this.notifySubscribers();
  }

  // Remove a link
  removeLink(id) {
    const link = this.linkMap.get(id);
    if (!link) return false;

    // Remove from all indices
    this.linkMap.delete(id);
    
    const sourceSet = this.sourceMap.get(link.source);
    if (sourceSet) {
      sourceSet.delete(id);
      if (sourceSet.size === 0) {
        this.sourceMap.delete(link.source);
      }
    }
    
    const targetSet = this.targetMap.get(link.target);
    if (targetSet) {
      targetSet.delete(id);
      if (targetSet.size === 0) {
        this.targetMap.delete(link.target);
      }
    }
    
    this.notifySubscribers();
    return true;
  }

  // Subscribe to state changes
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Notify all subscribers
  notifySubscribers() {
    const links = this.getLinks();
    this.subscribers.forEach(callback => callback(links));
  }

  // Force immediate processing
  flush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.processBatchedChanges();
    }
  }

  // Get links count
  size() {
    return this.linkMap.size;
  }

  // Check if link exists
  hasLink(id) {
    return this.linkMap.has(id);
  }

  // Remove all links connected to a node (useful when deleting nodes)
  removeLinksForNode(nodeId) {
    const connectedLinks = this.getLinksByNode(nodeId);
    connectedLinks.forEach(link => this.removeLink(link.id));
  }
}

/**
 * Hook for optimized links state management
 */
const useOptimizedLinks = (initialLinks = []) => {
  const stateManagerRef = useRef(null);
  const [links, setLinksState] = useState(initialLinks);

  // Initialize state manager
  if (!stateManagerRef.current) {
    stateManagerRef.current = new LinksStateManager();
    stateManagerRef.current.setLinks(initialLinks);
  }

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = stateManagerRef.current.subscribe((newLinks) => {
      setLinksState(newLinks);
    });
    return unsubscribe;
  }, []);

  // Update links when external changes occur
  useEffect(() => {
    stateManagerRef.current.setLinks(initialLinks);
  }, [initialLinks]);

  // Optimized update functions
  const updateLink = useCallback((id, updates, immediate = false) => {
    return stateManagerRef.current.updateLink(id, updates, immediate);
  }, []);

  const addLink = useCallback((link) => {
    stateManagerRef.current.addLink(link);
  }, []);

  const removeLink = useCallback((id) => {
    return stateManagerRef.current.removeLink(id);
  }, []);

  const getLink = useCallback((id) => {
    return stateManagerRef.current.getLink(id);
  }, []);

  const getLinksBySource = useCallback((nodeId) => {
    return stateManagerRef.current.getLinksBySource(nodeId);
  }, []);

  const getLinksByTarget = useCallback((nodeId) => {
    return stateManagerRef.current.getLinksByTarget(nodeId);
  }, []);

  const getLinksByNode = useCallback((nodeId) => {
    return stateManagerRef.current.getLinksByNode(nodeId);
  }, []);

  const removeLinksForNode = useCallback((nodeId) => {
    return stateManagerRef.current.removeLinksForNode(nodeId);
  }, []);

  const flush = useCallback(() => {
    stateManagerRef.current.flush();
  }, []);

  return {
    links,
    updateLink,
    addLink,
    removeLink,
    getLink,
    getLinksBySource,
    getLinksByTarget,
    getLinksByNode,
    removeLinksForNode,
    flush,
    stateManager: stateManagerRef.current
  };
};

/**
 * Optimized visible links calculation with memoization
 */
const useVisibleLinks = (links, visibleNodeIds) => {
  return useMemo(() => {
    if (!visibleNodeIds || visibleNodeIds.size === 0) return [];
    
    return links.filter(link => 
      visibleNodeIds.has(link.source) || visibleNodeIds.has(link.target)
    );
  }, [links, visibleNodeIds]);
};

// ===== END OPTIMIZED STATE MANAGEMENT SYSTEM =====

// Virtual Node Renderer Component with Node Pooling
const VirtualNodeRenderer = memo(({
  nodes,
  zoom,
  pan,
  outerRef,
  visibleNodes,
  selectedNodes,
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
  zoomRef
}) => {
  const poolRef = useRef([]); // Component pool for reuse
  const renderedNodesRef = useRef(new Map()); // Track rendered nodes
  
  // Enhanced viewport culling - only render nodes truly visible in viewport
  const getViewportBounds = useCallback(() => {
    if (!outerRef.current) return null;
    
    const rect = outerRef.current.getBoundingClientRect();
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const buffer = Math.max(100, 300 / currentZoom); // Larger buffer for smooth scrolling
    
    return {
      left: (-currentPan.x / currentZoom) - buffer,
      top: (-currentPan.y / currentZoom) - buffer,
      right: (-currentPan.x + rect.width) / currentZoom + buffer,
      bottom: (-currentPan.y + rect.height) / currentZoom + buffer
    };
  }, [outerRef, panRef, zoomRef]);
  
  // Optimized visible nodes calculation with spatial awareness
  const virtualVisibleNodes = useMemo(() => {
    if (!outerRef.current) return visibleNodes;
    
    const rect = outerRef.current.getBoundingClientRect();
    const currentZoom = zoom; // Use state values for reactivity
    const currentPan = pan;   // Use state values for reactivity
    const buffer = Math.max(100, 300 / currentZoom);
    
    const viewport = {
      left: (-currentPan.x / currentZoom) - buffer,
      top: (-currentPan.y / currentZoom) - buffer,
      right: (-currentPan.x + rect.width) / currentZoom + buffer,
      bottom: (-currentPan.y + rect.height) / currentZoom + buffer
    };
    
    return visibleNodes.filter(node => {
      const nodeRight = node.x + (node.width || DEFAULT_WIDTH);
      const nodeBottom = node.y + (node.height || DEFAULT_HEIGHT);
      
      return !(
        node.x > viewport.right ||
        nodeRight < viewport.left ||
        node.y > viewport.bottom ||
        nodeBottom < viewport.top
      );
    });
  }, [visibleNodes, zoom, pan, outerRef]);
  
  // Node component factory with pooling
  const createNodeComponent = useCallback((node, index) => {
    return (
      <MindMapNode
        key={`virtual-${node.id}-${index}`}
        node={node}
        zoom={zoomRef.current}
        groupDelta={groupDelta}
        isHighlighted={isNodeHighlighted(node)}
        currentUserEmail={currentUserEmail}
        selectedNodes={selectedNodes}
        editingNodeId={editingNodeId}
        editedText={editedText}
        handleResizeMouseDown={isMobile ? () => {} : handleResizeMouseDown}
        handleNodeClick={isMobile ? () => {} : handleNodeClick}
        handleDoubleClick={isMobile ? () => {} : handleDoubleClick}
        handleTyping={isMobile ? () => {} : handleTyping}
        handleTextBlur={isMobile ? () => {} : handleTextBlur}
        setEditedText={isMobile ? () => {} : setEditedText}
        setHoveredNodeId={isMobile ? () => {} : setHoveredNodeId}
        linkingSource={linkingSource}
        hoveredNodeId={hoveredNodeId}
        onStart={isMobile ? () => false : (e, data) => {
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
          if (selectedNodes.length < 1 || selectedNodes.length < 2) {
            pushSingleNodeToUndoStack(node);
          }
          if (selectedNodes.length > 1 && selectedNodes.includes(node.id)) {
            if (Object.keys(multiDragStartRef.current).length === 0) {
              selectedNodes.forEach((id) => {
                const found = nodes.find((n) => n.id === id);
                if (found) {
                  multiDragStartRef.current[id] = { x: found.x, y: found.y };
                }
              });
            }
          }
        }}
        onDrag={isMobile ? () => {} : (e, data) => {
          const rect = outerRef.current.getBoundingClientRect();
          const cursorWorldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
          const cursorWorldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
          const newX = cursorWorldX - dragStartRef.current.offsetX;
          const newY = cursorWorldY - dragStartRef.current.offsetY;
          if (selectedNodes.length > 1 && selectedNodes.includes(node.id)) {
            updateGroupDelta({
              x: newX - dragStartRef.current.initialX,
              y: newY - dragStartRef.current.initialY
            });
          } else {
            setNodes((prev) =>
              prev.map((n) => (n.id === node.id ? { ...n, x: newX, y: newY } : n))
            );
          }
        }}
        onStop={isMobile ? () => {} : async (e, data) => {
          const rect = outerRef.current.getBoundingClientRect();
          const cursorWorldX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
          const cursorWorldY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
          const finalX = cursorWorldX - dragStartRef.current.offsetX;
          const finalY = cursorWorldY - dragStartRef.current.offsetY;
          const distance = Math.sqrt(
            Math.pow(finalX - dragStartRef.current.initialX, 2) +
              Math.pow(finalY - dragStartRef.current.initialY, 2)
          );
          const threshold = 0.01;
          if (distance < threshold) {
            setIsDragging(false);
            return;
          }
          if (selectedNodes.length > 1) {
            pushSelectionToUndoStack();
            const deltaX = finalX - dragStartRef.current.initialX;
            const deltaY = finalY - dragStartRef.current.initialY;
            const newPositions = {};
            selectedNodes.forEach((id) => {
              const startPos = multiDragStartRef.current[id];
              if (startPos) {
                newPositions[id] = {
                  x: startPos.x + deltaX,
                  y: startPos.y + deltaY
                };
              }
            });
            setNodes((prev) =>
              prev.map((n) =>
                selectedNodes.includes(n.id) && newPositions[n.id] && n.id !== node.id
                  ? { ...n, x: newPositions[n.id].x, y: newPositions[n.id].y }
                  : n
              )
            );
            const batch = writeBatch(db);
            // Filter out any selected nodes that don't exist in the current nodes array
            const validSelectedNodes = selectedNodes.filter(id => 
              nodes.some(nodeCheck => nodeCheck.id === id)
            );
            
            validSelectedNodes.forEach((id) => {
              if (newPositions[id]) {
                const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
                batch.update(nodeRef, {
                  x: newPositions[id].x,
                  y: newPositions[id].y
                });
              }
            });
            try {
              await batch.commit();
            } catch (error) {
              console.error("Error updating nodes in batch:", error);
              // Clear invalid selections
              setSelectedNodes(prev => prev.filter(id => 
                nodes.some(nodeCheck => nodeCheck.id === id)
              ));
            }
            multiDragStartRef.current = {};
            setGroupDelta({ x: 0, y: 0 });
          } else {
            setNodes((prev) =>
              prev.map((n) => (n.id === node.id ? { ...n, x: finalX, y: finalY } : n))
            );
            try {
              // Check if node still exists before updating
              const nodeExists = nodes.some(n => n.id === node.id);
              if (nodeExists) {
              const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
              await updateDoc(nodeRef, { x: finalX, y: finalY });
              }
            } catch (error) {
              console.error("Error updating node position:", error);
              // Clear invalid selections
              setSelectedNodes(prev => prev.filter(id => 
                nodes.some(n => n.id === id)
              ));
            }
          }
          setIsDragging(false);
        }}
      />
    );
  }, [
    zoomRef, groupDelta, isNodeHighlighted, currentUserEmail, selectedNodes, 
    editingNodeId, editedText, handleResizeMouseDown, handleNodeClick,
    handleDoubleClick, handleTyping, handleTextBlur, setEditedText,
    setHoveredNodeId, linkingSource, hoveredNodeId, nodes, outerRef,
    panRef, dragStartRef, multiDragStartRef, setIsDragging, setNodes,
    setGroupDelta, mindMapId, pushSingleNodeToUndoStack, pushSelectionToUndoStack,
    setSelectedNodes, updateGroupDelta
  ]);
  
  // Render only visible nodes with z-index sorting
  return (
    <>
      {virtualVisibleNodes
        .sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1))
        .map((node, index) => createNodeComponent(node, index))
      }
    </>
  );
});

const MindMapEditor = () => {
  const { id: mindMapId } = useParams();
  const navigate = useNavigate();

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

  // Sidebar customization state
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  // Real-time collaboration (presence, persistent in Firestore)
  const [currentUserEmail, setCurrentUserEmail] = useState(null);
  const [currentUserUid, setCurrentUserUid] = useState(null);
  const [presenceUsers, setPresenceUsers] = useState([]);

  // Ephemeral state for cursor tracking via RTDB
  const [localCursor, setLocalCursor] = useState({ x: 0, y: 0 });
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
  const isRendering = useRef(false);

  // Local hover state for highlighting
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  const [selectionUndoStack, setSelectionUndoStack] = useState([]); // Each snapshot is an object: { [nodeId]: { ...nodeState }
  const [selectionRedoStack, setSelectionRedoStack] = useState([]);

  // Ref for the canvas container (zoomable/pannable)
  const containerRef = useRef(null);
  const outerRef = useRef(null);

  // Optimized visible nodes calculation (moved after outerRef declaration)
  const visibleNodes = useVisibleNodes(nodes, pan, zoom, outerRef);

  // Optimized visible links calculation
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleLinks = useVisibleLinks(links, visibleNodeIds);

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

  // Optimized single node update
  const updateSingleNode = useCallback((id, updates, immediate = false) => {
    updateNodeOptimized(id, updates, immediate);
    
    // Also update Firebase if immediate
    if (immediate && Object.keys(updates).length > 0) {
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
      updateDoc(nodeRef, updates).catch(console.error);
    }
  }, [updateNodeOptimized, mindMapId]);

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

  // Optimized transform update function
  const updateTransform = useCallback((newPan, newZoom) => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
    
    animationFrameId.current = requestAnimationFrame(() => {
      const now = performance.now();
      if (now - lastRenderTime.current < 16) return; // Limit to ~60fps
      
      if (newPan) {
        setPan(newPan);
        panRef.current = newPan;
      }
      if (newZoom !== undefined) {
        setZoom(newZoom);
        zoomRef.current = newZoom;
      }
      
      lastRenderTime.current = now;
      animationFrameId.current = null;
    });
  }, []);

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

  // Font
  const [fontFamily, setFontFamily] = useState("cursive");
  const [fontSize, setFontSize] = useState(14);
  const [textStyle, setTextStyle] = useState([]); // e.g. ['bold', 'italic']
  const [tempTextStyle, setTempTextStyle] = useState([]);
  const [textAlign, setTextAlign] = useState("left");
  const [tempTextAlign, setTempTextAlign] = useState("left");

  // Topic
  const [shape, setShape] = useState("rectangle");
  const [corner, setCorner] = useState(0);
  const [filling, setFilling] = useState("#ff0000");
  const [shadow, setShadow] = useState(false);
  const [customWidth, setCustomWidth] = useState(100);

  // Border
  const [borderColor, setBorderColor] = useState("#000000");
  const [borderWeight, setBorderWeight] = useState(1);
  const [borderDashes, setBorderDashes] = useState(false);

  // Branch
  const [lineColor, setLineColor] = useState("#ff0000");
  const [lineWeight, setLineWeight] = useState(1);
  const [lineDashes, setLineDashes] = useState(false);
  const [arrowStyle, setArrowStyle] = useState("none");
  const [branchNumber, setBranchNumber] = useState(1);
  const [color, setColor] = useState('#ff0000');

  // Memoized text style handler
  const handleTextStyleChange = useCallback((event, newStyles) => {
    setTextStyle(newStyles);
  }, []);

  // Check if we have bold, italic, underline in textStyle array
  const isBold = textStyle.includes("bold");
  const isItalic = textStyle.includes("italic");
  const isUnderline = textStyle.includes("underline");

  const presetSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
  //const [fontSize, setFontSize] = useState(14);
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

  // Memoized process key interaction
  const processKeyInteraction = useCallback((event) => {
    console.log("Processing key interaction:", event.key);
  }, []);

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
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);

  // Hotkey definitions
  const HOTKEYS = {
    'Tab': 'Add connected node to selected',
    'Enter': 'Edit selected node text',
    'Escape': 'Exit current mode/clear selection',
    'Space': 'Toggle pan mode',
    'Ctrl+A': 'Select all nodes',
    'Ctrl+D': 'Duplicate selected nodes',
    'Ctrl+Z': 'Undo last action',
    'Ctrl+Y': 'Redo last action',
    'Ctrl+C': 'Copy selected nodes',
    'Ctrl+V': 'Paste nodes',
    'Delete/Backspace': 'Delete selected nodes',
    'Ctrl+F': 'Search nodes',
    'F3': 'Find next search result',
    'Shift+F3': 'Find previous search result',
    'Home': 'Zoom to fit all nodes',
    '0': 'Reset zoom to 100%',
    '+/=': 'Zoom in',
    '-': 'Zoom out',
    'F': 'Focus on selected nodes',
    'Ctrl+L': 'Toggle linking mode',
    'Ctrl+E': 'Export mind map',
    'Ctrl+/': 'Show/hide hotkey help',
    'Ctrl+Shift+A': 'Auto-layout nodes',
    'R': 'Reset pan and zoom'
  };

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
      const newX = localCursor.x || (parentNode.x + 150);
      const newY = localCursor.y || parentNode.y;

      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: newX - DEFAULT_WIDTH / 2, // Center on cursor
        y: newY - DEFAULT_HEIGHT / 2,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        textColor: "#EAEAEA",
        fontSize: 14,
        fontFamily: "cursive",
        createdAt: serverTimestamp(),
      });

      // Create link between parent and new node
      await createLink(selectedNodes[0], docRef.id);

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
  }, [selectedNodes, nodes, mindMapId, localCursor]);

  // AUTH: subscribe to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUserEmail(user.email);
        setCurrentUserUid(user.uid);
      } else {
        setError('Please log in to access the mind map');
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to nodes in Firestore
  useEffect(() => {
    if (!mindMapId) return;
    
    setIsLoading(true);
    const q = query(collection(db, "mindMaps", mindMapId, "nodes"));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        try {
      const nodesData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setRawNodes(nodesData); // Use optimized state management
          setIsLoading(false);
          setError(null);
        } catch (err) {
          console.error("Error processing nodes:", err);
          setError("Failed to load mind map data");
          setIsLoading(false);
        }
      },
      (err) => {
        console.error("Error subscribing to nodes:", err);
        setError("Failed to connect to mind map");
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [mindMapId]);

  // Subscribe to links in Firestore
  useEffect(() => {
    if (!mindMapId) return;
    const q = query(collection(db, "mindMaps", mindMapId, "links"));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        try {
      const linksData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setRawLinks(linksData); // Use optimized state management
        } catch (err) {
          console.error("Error processing links:", err);
        }
      },
      (err) => {
        console.error("Error subscribing to links:", err);
      }
    );
    return () => unsubscribe();
  }, [mindMapId]);

  // Presence updates in Firestore
  useEffect(() => {
    if (!mindMapId || !currentUserUid) return;
    const presenceDocRef = doc(
      db,
      "mindMaps",
      mindMapId,
      "presence",
      currentUserUid,
    );
    setDoc(
      presenceDocRef,
      { email: currentUserEmail, lastActive: serverTimestamp() },
      { merge: true },
    ).catch(console.error);
    const intervalId = setInterval(() => {
      setDoc(
        presenceDocRef,
        { lastActive: serverTimestamp() },
        { merge: true },
      ).catch(console.error);
    }, 5000);
    return () => {
      clearInterval(intervalId);
      deleteDoc(presenceDocRef).catch(console.error);
    };
  }, [mindMapId, currentUserUid, currentUserEmail]);

  useEffect(() => {
    if (!mindMapId) return;
    const q = query(collection(db, "mindMaps", mindMapId, "presence"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map((doc) => doc.data());
      setPresenceUsers(users);
    });
    return () => unsubscribe();
  }, [mindMapId]);

  // --- Ephemeral Cursor Tracking using RTDB ---
  useEffect(() => {
    if (!mindMapId || !currentUserUid) return;
    const dbRealtime = getDatabase();
    const cursorRef = ref(dbRealtime, `mindMaps/${mindMapId}/cursors/${currentUserUid}`);
    const container = containerRef.current;
    if (!container) return;

    // Throttle the mouse move handler to run at most once every 16ms.
    const handleMouseMove = throttle((e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      localCursorRef.current = { x, y };
      setLocalCursor({ x, y });
    }, 16);

    container.addEventListener("mousemove", handleMouseMove);

    const interval = setInterval(() => {
      if (!document.hidden) {
        set(cursorRef, {
          ...localCursorRef.current,
          email: currentUserEmail,
          lastActive: Date.now(),
          uid: currentUserUid,
        }).catch(console.error);
      }
    }, 200);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (cursorRef) {
          remove(cursorRef).catch(console.error);
        }
      } else {
        set(cursorRef, {
          ...localCursorRef.current,
          email: currentUserEmail,
          lastActive: Date.now(),
          uid: currentUserUid,
        }).catch(console.error);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      handleMouseMove.cancel(); // cancel any pending throttled calls
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (cursorRef) {
        remove(cursorRef).catch(console.error);
      }
    };
  }, [mindMapId, currentUserUid, currentUserEmail]);



  // Subscribe to remote cursors from RTDB
  useEffect(() => {
    if (!mindMapId) return;
    //console.log("Setting up remote cursor subscription for mindMapId:", mindMapId);

    const dbRealtime = getDatabase();
    const cursorsRef = ref(dbRealtime, `mindMaps/${mindMapId}/cursors`);

    const handleValue = (snapshot) => {
      const data = snapshot.val() || {};
      //console.log("Remote cursor data received:", data); // Debug log
      const cursorsArray = Object.entries(data).map(([uid, cursorData]) => ({
        uid,
        ...cursorData,
      }));
      setCursors(cursorsArray);
    };

    onValue(cursorsRef, handleValue, (error) => {
      console.error("Error receiving remote cursor data:", error);
    });

    return () => {
      // Detach the listener with the same callback
      off(cursorsRef, "value", handleValue);
    };
  }, [mindMapId]);

  // Clean up selectedNodes when nodes change to remove stale node IDs
  useEffect(() => {
    if (selectedNodes.length > 0) {
      const existingNodeIds = nodes.map(node => node.id);
      const validSelectedNodes = selectedNodes.filter(nodeId => existingNodeIds.includes(nodeId));
      
      if (validSelectedNodes.length !== selectedNodes.length) {
        console.log(`Cleaning up selectedNodes: ${selectedNodes.length - validSelectedNodes.length} stale node IDs removed`);
        setSelectedNodes(validSelectedNodes);
      }
    }
  }, [nodes]); // Only depend on nodes, not selectedNodes to avoid infinite loops

  useEffect(() => {
    if (!outerRef.current) return;

    // Throttle global mousemove handler
    const handleGlobalMouseMove = throttle((e) => {
      const container = outerRef.current;
      const rect = container.getBoundingClientRect();
      const worldX = (e.clientX - rect.left - pan.x) / zoom;
      const worldY = (e.clientY - rect.top - pan.y) / zoom;
      localCursorRef.current = { x: worldX, y: worldY };
      setLocalCursor({ x: worldX, y: worldY });
    }, 16);

    document.addEventListener("mousemove", handleGlobalMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      handleGlobalMouseMove.cancel();
    };
  }, [pan, zoom]);





  const handleNodeClick = (node, e) => {
    e.stopPropagation();

    if (linkingMode) {
      if (!linkingSource) {
        setLinkingSource(node.id);
      } else if (linkingSource === node.id) {
        setLinkingSource(null);
      } else {
        createLink(linkingSource, node.id)
          .then((linkId) => {
            if (linkId) {
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

  const pushSelectionToUndoStack = (customSnapshot) => {
    let snapshot = {};
    if (customSnapshot) {
      snapshot = customSnapshot;
    } else {
      // Build snapshot from the currently selected nodes.
      selectedNodes.forEach((id) => {
        const node = nodes.find((n) => n.id === id);
        if (node) {
          snapshot[id] = { ...node };
        }
      });
    }
    // Deep clone the snapshot to ensure no undefined values remain.
    const deepSnapshot = JSON.parse(JSON.stringify(snapshot));
    if (Object.keys(deepSnapshot).length > 0) {
      setSelectionUndoStack((prev) => [...prev, deepSnapshot]);
      setSelectionRedoStack([]);
    }
    
  };

  const pushSingleNodeToUndoStack = (node) => {
    if (node) {
      const snapshot = { [node.id]: { ...node } };
      setSelectionUndoStack((prev) => [...prev, snapshot]);
      setSelectionRedoStack([]);
    }
  };



  const handleUndoSelection = async () => {
    if (selectionUndoStack.length === 0) return;
  
    // Get the last snapshot
    const snapshot = selectionUndoStack[selectionUndoStack.length - 1];
    const snapshotNodes = snapshot.nodes ? snapshot.nodes : snapshot;
  
    // Build a redo snapshot before making changes (if needed)
    const redoSnapshot = {};
    Object.keys(snapshotNodes).forEach((id) => {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        redoSnapshot[id] = { ...node };
      }
    });
    setSelectionRedoStack((prev) => [...prev, redoSnapshot]);
  
    // Create a single write batch for all operations
    const batch = writeBatch(db);
    
    // For each node in the snapshot...
    for (const id of Object.keys(snapshotNodes)) {
      const undoData = snapshotNodes[id];
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
      
      if (undoData && undoData.isNew) {
        // Delete the node.
        batch.delete(nodeRef);
  
        // Optionally, query for and add delete operations for associated links
        // (Consider running these queries outside the loop so you're not
        //  awaiting for each node—collect them first then add to batch)
        const outgoingQuery = query(
          collection(db, "mindMaps", mindMapId, "links"),
          where("source", "==", id)
        );
        const outgoingSnapshot = await getDocs(outgoingQuery);
        outgoingSnapshot.docs.forEach((docSnap) => {
          const linkRef = doc(db, "mindMaps", mindMapId, "links", docSnap.id);
          batch.delete(linkRef);
        });
        
        const incomingQuery = query(
          collection(db, "mindMaps", mindMapId, "links"),
          where("target", "==", id)
        );
        const incomingSnapshot = await getDocs(incomingQuery);
        incomingSnapshot.docs.forEach((docSnap) => {
          const linkRef = doc(db, "mindMaps", mindMapId, "links", docSnap.id);
          batch.delete(linkRef);
        });
        
      } else if (undoData) {
        // Restore its previous state.
        batch.set(nodeRef, undoData, { merge: true });
      }
    }
  
    // Now commit the batch once.
    try {
      await batch.commit();
      console.log("Batch undo successful");
    } catch (error) {
      console.error("Error during batch undo:", error);
    }
  
    // Update local state: Remove nodes that were marked as new.
    setNodes((prev) => prev.filter((n) => !(snapshotNodes[n.id] && snapshotNodes[n.id].isNew)));
    setSelectionUndoStack((prev) => prev.slice(0, prev.length - 1));
  };
  

  const handleRedoSelection = async () => {
    if (selectionRedoStack.length === 0) return;
    // Get the last group snapshot from the redo stack.
    const snapshot = selectionRedoStack[selectionRedoStack.length - 1];
    console.log("Redo snapshot:", snapshot);

    // Build a new undo snapshot from the current state.
    const newUndoSnapshot = {};
    Object.keys(snapshot).forEach((id) => {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        newUndoSnapshot[id] = { ...node };
      }
    });
    // Push this new undo snapshot so that redo itself can be undone.
    setSelectionUndoStack((prev) => [...prev, newUndoSnapshot]);

    // Create a Firestore batch to reapply the redo snapshot.
    const batch = writeBatch(db);
    Object.keys(snapshot).forEach((id) => {
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
      // Using set with merge: true will recreate the document if it was deleted,
      // or update its properties if it exists.
      batch.set(nodeRef, snapshot[id], { merge: true });
    });

    try {
      await batch.commit();
      console.log("Batch redo successful");
    } catch (error) {
      console.error("Error during batch redo:", error);
    }

    // Update local state: For each node in the snapshot, add it if missing or update it if present.
    setNodes((prev) => {
      const updatedNodes = [...prev];
      Object.keys(snapshot).forEach((id) => {
        const index = updatedNodes.findIndex((n) => n.id === id);
        if (index === -1) {
          // Node was deleted locally; add it back.
          updatedNodes.push({ id, ...snapshot[id] });
        } else {
          // Node exists; update its state.
          updatedNodes[index] = { ...updatedNodes[index], ...snapshot[id] };
        }
      });
      return updatedNodes;
    });

    // Remove the last snapshot from the redo stack.
    setSelectionRedoStack((prev) => prev.slice(0, prev.length - 1));
  };

  const handleResizeMouseDown = (node, e, direction = 'se') => {
    if (e.button !== 0) return;
    
    // Create a Map for O(1) node lookups instead of O(n) find operations
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    
    // Determine which nodes to resize (single node or all selected nodes)
    const nodesToResize = selectedNodes.length > 1 && selectedNodes.includes(node.id) 
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
    setZoom((prev) => {
      const newZoom = Math.min(MAX_ZOOM, prev + ZOOM_STEP);
      zoomRef.current = newZoom; // update the ref with the new zoom
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const newZoom = Math.max(MIN_ZOOM, prev - ZOOM_STEP);
      zoomRef.current = newZoom; // update the ref with the new zoom
      return newZoom;
    });
  };
  useEffect(() => {
    const container = outerRef.current;
    const container2 = containerRef.current;
    if (!container || !container2) return;

    // Create a throttled handler that runs at most once every 16ms (~60fps)
    const handleWheelCustom = throttle((e) => {
      // Adjust scaleBy depending on whether Shift is pressed
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

      // Compute the pointer's position in world coordinates
      const mousePointTo = {
        x: (cursorX - panRef.current.x) / oldZoom,
        y: (cursorY - panRef.current.y) / oldZoom,
      };

      // Calculate new pan so that the pointer stays at the same world position
      const newPan = {
        x: cursorX - mousePointTo.x * newZoom,
        y: cursorY - mousePointTo.y * newZoom,
      };

      setZoom(newZoom);
      setPan(newPan);
      zoomRef.current = newZoom;
      panRef.current = newPan;
    }, 8); // Throttle to roughly 60fps (16ms)

    container.addEventListener("wheel", handleWheelCustom, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheelCustom);
      handleWheelCustom.cancel(); // Cancel any pending throttled calls
    };
  }, [zoom, pan]);



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
    //e.preventDefault(); // prevent default behavior
    // console.log("Right-click detected");
    //setRightClickMoved(false);
    panStart.current = { ...pan };
    rightClickStartRef.current = { x: e.clientX, y: e.clientY };
    mouseStart.current = { x: e.clientX, y: e.clientY };
    // Function to update pan based on the current mouse position.
    
    const updatePan = (moveEvent) => {
      
      const dx = moveEvent.clientX - mouseStart.current.x;
      const dy = moveEvent.clientY - mouseStart.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 15) {
      setRightClickMoved(true);
      }
      requestAnimationFrame(() => {
      const deltaX = moveEvent.clientX - mouseStart.current.x;
      const deltaY = moveEvent.clientY - mouseStart.current.y;
      const newX = panStart.current.x + deltaX;
      const newY = panStart.current.y + deltaY;
      setPan({ x: newX, y: newY });
      panRef.current = { x: newX, y: newY };
      });
      
    };

    // Throttle the updatePan function to run at most once every 16ms (~60fps)
    const throttledUpdatePan = throttle(updatePan, 16);

    document.addEventListener("mousemove", throttledUpdatePan);
    document.addEventListener("mouseup", function handleMouseUp() {
      document.removeEventListener("mousemove", throttledUpdatePan);
      document.removeEventListener("mouseup", handleMouseUp);
      throttledUpdatePan.cancel(); // Cancel any pending calls
    });
  };

  // --- NODE ACTIONS ---
  const handleAddNode = useCallback(async () => {
    if (!mindMapId) {
      return;
    }
    
    if (operationInProgress) return;
    
    //setOperationInProgress(true);
    try {
      const currentPan = panRef.current;
      const currentZoom = zoomRef.current;

      // Get the dimensions of the canvas area (adjust for sidebar and top bar).
      const rect = outerRef.current.getBoundingClientRect();
      const sidebarWidth = 250;  // adjust as needed
      const topBarHeight = 50;   // adjust as needed
      const canvasWidth = rect.width - sidebarWidth;
      const canvasHeight = rect.height - topBarHeight;
      const centerScreenX = canvasWidth / 2;
      const centerScreenY = canvasHeight / 2;

      // Convert the screen center to world coordinates using the latest pan/zoom.
      const centerWorldX = (centerScreenX - currentPan.x) / currentZoom;
      const centerWorldY = (centerScreenY - currentPan.y) / currentZoom;
      
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: centerWorldX,
        y: centerWorldY,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        textColor: "#EAEAEA",
        fontSize: 14,
        fontFamily: "cursive",
        createdAt: serverTimestamp(),
      });
      
      // Auto-select the new node for immediate editing
      setSelectedNodes([docRef.id]);
      
    } catch (error) {
      console.error("Error adding node:", error);
    } finally {
      //setOperationInProgress(false);
    }
  }, [mindMapId, operationInProgress]);

  const doubleClickAddNode = useCallback(async () => {
    if (!mindMapId) return;
    if (operationInProgress) return;
    
    //setOperationInProgress(true);
    try {
      const dropX = localCursor.x;
      const dropY = localCursor.y;
      
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: dropX - DEFAULT_WIDTH/2,
        y: dropY - DEFAULT_HEIGHT/2,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        textColor: "#EAEAEA",
        fontSize: 14,
        fontFamily: "cursive",
        createdAt: serverTimestamp(),
      });

      // Auto-select the new node
      setSelectedNodes([docRef.id]);

    } catch (error) {
      console.error("Error adding node:", error);
    } finally {
      //setOperationInProgress(false);
    }
  }, [mindMapId, localCursor]);

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
    if (!editedText.trim()) {
      return;
    }
    
    try {
      if (selectedNodes.includes(nodeId)) {
        pushSelectionToUndoStack();
      } else {
        pushSelectionToUndoStack();
      }
      
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
      await updateDoc(nodeRef, {
        text: editedText.trim(),
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

  const updateNodeText = useCallback(async (nodeId, newText) => {
    try {
      pushSelectionToUndoStack();
      
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

  // Batch version for AI operations (doesn't push to undo stack individually)
  const updateNodeTextBatch = useCallback(async (nodeId, newText) => {
    try {
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

  const addNode = useCallback(async (nodeData) => {
    try {
      // Push to undo stack before making changes
      pushSelectionToUndoStack();
      
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: nodeData.text || "New Node",
        x: nodeData.x || 0,
        y: nodeData.y || 0,
        width: nodeData.width || DEFAULT_WIDTH,
        height: nodeData.height || DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        textColor: nodeData.textColor || "#EAEAEA",
        fontSize: nodeData.fontSize || 14,
        fontFamily: nodeData.fontFamily || "cursive",
        bgColor: nodeData.bgColor || null,
        // Add support for image node properties
        type: nodeData.type || "text",
        imageUrl: nodeData.imageUrl || null,
        storagePath: nodeData.storagePath || null,
        createdAt: serverTimestamp(),
      });
      
      return docRef.id; // Return the Firebase-generated ID
    } catch (error) {
      console.error("Error adding node:", error);
      throw error;
    }
  }, [mindMapId]);

  const addLink = useCallback(async (linkData) => {
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

  // Batch versions for AI operations (don't push to undo stack individually)
  const addNodeBatch = useCallback(async (nodeData) => {
    try {
      const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: nodeData.text || "New Node",
        x: nodeData.x || 0,
        y: nodeData.y || 0,
        width: nodeData.width || DEFAULT_WIDTH,
        height: nodeData.height || DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
        textColor: nodeData.textColor || "#EAEAEA",
        fontSize: nodeData.fontSize || 14,
        fontFamily: nodeData.fontFamily || "cursive",
        bgColor: nodeData.bgColor || null,
        // Add support for image node properties
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
  }, [mindMapId]);

  const addLinkBatch = useCallback(async (linkData) => {
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




  // --- ENHANCED KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA"
      ) {
        // Allow some shortcuts even when typing
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

      // Search functionality
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) {
          navigateSearch('prev');
        } else {
          navigateSearch('next');
        }
        return;
      }

      // Navigation shortcuts
      if (e.key === "Home") {
        e.preventDefault();
        zoomToFitAll();
        return;
      }

      if (e.key === "0" && !e.ctrlKey) {
        e.preventDefault();
        setZoom(1);
        zoomRef.current = 1;
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        handleZoomIn();
        return;
      }

      if (e.key === "-") {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      if (e.key.toLowerCase() === "r" && !e.ctrlKey) {
        e.preventDefault();
        handleReset();
        return;
      }

      // Selection shortcuts
      if (e.ctrlKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllNodes();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedNodes([]);
        setLinkingMode(false);
        setLinkingSource(null);
        setShowSearch(false);
        setShowHotkeyHelp(false);
        return;
      }

      // Node creation and editing
      if (e.key === "Tab" && selectedNodes.length === 1) {
        e.preventDefault();
        addConnectedNode();
        return;
      }

      if (e.key === "Enter" && selectedNodes.length === 1) {
        e.preventDefault();
        const node = nodes.find(n => n.id === selectedNodes[0]);
        if (node) {
          handleDoubleClick(node);
        }
        return;
      }

      // Layout shortcuts
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        autoLayout();
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleLinkingMode();
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        handleExport();
        return;
      }

      // Focus on selected nodes
      if (e.key.toLowerCase() === "f" && selectedNodes.length > 0) {
        e.preventDefault();
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

        const targetCenterWorld = { 
          x: (minX + maxX) / 2, 
          y: (minY + maxY) / 2 
        };

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
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        (async () => {
          if (selectedNodes.length > 0) {
            const offset = 50; // Adjust as needed
            const groupUndoSnapshot = {};

            // Duplicate all selected nodes concurrently.
            await Promise.all(
              selectedNodes.map(async (nodeId) => {
                const node = nodes.find((n) => n.id === nodeId);
                if (node) {
                  const newPosition = {
                    x: node.x + offset,
                    y: node.y + offset,
                  };
                  const newNodeId = await duplicateNodeWithPosition1(node, newPosition);
                  if (newNodeId) {
                    groupUndoSnapshot[newNodeId] = { id: newNodeId, isNew: true };
                  }
                }
              })
            );

            console.log("Control-D group undo snapshot:", groupUndoSnapshot);
            if (Object.keys(groupUndoSnapshot).length > 0) {
              pushSelectionToUndoStack(groupUndoSnapshot);
            }
          }
        })();
      }

      if (e.key.toLowerCase() === "f") {
        if (selectedNodes.length === 0) return;
        const selected = nodes.filter((n) => selectedNodes.includes(n.id));
        if (!selected.length) return;
  
        // Compute the bounding box for all selected nodes.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selected.forEach((node) => {
          const width = node.width || DEFAULT_WIDTH;
          const height = node.height || DEFAULT_HEIGHT;
          minX = Math.min(minX, node.x);
          minY = Math.min(minY, node.y);
          maxX = Math.max(maxX, node.x + width);
          maxY = Math.max(maxY, node.y + height);
        });
  
        // Center of the bounding box in world coordinates.
        const targetCenterWorld = { 
          x: (minX + maxX) / 2, 
          y: (minY + maxY) / 2 
        };
  
        // Get the outer container dimensions.
        const outerRect = outerRef.current.getBoundingClientRect();
        // Adjust canvas area: subtract sidebar and top bar dimensions.
        const sidebarWidth = -125;
        const topBarHeight = 50;
        const canvasWidth = outerRect.width - sidebarWidth;
        const canvasHeight = outerRect.height - topBarHeight;
  
        // For focusing, we want to fill ~80% of the available canvas area.
        const marginFactor = 0.6;
        const boxWidth = maxX - minX;
        const boxHeight = maxY - minY;
        const zoomX = (canvasWidth * marginFactor) / boxWidth;
        const zoomY = (canvasHeight * marginFactor) / boxHeight;
        const newZoom = Math.min(zoomX, zoomY, MAX_ZOOM);
  
        // Compute the canvas center in screen coordinates.
        // (Note that the canvas area starts at x = sidebarWidth, y = topBarHeight)
        const canvasCenterScreen = {
          x: sidebarWidth + canvasWidth / 2,
          y: topBarHeight + canvasHeight / 2,
        };
  
        // For the world coordinate targetCenterWorld to appear at canvasCenterScreen,
        // the new pan offset needs to be:
        const newPan = {
          x: canvasCenterScreen.x - targetCenterWorld.x * newZoom,
          y: canvasCenterScreen.y - targetCenterWorld.y * newZoom,
        };
  
        // Update zoom and pan state and refs.
        setZoom(newZoom);
        zoomRef.current = newZoom;
        setPan(newPan);
        panRef.current = newPan;
      }
    


      if (
        !editingNodeId &&
        selectedNodes.length > 0 &&
        (e.key === "Backspace" || e.key === "Delete")
      ) {
        e.preventDefault();
        if (window.confirm("Are you sure you want to delete the selected nodes?")) {
          // Push snapshot for undo before deletion
          pushSelectionToUndoStack();
      
          // Use an asynchronous function to allow await
          (async () => {
            const batch = writeBatch(db);
      
            // Delete nodes and queue deletion of related links
            for (const id of selectedNodes) {
              // Delete the node document.
              const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
              batch.delete(nodeRef);
      
              // Query outgoing links (node is source)
              const outgoingQuery = query(
                collection(db, "mindMaps", mindMapId, "links"),
                where("source", "==", id)
              );
              const outgoingSnapshot = await getDocs(outgoingQuery);
              outgoingSnapshot.docs.forEach((docSnap) => {
                const linkRef = doc(db, "mindMaps", mindMapId, "links", docSnap.id);
                batch.delete(linkRef);
              });
      
              // Query incoming links (node is target)
              const incomingQuery = query(
                collection(db, "mindMaps", mindMapId, "links"),
                where("target", "==", id)
              );
              const incomingSnapshot = await getDocs(incomingQuery);
              incomingSnapshot.docs.forEach((docSnap) => {
                const linkRef = doc(db, "mindMaps", mindMapId, "links", docSnap.id);
                batch.delete(linkRef);
              });
            }
      
            // Commit the batch.
            try {
              await batch.commit();
              console.log("Batch deletion (nodes and links) successful");
            } catch (error) {
              console.error("Error deleting nodes and links:", error);
            }
      
            // Update local state: Remove deleted nodes.
            setNodes((prev) => prev.filter((n) => !selectedNodes.includes(n.id)));
            setSelectedNodes([]);
          })();
        }
      }

      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        console.log("undo");
        e.preventDefault();
        handleUndoSelection();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedoSelection();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [nodes, selectedNodes, selectionUndoStack, selectionRedoStack, showHotkeyHelp, navigateSearch, zoomToFitAll, handleZoomIn, handleZoomOut, handleReset, selectAllNodes, addConnectedNode, handleDoubleClick, autoLayout, toggleLinkingMode]);

  // For mouse down (start selection):
  // Mouse handlers attached to the outer container:
  const rectsIntersect = (rect1, rect2) => {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  };

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

  const duplicateNodeWithPosition1 = async (node, newPosition) => {
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
        await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
          ...linkData,
          source: newNodeId,
        });
      }

      // Duplicate incoming links.
      const incomingQuery = query(
        collection(db, "mindMaps", mindMapId, "links"),
        where("target", "==", originalNodeId)
      );
      const incomingSnapshot = await getDocs(incomingQuery);
      for (const docSnap of incomingSnapshot.docs) {
        const linkData = docSnap.data();
        await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
          ...linkData,
          target: newNodeId,
        });
      }
    } catch (error) {
      console.error("Error duplicating node and links:", error);
      return null;
    }
    // Return the new node's id for undo purposes.
    return newNodeId;
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



 
  const handleCopy = async (e) => {
    if (editingNodeId) return;
    // Get the selected nodes data
    if (selectedNodes.length > 0) {
      const nodesToCopy = nodes.filter((n) => selectedNodes.includes(n.id));
      const jsonData = JSON.stringify(nodesToCopy);
      // If the event has clipboardData (for instance, from a key event)
      if (e.clipboardData) {
        e.clipboardData.setData("application/json", jsonData);
        e.clipboardData.setData("text/plain", jsonData);
        e.preventDefault();
        console.log("Copied nodes to clipboard:", nodesToCopy);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        // Use navigator.clipboard.writeText if clipboardData is not available
        try {
          await navigator.clipboard.writeText(jsonData);
          console.log("Copied nodes to clipboard via navigator.clipboard:", nodesToCopy);
        } catch (err) {
          console.error("Failed to copy nodes:", err);
        }
      } else {
        console.error("Clipboard API not available.");
      }
    }
  };
  
   useEffect(() => {
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [selectedNodes, nodes]);

  //useEffect(() => {
  const handlePaste = async () => {
    if (editingNodeId) return;
    try {
      closeContextMenu();
      let groupUndoSnapshot = {}; // Prepare an undo snapshot for pasted nodes
      let nodesData = null;
      let imageHandled = false;

      // If Clipboard API supports reading items
      if (navigator.clipboard.read) {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          for (const type of item.types) {
            if (type.startsWith("image/")) {
              imageHandled = true;
              const blob = await item.getType(type);
              try {
                const timestamp = Date.now();
                const fileName = blob.name || "pastedImage.png";
                const imagePath = `images/${timestamp}_${fileName}`;
                const storageReference = storageRef(storage, imagePath);
                await uploadBytes(storageReference, blob);
                const downloadURL = await getDownloadURL(storageReference);

                // Use current local cursor position for drop coordinates.
                const dropX = localCursor.x;
                const dropY = localCursor.y;

                // Create the image node.
                const docRef = await addDoc(
                  collection(db, "mindMaps", mindMapId, "nodes"),
                  {
                    type: "image",
                    imageUrl: downloadURL,
                    storagePath: imagePath,
                    x: dropX - (60 / zoomRef.current * 0.5),
                    y: dropY - (DEFAULT_HEIGHT / zoomRef.current * 0.5),
                    width: 60 / zoomRef.current,
                    height: DEFAULT_HEIGHT / zoomRef.current,
                    lockedBy: null,
                    typing: false,
                  }
                );
                if (docRef) {
                  groupUndoSnapshot[docRef.id] = { id: docRef.id, isNew: true };
                }
              } catch (error) {
                console.error("Error uploading pasted image:", error);
              }
              break; // Process only the first image found.
            }
          }
        }

        // If no image was handled, try to get clipboard text.
      if (!imageHandled) {
        const clipboardText = await navigator.clipboard.readText();
        const trimmedText = clipboardText.trim();
        if (trimmedText.startsWith("{") || trimmedText.startsWith("[")) {
          try {
            nodesData = JSON.parse(trimmedText);
            if (!Array.isArray(nodesData)) {
              nodesData = [nodesData];
            }
          } catch (jsonError) {
            console.error("Error parsing JSON, falling back to plain text:", jsonError);
            nodesData = null;
          }
        }
      }
      } else {
      // Fallback using readText only.
      const clipboardText = await navigator.clipboard.readText();
      try {
        nodesData = JSON.parse(clipboardText);
        if (!Array.isArray(nodesData)) {
          nodesData = [nodesData];
        }
      } catch {
        nodesData = null;
      }
      }

      // If we got nodesData from JSON, process it:
      if (nodesData) {
        // Use the local cursor as the drop point.
        const dropX = localCursor.x;
        const dropY = localCursor.y;
        if (nodesData.length === 1) {
          const node = nodesData[0];
          const nodeWidth = node.width || DEFAULT_WIDTH;
          const nodeHeight = node.height || DEFAULT_HEIGHT;
          const nodeCenterX = node.x + nodeWidth / 2;
          const nodeCenterY = node.y + nodeHeight / 2;
          // Compute offset so that node center aligns with localCursor
          const deltaX = dropX - nodeCenterX;
          const deltaY = dropY - nodeCenterY;

          // Duplicate node with the offset applied
          const newNodeId = await duplicateNodeWithPosition1(node, { x: node.x + deltaX, y: node.y + deltaY });
          if (newNodeId) {
            groupUndoSnapshot[newNodeId] = { id: newNodeId, isNew: true };
          }
        } else {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          nodesData.forEach((node) => {
            if (node.x < minX) minX = node.x;
            if (node.y < minY) minY = node.y;
            if (node.x > maxX) maxX = node.x;
            if (node.y > maxY) maxY = node.y;
          });
          // Compute the center of the copied nodes.
          const groupCenterX = (minX + maxX) / 2;
          const groupCenterY = (minY + maxY) / 2;
          // Compute offset to center the group on the cursor.
          const deltaX = dropX - groupCenterX;
          const deltaY = dropY - groupCenterY;

          const nodeIdMapping = {};
          // First, duplicate each node and store its new id.
          await Promise.all(
            nodesData.map(async (node) => {
              const newPosition = { x: node.x + deltaX, y: node.y + deltaY };
              const newId = await duplicateNodeWithPosition(node, newPosition, {}); // Pass an empty mapping for now.
              if (newId) {
                nodeIdMapping[node.id] = newId;
                groupUndoSnapshot[newId] = { id: newId, isNew: true };
              }
            })
          );
          // Now that we have the mapping, update each node's links by re-running duplicateNodeWithPosition.
          // (Alternatively, you could duplicate links in a separate batch using nodeIdMapping.)
          await Promise.all(
            nodesData.map(async (node) => {
              const newId = nodeIdMapping[node.id];
              if (!newId) return;
              // Now, duplicate outgoing links using the mapping.
              const outgoingQuery = query(
                collection(db, "mindMaps", mindMapId, "links"),
                where("source", "==", node.id)
              );
              const outgoingSnapshot = await getDocs(outgoingQuery);
              for (const docSnap of outgoingSnapshot.docs) {
                const linkData = docSnap.data();
                const newTarget = nodeIdMapping[linkData.target];
                if (newTarget) {
                  await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
                    ...linkData,
                    source: newId,
                    target: newTarget,
                  });
                }
              }
            })
          );
        }
        // Calculate bounding box for the copied nodes.
        
      } else {
      // If no nodesData, handle plain text paste as before.
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim() !== "") {
        const dropX = localCursor.x;
        const dropY = localCursor.y;
        try {
          const docRef = await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
            type: "text",
            text: clipboardText,
            x: dropX - (DEFAULT_WIDTH / zoomRef.current * 0.5),
            y: dropY - (DEFAULT_HEIGHT / zoomRef.current * 0.5),
            width: DEFAULT_WIDTH / zoomRef.current,
            height: DEFAULT_HEIGHT / zoomRef.current,
            fontSize: Math.floor(14 / zoomRef.current * 0.5),
            lockedBy: null,
            typing: false,
          });
          if (docRef) {
            groupUndoSnapshot[docRef.id] = { id: docRef.id, isNew: true };
          }
        } catch (error) {
          console.error("Error creating text node from pasted text:", error);
        }
      }
      }

      if (Object.keys(groupUndoSnapshot).length > 0) {
        pushSelectionToUndoStack(groupUndoSnapshot);
      }
    } catch (error) {
      console.error("Error handling paste via context menu:", error);
    }
  };

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [mindMapId, localCursor, panRef, zoomRef, outerRef, duplicateNodeWithPosition, pushSelectionToUndoStack]);







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

  // --- HIGHLIGHTING ---
  const isNodeHighlighted = (node) => {
    return hoveredNodeId === node.id || selectedNodes.includes(node.id);
  };

  const renderLinks = useMemo(() => {
    return links.map((link) => {
      const sourceNode = nodes.find((n) => n.id === link.source);
      const targetNode = nodes.find((n) => n.id === link.target);
      if (!sourceNode || !targetNode) return null;
      const sourceWidth = sourceNode.width || DEFAULT_WIDTH;
      const sourceHeight = sourceNode.height || DEFAULT_HEIGHT;
      const targetWidth = targetNode.width || DEFAULT_WIDTH;
      const targetHeight = targetNode.height || DEFAULT_HEIGHT;
      const x1 = sourceNode.x + sourceWidth / 2;
      const y1 = sourceNode.y + sourceHeight / 2;
      const x2 = targetNode.x + targetWidth / 2;
      const y2 = targetNode.y + targetHeight / 2;
      return (
        <line
          key={link.id}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#fff"
          strokeWidth="2"
        />
      );
    });
  }, [links, nodes]);


  // Render remote cursors from RTDB
  const renderCursors = () => {
    const now = Date.now();
    const activeThreshold = 5000; // 5 seconds
    const userColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
    
    return cursors
      .filter((cursor) => 
        cursor.uid !== currentUserUid && 
        now - cursor.lastActive < activeThreshold
      )
      .map((cursor, index) => {
        const screenX = cursor.x * zoom + pan.x;
        const screenY = cursor.y * zoom + pan.y;
        const userColor = userColors[index % userColors.length];
        const userName = cursor.email ? cursor.email.split('@')[0] : 'User';
        
        return (
          <div
            key={cursor.uid}
            style={{
              position: "absolute",
              top: screenY - 10,
              left: screenX + 10,
              transition: "top 0.2s ease, left 0.2s ease",
              pointerEvents: "none",
              zIndex: 150,
            }}
          >
            {/* Cursor pointer */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: -10,
                width: 0,
                height: 0,
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderBottom: `12px solid ${userColor}`,
                transform: 'rotate(-45deg)',
              }}
            />
            
            {/* User name label */}
            <div
              style={{
                backgroundColor: userColor,
                color: "#fff",
                padding: "3px 8px",
                borderRadius: "12px",
                fontSize: "11px",
                fontWeight: "500",
                whiteSpace: "nowrap",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                marginTop: "8px",
              }}
            >
              {userName}
            </div>
          </div>
        );
      });
  };

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
  
  const legacyVisibleNodes = useMemo(() => {
    // If outerRef is not available (e.g., on initial render) return all nodes.
    if (!outerRef.current) return nodes;
  
    const { visibleLeft, visibleTop, visibleWidth, visibleHeight } = getVisibleArea();
    // Dynamic buffer based on zoom level - smaller buffer when zoomed out
    const buffer = Math.max(50, 200 / zoom);
    
    return nodes.filter((node) => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      return (
        node.x + width >= visibleLeft - buffer &&
        node.x <= visibleLeft + visibleWidth + buffer &&
        node.y + height >= visibleTop - buffer &&
        node.y <= visibleTop + visibleHeight + buffer
      );
    });
  }, [nodes, Math.round(pan.x / 50) * 50, Math.round(pan.y / 50) * 50, Math.round(zoom * 20) / 20]); // Quantized dependencies to reduce recalculations
  
  const legacyVisibleLinks = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    return links.filter(
      (link) => visibleIds.has(link.source) || visibleIds.has(link.target)
    );
  }, [links, visibleNodes]);
  




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

      // Create a proper image URL that works with CORS
      const imageUrl = node.imageUrl.includes('firebasestorage.googleapis.com') 
        ? `/firebase-storage${node.imageUrl.split('firebasestorage.googleapis.com')[1]}`
        : node.imageUrl;

      // Fetch the image
      const response = await fetch(imageUrl);
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

  const ContextMenu = () => {
    if (!contextMenuu.visible) return null;
    if (rightClickMoved) return null;
    
    // Check if any selected nodes are image nodes
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
          // Fixed size styling (could use percentages if needed, but here fixed px works for a menu)
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
                  
                  // Download all selected image nodes
                  for (const imageNode of selectedImageNodes) {
                    await handleDownloadImage(imageNode);
                    // Add a small delay between downloads to avoid overwhelming the browser
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
      let newZoom = clamp(zoomRef.current * scale, MIN_ZOOM, MAX_ZOOM);
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
  const SearchBar = () => {
    if (!showSearch) return null;

    return (
      <div
        style={{
          position: 'fixed',
          top: '70px',
          left: '20px',
          zIndex: 1000,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          padding: '15px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          minWidth: '300px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <TextField
            placeholder="Search nodes... (Ctrl+F)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              performSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigateSearch('next');
              }
              if (e.key === 'Escape') {
                setShowSearch(false);
                setSearchQuery('');
                setSearchResults([]);
              }
            }}
            size="small"
            autoFocus
            sx={{
              flex: 1,
              '& .MuiInputBase-root': {
                color: '#fff',
                backgroundColor: '#333',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#555',
              },
              '& .MuiInputLabel-root': {
                color: '#ccc',
              },
            }}
          />
          <Button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowSearch(false);
              setSearchQuery('');
              setSearchResults([]);
            }}
            size="small"
            style={{ color: '#fff', minWidth: 'auto' }}
          >
            ✕
          </Button>
        </div>
        
        {searchResults.length > 0 && (
          <div style={{ color: '#ccc', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {currentSearchIndex + 1} of {searchResults.length} results
            </span>
            <div style={{ display: 'flex', gap: '5px' }}>
              <Button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigateSearch('prev');
                }}
                size="small"
                disabled={searchResults.length === 0}
                style={{ color: '#fff', minWidth: 'auto', padding: '2px 8px' }}
              >
                ↑
              </Button>
              <Button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigateSearch('next');
                }}
                size="small"
                disabled={searchResults.length === 0}
                style={{ color: '#fff', minWidth: 'auto', padding: '2px 8px' }}
              >
                ↓
              </Button>
            </div>
          </div>
        )}
        
        {searchQuery && searchResults.length === 0 && (
          <div style={{ color: '#999', fontSize: '12px' }}>
            No results found
          </div>
        )}
      </div>
    );
  };

  // Hotkey Help Modal
  const HotkeyHelpModal = () => {
    if (!showHotkeyHelp) return null;

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
        }}
        onClick={() => setShowHotkeyHelp(false)}
      >
        <div
          style={{
            backgroundColor: '#1e1e1e',
            color: '#fff',
            padding: '30px',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid #333',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <Typography variant="h5" style={{ color: '#fff', fontWeight: 'bold' }}>
              Keyboard Shortcuts
            </Typography>
            <Button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowHotkeyHelp(false);
              }}
              style={{ color: '#fff', minWidth: 'auto' }}
            >
              ✕
            </Button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <Typography variant="h6" style={{ color: '#4CAF50', marginBottom: '10px' }}>
                Navigation
              </Typography>
              {Object.entries(HOTKEYS)
                .filter(([key]) => ['Home', '0', '+/=', '-', 'F', 'R'].includes(key))
                .map(([key, description]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'monospace', backgroundColor: '#333', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                      {key}
                    </span>
                    <span style={{ fontSize: '14px', color: '#ccc' }}>{description}</span>
                  </div>
                ))}
              
              <Typography variant="h6" style={{ color: '#2196F3', marginTop: '20px', marginBottom: '10px' }}>
                Selection & Editing
              </Typography>
              {Object.entries(HOTKEYS)
                .filter(([key]) => ['Tab', 'Enter', 'Escape', 'Ctrl+A', 'Delete/Backspace'].includes(key))
                .map(([key, description]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'monospace', backgroundColor: '#333', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                      {key}
                    </span>
                    <span style={{ fontSize: '14px', color: '#ccc' }}>{description}</span>
                  </div>
                ))}
            </div>
            
            <div>
              <Typography variant="h6" style={{ color: '#FF9800', marginBottom: '10px' }}>
                Actions
              </Typography>
              {Object.entries(HOTKEYS)
                .filter(([key]) => ['Ctrl+D', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+C', 'Ctrl+V', 'Ctrl+L', 'Ctrl+E'].includes(key))
                .map(([key, description]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'monospace', backgroundColor: '#333', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                      {key}
                    </span>
                    <span style={{ fontSize: '14px', color: '#ccc' }}>{description}</span>
                  </div>
                ))}
              
              <Typography variant="h6" style={{ color: '#9C27B0', marginTop: '20px', marginBottom: '10px' }}>
                Search & Layout
              </Typography>
              {Object.entries(HOTKEYS)
                .filter(([key]) => ['Ctrl+F', 'F3', 'Shift+F3', 'Ctrl+Shift+A', 'Ctrl+/'].includes(key))
                .map(([key, description]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'monospace', backgroundColor: '#333', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                      {key}
                    </span>
                    <span style={{ fontSize: '14px', color: '#ccc' }}>{description}</span>
                  </div>
                ))}
            </div>
          </div>
          
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#333', borderRadius: '8px' }}>
            <Typography variant="body2" style={{ color: '#ccc', textAlign: 'center' }}>
              Press <strong>Ctrl+/</strong> anytime to toggle this help
            </Typography>
          </div>
        </div>
      </div>
    );
  };

  // Mini-map Navigation Component (Performance Optimized)
  const MiniMap = () => {
    const miniMapRef = useRef(null);
    const updateTimeoutRef = useRef(null);
    const lastUpdateRef = useRef(0);

    // Throttled bounds calculation - only recalculate when nodes actually change
    const bounds = useMemo(() => {
      if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 200, maxY: 150 };
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      // Use a more efficient loop
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const width = node.width || DEFAULT_WIDTH;
        const height = node.height || DEFAULT_HEIGHT;
        const nodeMaxX = node.x + width;
        const nodeMaxY = node.y + height;
        
        if (node.x < minX) minX = node.x;
        if (node.y < minY) minY = node.y;
        if (nodeMaxX > maxX) maxX = nodeMaxX;
        if (nodeMaxY > maxY) maxY = nodeMaxY;
      }
      
      // Add padding
      const padding = 50;
      return {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding
      };
    }, [nodes.length, nodes.map(n => `${n.x},${n.y},${n.width || DEFAULT_WIDTH},${n.height || DEFAULT_HEIGHT}`).join('|')]);

    // Memoized scale calculation
    const miniMapScale = useMemo(() => {
      const mapWidth = 200;
      const mapHeight = 150;
      const worldWidth = bounds.maxX - bounds.minX;
      const worldHeight = bounds.maxY - bounds.minY;
      
      return Math.min(mapWidth / worldWidth, mapHeight / worldHeight);
    }, [bounds]);

    // Optimized click handler with proper event handling
    const handleMiniMapClick = useCallback((e) => {
      // Don't handle if clicking on header or close button
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      const now = Date.now();
      if (now - lastUpdateRef.current < 100) return; // Debounce rapid clicks
      lastUpdateRef.current = now;
      
      const rect = miniMapRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top - 20; // Account for header
      
      // Only handle clicks in the map area (not header)
      if (clickY < 0) return;
      
      // Visual feedback - briefly highlight the click area
      const miniMapElement = miniMapRef.current;
      if (miniMapElement) {
        miniMapElement.style.transform = 'scale(0.98)';
        setTimeout(() => {
          if (miniMapElement) {
            miniMapElement.style.transform = 'scale(1)';
          }
        }, 100);
      }
      
      // Convert click position to world coordinates
      const worldX = bounds.minX + (clickX / miniMapScale);
      const worldY = bounds.minY + (clickY / miniMapScale);
      
      // Center the main view on this position
      const outerRect = outerRef.current.getBoundingClientRect();
      const sidebarWidth = 250;
      const topBarHeight = 50;
      const canvasWidth = outerRect.width - sidebarWidth;
      const canvasHeight = outerRect.height - topBarHeight;
      
      const newPan = {
        x: (canvasWidth / 2) - worldX * zoom,
        y: (canvasHeight / 2) - worldY * zoom,
      };
      
      setPan(newPan);
      panRef.current = newPan;
    }, [bounds, miniMapScale, zoom]);

    // Throttled viewport calculation - only update when pan/zoom actually changes
    const viewportRect = useMemo(() => {
      const outerRect = outerRef.current?.getBoundingClientRect();
      if (!outerRect) return { x: 0, y: 0, width: 0, height: 0 };
      
      const sidebarWidth = 250;
      const topBarHeight = 50;
      const canvasWidth = outerRect.width - sidebarWidth;
      const canvasHeight = outerRect.height - topBarHeight;
      
      // Calculate what part of the world is visible
      const visibleMinX = (-pan.x) / zoom;
      const visibleMinY = (-pan.y) / zoom;
      const visibleMaxX = visibleMinX + canvasWidth / zoom;
      const visibleMaxY = visibleMinY + canvasHeight / zoom;
      
      // Convert to mini-map coordinates
      const x = (visibleMinX - bounds.minX) * miniMapScale;
      const y = (visibleMinY - bounds.minY) * miniMapScale;
      const width = (visibleMaxX - visibleMinX) * miniMapScale;
      const height = (visibleMaxY - visibleMinY) * miniMapScale;
      
      return { x, y, width, height };
    }, [
      Math.round(pan.x / 10) * 10, // Round to reduce unnecessary updates
      Math.round(pan.y / 10) * 10,
      Math.round(zoom * 100) / 100, // Round zoom to 2 decimal places
      bounds, 
      miniMapScale
    ]);

    // Optimized rendering data - show all nodes but with performance optimizations
    const nodeRenderData = useMemo(() => {
      return nodes.map(node => ({
        id: node.id,
        x: (node.x - bounds.minX) * miniMapScale,
        y: (node.y - bounds.minY) * miniMapScale,
        width: Math.max(1, ((node.width || DEFAULT_WIDTH) * miniMapScale)),
        height: Math.max(1, ((node.height || DEFAULT_HEIGHT) * miniMapScale)),
        bgColor: node.bgColor || '#666',
        isSelected: selectedNodes.includes(node.id),
        zIndex: node.zIndex || 1
      })).filter(node => 
        // Only include nodes that are at least partially visible in mini-map
        node.x > -node.width && node.y > -node.height && 
        node.x < 200 + node.width && node.y < 130 + node.height
      );
    }, [nodes, bounds, miniMapScale, selectedNodes]);

    // Optimized link rendering - show all links but with culling
    const linkRenderData = useMemo(() => {
      if (links.length > 300) return []; // Skip links for very large datasets
      
      return links.map(link => {
        const sourceNode = nodes.find(n => n.id === link.source);
        const targetNode = nodes.find(n => n.id === link.target);
        if (!sourceNode || !targetNode) return null;
        
        const x1 = (sourceNode.x - bounds.minX) * miniMapScale + ((sourceNode.width || DEFAULT_WIDTH) * miniMapScale) / 2;
        const y1 = (sourceNode.y - bounds.minY) * miniMapScale + ((sourceNode.height || DEFAULT_HEIGHT) * miniMapScale) / 2;
        const x2 = (targetNode.x - bounds.minX) * miniMapScale + ((targetNode.width || DEFAULT_WIDTH) * miniMapScale) / 2;
        const y2 = (targetNode.y - bounds.minY) * miniMapScale + ((targetNode.height || DEFAULT_HEIGHT) * miniMapScale) / 2;
        
        // Skip if completely outside bounds
        if ((x1 < 0 && x2 < 0) || (x1 > 200 && x2 > 200) || (y1 < 0 && y2 < 0) || (y1 > 130 && y2 > 130)) {
          return null;
        }
        
        return {
          id: link.id,
          x1: Math.max(0, Math.min(200, x1)),
          y1: Math.max(0, Math.min(130, y1)),
          x2: Math.max(0, Math.min(200, x2)),
          y2: Math.max(0, Math.min(130, y2))
        };
      }).filter(Boolean);
    }, [links, nodes, bounds, miniMapScale]);

    if (!showMiniMap || nodes.length === 0) return null;

    return (
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: isMobile ? '20px' : '280px',
          width: '200px',
          height: '150px',
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          border: '2px solid #444',
          borderRadius: '8px',
          overflow: 'hidden',
          zIndex: 1000,
          cursor: 'pointer',
          transition: 'transform 0.1s ease-out, box-shadow 0.1s ease-out',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
        onMouseDown={handleMiniMapClick}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        }}
        ref={miniMapRef}
      >
        {/* Header */}
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '20px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            fontSize: '10px',
            color: '#ccc',
            zIndex: 1001,
            cursor: 'default',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <span>
            Mini Map ({nodeRenderData.length} nodes)
          </span>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              setShowMiniMap(false);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#ccc',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 4px',
              borderRadius: '2px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Mini-map content */}
        <svg
          width="200"
          height="150"
          style={{ 
            position: 'absolute', 
            top: '20px',
            cursor: 'pointer',
            pointerEvents: 'auto'
          }}
          onMouseDown={(e) => {
            // Let the parent handle the click for navigation
            e.stopPropagation();
            handleMiniMapClick(e);
          }}
        >
          {/* Render all visible nodes efficiently */}
          {nodeRenderData
            .sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1)) // Sort by z-index, lowest first
            .map((node) => (
            <rect
              key={node.id}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              fill={node.isSelected ? '#4CAF50' : node.bgColor}
              stroke={node.isSelected ? '#8BC34A' : 'none'}
              strokeWidth={node.isSelected ? "0.5" : "0"}
              opacity="0.8"
            />
          ))}
          
          {/* Render all visible links efficiently */}
          {linkRenderData.map(link => (
            <line
              key={link.id}
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
              stroke="#555"
              strokeWidth="0.5"
              opacity="0.4"
            />
          ))}
          
          {/* Viewport rectangle */}
          <rect
            x={Math.max(0, Math.min(200, viewportRect.x))}
            y={Math.max(0, Math.min(130, viewportRect.y))}
            width={Math.max(0, Math.min(200 - Math.max(0, viewportRect.x), viewportRect.width))}
            height={Math.max(0, Math.min(130 - Math.max(0, viewportRect.y), viewportRect.height))}
            fill="none"
            stroke="#4CAF50"
            strokeWidth="1"
            strokeDasharray="2,2"
            opacity="0.8"
          />
        </svg>
      </div>
    );
  };

  // Performance-aware mini-map toggle
  const MiniMapToggle = () => {
    // Auto-hide mini-map for very large datasets to preserve performance
    const shouldAutoHide = nodes.length > 1000;
    
    if (showMiniMap || nodes.length === 0) return null;

    return (
      <Button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowMiniMap(true);
        }}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: isMobile ? '20px' : '280px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: '#fff',
          minWidth: 'auto',
          padding: '8px',
          borderRadius: '4px',
          zIndex: 1000,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
        title={shouldAutoHide ? "Show Mini Map (Large dataset - may impact performance)" : "Show Mini Map"}
      >
        🗺️ {shouldAutoHide && <span style={{fontSize: '10px'}}>⚠️</span>}
      </Button>
    );
  };

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
      const nodeIsSelected = selectedNodes.includes(node.id);
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
          const widthScale = newWidth / initialNode.width;
          const heightScale = newHeight / initialNode.height;
          const averageScale = (widthScale + heightScale) / 2;
          const newFontSize = Math.max(8, Math.round(initialNode.fontSize * averageScale)); // Minimum 8px font
          
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
          style={{ pointerEvents: "auto" }}
        />
        <div
          className="resize-handle unified ne"
          onMouseDown={(e) => handleUnifiedResize('ne', e)}
          style={{ pointerEvents: "auto" }}
        />
        <div
          className="resize-handle unified sw"
          onMouseDown={(e) => handleUnifiedResize('sw', e)}
          style={{ pointerEvents: "auto" }}
        />
        <div
          className="resize-handle unified se"
          onMouseDown={(e) => handleUnifiedResize('se', e)}
          style={{ pointerEvents: "auto" }}
        />
        
        {/* Side handles */}
        <div
          className="resize-handle unified n"
          onMouseDown={(e) => handleUnifiedResize('n', e)}
          style={{ pointerEvents: "auto" }}
        />
        <div
          className="resize-handle unified s"
          onMouseDown={(e) => handleUnifiedResize('s', e)}
          style={{ pointerEvents: "auto" }}
        />
        <div
          className="resize-handle unified w"
          onMouseDown={(e) => handleUnifiedResize('w', e)}
          style={{ pointerEvents: "auto" }}
        />
        <div
          className="resize-handle unified e"
          onMouseDown={(e) => handleUnifiedResize('e', e)}
          style={{ pointerEvents: "auto" }}
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
  const createLink = useCallback(async (source, target) => {
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
  const deleteLink = useCallback(async (linkId) => {
    try {
      await deleteDoc(doc(db, "mindMaps", mindMapId, "links", linkId));
      // The optimized state will be updated by Firebase subscription
      return true;
    } catch (error) {
      console.error("Error deleting link:", error);
      return false;
    }
  }, [mindMapId]);

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
        position: "relative"
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
          doubleClickAddNode();
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
      {renderCursors()}
      {/* Top Toolbar */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "50px",
          backgroundColor: "rgba(29,32,34,0.9)", // Softer, semi-transparent dark background
          background: "radial-gradient(circle at center, rgba(29,32,34,.4) 0%, rgba(15,16,17,.7) 100%)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.4)",
          zIndex: 300
        }}
      >
        <Button
          variant="contained"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigate(`/dashboard`);
          }}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          <ArrowBackIosIcon />
        </Button>
        <Button
          variant="contained"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleAddNode();
          }}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          Add Node
        </Button>
        <Button
          variant="contained"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setLinkingMode((prev) => !prev);
            setLinkingSource(null);
          }}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          {linkingMode ? "Exit Linking Mode" : "Link Nodes"}
        </Button>
        <Button
          variant="contained"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleExport();
          }}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          Export
        </Button>
        <Button
          variant="contained"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleZoomIn();
          }}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          Zoom In
        </Button>
        <Button 
          variant="contained" 
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleZoomOut();
          }}
          style={{background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)"}}
        >
          Zoom Out
        </Button>
        <Button
          variant="contained"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowHotkeyHelp(true);
          }}
          style={{ marginLeft: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
          title="Keyboard Shortcuts (Ctrl+/)"
        >
          ⌨️ Help
        </Button>
        {linkingMode && (
          <Typography variant="body2" style={{ color: "#fff", marginLeft: "10px" }}>
            {linkingSource ? "Select target node..." : "Select source node..."}
          </Typography>
        )}
      </div>
  
      {/* Right Sidebar */}
      {!isMobile && (
        <div
          style={{
            position: "fixed",
            top: 60,
            right: 10,
            width: "250px",
            height: "calc(100% - 60px)",
            boxShadow: "0 2px 10px rgba(39, 39, 39, 0.6)",
            background: "radial-gradient(circle at center, #1D2022 0%, #0f1011 110%)",
            padding: "20px",
            boxSizing: "border-box",
            zIndex: 300,
            overflowY: "auto",
            borderRadius: "8px",
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {activeCustomizationNode ? (
            <>
              {/* Title */}
              <div
                style={{
                  marginBottom: "24px",
                  textAlign: "center",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                  paddingBottom: "16px",
                }}
              >
              <Typography
                variant="h6"
                style={{
                    color: "#ffffff",
                    fontWeight: "600",
                    fontSize: "18px",
                    letterSpacing: "0.5px",
                    textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
                }}
              >
                  Node Customization
              </Typography>
                <Typography
                  variant="caption"
                  style={{
                    color: "rgba(255, 255, 255, 0.6)",
                    fontSize: "12px",
                    display: "block",
                    marginTop: "4px",
                  }}
                >
                  {selectedNodes.length} node{selectedNodes.length !== 1 ? 's' : ''} selected
                </Typography>
              </div>

              {/* Font Section */}
              <div style={{ marginBottom: "20px" }}>
              <Typography
                variant="subtitle1"
                style={{
                    marginBottom: "12px",
                    color: "rgba(255, 255, 255, 0.9)",
                    fontWeight: "500",
                    fontSize: "14px",
                    letterSpacing: "0.3px",
                    textTransform: "uppercase",
                    borderLeft: "3px solid rgba(255, 255, 255, 0.3)",
                    paddingLeft: "12px",
                }}
              >
                  Typography
              </Typography>

              {/* Font Selector */}
              <FormControl
                variant="filled"
                size="small"
                  sx={{ 
                    minWidth: "100%",
                    marginBottom: "16px",
                    "& .MuiFilledInput-root": {
                      backgroundColor: "rgba(43, 43, 43, 0.8)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "8px",
                      "&:hover": {
                        backgroundColor: "rgba(43, 43, 43, 0.9)",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                      },
                      "&.Mui-focused": {
                        backgroundColor: "rgba(43, 43, 43, 1)",
                        borderColor: "rgba(255, 255, 255, 0.3)",
                      }
                    },
                    "& .MuiInputLabel-root": {
                      color: "rgba(255, 255, 255, 0.7)",
                      fontSize: "13px",
                    },
                    "& .MuiSelect-select": {
                      color: "#fff",
                      fontSize: "14px",
                    }
                  }}
                >
                  <InputLabel>Font Family</InputLabel>
                <Select
                  value={tempFontFamily}
                  onChange={(e) => setTempFontFamily(e.target.value)}
                >
                  <MenuItem value="cursive">Cursive</MenuItem>
                  <MenuItem value="Microsoft Yahei">Microsoft Yahei</MenuItem>
                  <MenuItem value="Arial">Arial</MenuItem>
                  <MenuItem value="Times New Roman">Times New Roman</MenuItem>
                  <MenuItem value="Courier New">Courier New</MenuItem>
                </Select>
              </FormControl>

                {/* Font Size */}
              <Typography
                  variant="body2"
                style={{
                    marginBottom: "8px",
                    color: "rgba(255, 255, 255, 0.8)",
                    fontSize: "13px",
                    fontWeight: "500",
                }}
              >
                  Font Size
              </Typography>

              {/* Font Size Autocomplete */}
              <Autocomplete
                freeSolo
                options={presetSizes}
                getOptionLabel={(option) => option.toString()}
                value={tempFontSize}
                onChange={(e, newValue) => {
                  let parsed;
                  if (typeof newValue === "number") {
                    parsed = newValue;
                  } else if (typeof newValue === "string" && newValue.trim() !== "") {
                    parsed = parseInt(newValue, 10);
                  }
                  if (!isNaN(parsed)) {
                    setTempFontSize(parsed);
                  }
                }}
                onInputChange={(e, newInputValue) => {
                  const parsed = parseInt(newInputValue, 10);
                  if (!isNaN(parsed)) {
                    setTempFontSize(parsed);
                  }
                }}
                sx={{
                  width: "100%",
                    marginBottom: "16px",
                  "& .MuiInputBase-root": {
                    color: "#fff",
                  },
                  "& .MuiFilledInput-root": {
                      backgroundColor: "rgba(43, 43, 43, 0.8)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "8px",
                      "&:hover": {
                        backgroundColor: "rgba(43, 43, 43, 0.9)",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                  },
                      "&.Mui-focused": {
                        backgroundColor: "rgba(43, 43, 43, 1)",
                        borderColor: "rgba(255, 255, 255, 0.3)",
                      }
                    },
                    "& .MuiInputLabel-root": {
                      color: "rgba(255, 255, 255, 0.7)",
                      fontSize: "13px",
                    },
                    "& .MuiAutocomplete-popupIndicator": { 
                      color: "rgba(255, 255, 255, 0.6)",
                    },
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Font Size"
                    variant="filled"
                  />
                )}
              />

              {/* Text Style + Alignment Toggles */}
                <div style={{ marginBottom: "16px" }}>
                  <Typography
                    variant="body2"
                    style={{
                      marginBottom: "8px",
                      color: "rgba(255, 255, 255, 0.8)",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    Text Style
                  </Typography>
                  <Stack direction="column" spacing={2} sx={{ alignItems: "center" }}>
                <ToggleButtonGroup
                  color="primary"
                  value={tempTextStyle}
                  onChange={(e, newStyles) => setTempTextStyle(newStyles)}
                      sx={{
                        backgroundColor: "rgba(43, 43, 43, 0.8)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "8px",
                        "& .MuiToggleButton-root": {
                          color: "rgba(255, 255, 255, 0.7)",
                          border: "none",
                          "&:hover": {
                            backgroundColor: "rgba(255, 255, 255, 0.1)",
                          },
                          "&.Mui-selected": {
                            backgroundColor: "rgba(255, 255, 255, 0.2)",
                            color: "#fff",
                          }
                        }
                  }}
                  aria-label="text style"
                  size="small"
                >
                  <ToggleButton value="bold" aria-label="bold">
                    <FormatBoldIcon />
                  </ToggleButton>
                  <ToggleButton value="italic" aria-label="italic">
                    <FormatItalicIcon />
                  </ToggleButton>
                  <ToggleButton value="underline" aria-label="underline">
                    <FormatUnderlinedIcon />
                  </ToggleButton>
                </ToggleButtonGroup>

                <ToggleButtonGroup
                  value={tempTextAlign}
                  color="primary"
                  exclusive
                  onChange={(e, newAlign) => {
                    if (newAlign !== null) {
                      setTempTextAlign(newAlign);
                    }
                  }}
                      sx={{
                        backgroundColor: "rgba(43, 43, 43, 0.8)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "8px",
                        "& .MuiToggleButton-root": {
                          color: "rgba(255, 255, 255, 0.7)",
                          border: "none",
                          "&:hover": {
                            backgroundColor: "rgba(255, 255, 255, 0.1)",
                          },
                          "&.Mui-selected": {
                            backgroundColor: "rgba(255, 255, 255, 0.2)",
                            color: "#fff",
                          }
                        }
                  }}
                  aria-label="text alignment"
                  size="small"
                >
                  <ToggleButton value="left" aria-label="left">
                    <FormatAlignLeftIcon />
                  </ToggleButton>
                  <ToggleButton value="center" aria-label="center">
                    <FormatAlignCenterIcon />
                  </ToggleButton>
                  <ToggleButton value="right" aria-label="right">
                    <FormatAlignRightIcon />
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
                </div>
              </div>

              {/* Colors Section */}
              <div style={{ marginBottom: "20px" }}>
                <Typography
                variant="subtitle1"
                  style={{
                    marginBottom: "16px",
                    color: "rgba(255, 255, 255, 0.9)",
                    fontWeight: "500",
                    fontSize: "14px",
                    letterSpacing: "0.3px",
                    textTransform: "uppercase",
                    borderLeft: "3px solid rgba(255, 255, 255, 0.3)",
                    paddingLeft: "12px",
                  }}
                >
                  Colors
                </Typography>
                <div
                  data-color-picker="bg"
                  style={{
                    position: "relative",
                    marginTop: "8px",
                  }}
                >
                  <div
                    onClick={() => setShowBgColorPicker(!showBgColorPicker)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px",
                      backgroundColor: "#2b2b2b",
                      borderRadius: "8px",
                      border: "1px solid #444",
                    cursor: "pointer",
                      transition: "all 0.2s ease",
                      "&:hover": {
                        borderColor: "#666",
                      }
                    }}
                    onMouseEnter={(e) => e.target.style.borderColor = "#666"}
                    onMouseLeave={(e) => e.target.style.borderColor = "#444"}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        backgroundColor: tempBgColor,
                        borderRadius: "8px",
                        border: "2px solid #555",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: `linear-gradient(45deg, 
                            transparent 25%, 
                            rgba(255,255,255,0.1) 25%, 
                            rgba(255,255,255,0.1) 50%, 
                            transparent 50%, 
                            transparent 75%, 
                            rgba(255,255,255,0.1) 75%)`,
                          backgroundSize: "8px 8px",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "14px",
                          color: "#fff",
                          fontWeight: "500",
                        }}
                      >
                        Background
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#999",
                          fontFamily: "monospace",
                        }}
                      >
                        {tempBgColor.toUpperCase()}
                      </span>
                    </div>
                    <PaletteIcon style={{ color: "#666", fontSize: "20px" }} />
                  </div>
                  
                  {showBgColorPicker && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        zIndex: 1000,
                        marginTop: "8px",
                        borderRadius: "8px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                        border: "1px solid #444",
                        overflow: "hidden",
                      }}
                    >
                      <ChromePicker
                        color={tempBgColor}
                        onChange={(color) => setTempBgColor(color.hex)}
                        disableAlpha={true}
                        styles={{
                          default: {
                            picker: {
                              backgroundColor: "#1e1e1e",
                              border: "none",
                              borderRadius: "8px",
                              boxShadow: "none",
                              fontFamily: "Arial, sans-serif",
                            },
                            saturation: {
                              borderRadius: "4px",
                            },
                            hue: {
                              borderRadius: "4px",
                            },
                            input: {
                              backgroundColor: "#2b2b2b",
                              border: "1px solid #444",
                              borderRadius: "4px",
                              color: "#fff",
                              fontSize: "12px",
                            },
                            label: {
                  color: "#ccc",
                              fontSize: "11px",
                            },
                          },
                        }}
                      />
                      <div
                        style={{
                          padding: "8px",
                          backgroundColor: "#1e1e1e",
                          borderTop: "1px solid #333",
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                      >
                        <Button
                          size="small"
                          onClick={() => setShowBgColorPicker(false)}
                  style={{
                            color: "#fff",
                            backgroundColor: "#333",
                            fontSize: "11px",
                            minWidth: "auto",
                            padding: "4px 12px",
                          }}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Font Color */}
                <div
                  data-color-picker="text"
                  style={{
                    position: "relative",
                    marginTop: "8px",
                  }}
                >
                  <div
                    onClick={() => setShowTextColorPicker(!showTextColorPicker)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px",
                      backgroundColor: "#2b2b2b",
                      borderRadius: "8px",
                      border: "1px solid #444",
                    cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => e.target.style.borderColor = "#666"}
                    onMouseLeave={(e) => e.target.style.borderColor = "#444"}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        backgroundColor: tempTextColor,
                        borderRadius: "8px",
                        border: "2px solid #555",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        fontWeight: "bold",
                        color: tempBgColor,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: `linear-gradient(45deg, 
                            transparent 25%, 
                            rgba(255,255,255,0.1) 25%, 
                            rgba(255,255,255,0.1) 50%, 
                            transparent 50%, 
                            transparent 75%, 
                            rgba(255,255,255,0.1) 75%)`,
                          backgroundSize: "8px 8px",
                        }}
                      />
                      <span style={{ position: "relative", zIndex: 1 }}>Aa</span>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "14px",
                          color: "#fff",
                          fontWeight: "500",
                        }}
                      >
                        Font Color
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#999",
                          fontFamily: "monospace",
                        }}
                      >
                        {tempTextColor.toUpperCase()}
                      </span>
                    </div>
                    <PaletteIcon style={{ color: "#666", fontSize: "20px" }} />
                  </div>
                  
                  {showTextColorPicker && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        zIndex: 1000,
                        marginTop: "8px",
                        borderRadius: "8px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                        border: "1px solid #444",
                        overflow: "hidden",
                      }}
                    >
                      <ChromePicker
                        color={tempTextColor}
                        onChange={(color) => setTempTextColor(color.hex)}
                        disableAlpha={true}
                        styles={{
                          default: {
                            picker: {
                              backgroundColor: "#1e1e1e",
                              border: "none",
                              borderRadius: "8px",
                              boxShadow: "none",
                              fontFamily: "Arial, sans-serif",
                            },
                            saturation: {
                              borderRadius: "4px",
                            },
                            hue: {
                              borderRadius: "4px",
                            },
                            input: {
                              backgroundColor: "#2b2b2b",
                              border: "1px solid #444",
                              borderRadius: "4px",
                              color: "#fff",
                              fontSize: "12px",
                            },
                            label: {
                  color: "#ccc",
                              fontSize: "11px",
                            },
                          },
                        }}
                      />
                      <div
                        style={{
                          padding: "8px",
                          backgroundColor: "#1e1e1e",
                          borderTop: "1px solid #333",
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                      >
                        <Button
                          size="small"
                          onClick={() => setShowTextColorPicker(false)}
                          style={{
                            color: "#fff",
                            backgroundColor: "#333",
                            fontSize: "11px",
                            minWidth: "auto",
                            padding: "4px 12px",
                }}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Layer Controls Section */}
              <div style={{ marginBottom: "20px" }}>
                <Typography
                variant="subtitle1"
                  style={{
                    marginBottom: "12px",
                    color: "rgba(255, 255, 255, 0.9)",
                    fontWeight: "500",
                    fontSize: "14px",
                    letterSpacing: "0.3px",
                    textTransform: "uppercase",
                    borderLeft: "3px solid rgba(255, 255, 255, 0.3)",
                    paddingLeft: "12px",
                  }}
              >
                  Layer Order
                </Typography>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                  <TextField
                    type="number"
                    value={tempZIndex}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 1;
                      setTempZIndex(value);
                      handleZIndexChange(value);
                    }}
                    size="small"
                    sx={{
                      flex: 1,
                      "& .MuiInputBase-root": {
                        color: "#fff",
                        backgroundColor: "rgba(43, 43, 43, 0.8)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "8px",
                      },
                      "& .MuiOutlinedInput-notchedOutline": {
                        border: "none",
                      },
                      "& .MuiInputBase-root:hover": {
                        backgroundColor: "rgba(43, 43, 43, 0.9)",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                      },
                      "& .MuiInputBase-root.Mui-focused": {
                        backgroundColor: "rgba(43, 43, 43, 1)",
                        borderColor: "rgba(255, 255, 255, 0.3)",
                      }
                    }}
                    inputProps={{ min: 0, max: 9999 }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleBringToFront}
                    sx={{
                      backgroundColor: "rgba(43, 43, 43, 0.8)",
                      color: "rgba(255, 255, 255, 0.8)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "8px",
                      minWidth: "auto",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      "&:hover": {
                        backgroundColor: "rgba(43, 43, 43, 0.9)",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                      }
                    }}
                    title="Bring to Front"
                  >
                    Front
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleSendToBack}
                    sx={{
                      backgroundColor: "rgba(43, 43, 43, 0.8)",
                      color: "rgba(255, 255, 255, 0.8)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "8px",
                      minWidth: "auto",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      "&:hover": {
                        backgroundColor: "rgba(43, 43, 43, 0.9)",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                      }
                    }}
                    title="Send to Back"
                  >
                    Back
                  </Button>
                </div>
              </div>

              {/* Actions Section */}
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
              <Button
                variant="contained"
                onClick={handleRemoveLinks}
                  sx={{
                  width: "100%",
                    backgroundColor: "rgba(170, 17, 17, 0.8)",
                    color: "#fff",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    padding: "12px",
                    fontSize: "13px",
                    fontWeight: "500",
                    textTransform: "none",
                    "&:hover": {
                      backgroundColor: "rgba(170, 17, 17, 0.9)",
                      borderColor: "rgba(255, 255, 255, 0.2)",
                    }
                }}
              >
                Remove All Links
              </Button>
              </div>
            </>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "rgba(255, 255, 255, 0.6)",
              }}
            >
              <Typography
                variant="h6"
                style={{
                  color: "rgba(255, 255, 255, 0.8)",
                  marginBottom: "8px",
                  fontSize: "16px",
                  fontWeight: "500",
                }}
              >
                No Selection
            </Typography>
              <Typography
                variant="body2"
                style={{
                  color: "rgba(255, 255, 255, 0.5)",
                  fontSize: "13px",
                  lineHeight: "1.5",
                }}
              >
                Select one or more nodes to customize their appearance and properties
              </Typography>
            </div>
          )}
        </div>
      )}

      {/* Enhanced Active Users Panel */}
      <div
        style={{
          position: "fixed",
          top: 60,
          right: isMobile ? 10 : 290,
          background: "radial-gradient(circle at center,rgba(29, 32, 34, 0.9) 0%, #0f1011 100%)",
          color: "#fff",
          padding: "12px",
          borderRadius: "8px",
          zIndex: 250,
          minWidth: "200px",
          maxWidth: "250px",
          border: "1px solid #333",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
        }}
      >
        <Typography variant="subtitle2" style={{ fontWeight: 'bold', marginBottom: '8px', color: '#4CAF50' }}>
          Active Users ({presenceUsers.length})
        </Typography>
        {presenceUsers.length === 0 ? (
          <Typography variant="caption" style={{ color: '#999', fontStyle: 'italic' }}>
            No other users online
          </Typography>
        ) : (
          presenceUsers.map((user, index) => {
            const isCurrentUser = user.email === currentUserEmail;
            const userColor = isCurrentUser ? '#4CAF50' : '#2196F3';
            
            return (
              <div 
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 0',
                  borderBottom: index < presenceUsers.length - 1 ? '1px solid #333' : 'none'
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: userColor,
                    animation: 'pulse 2s infinite'
                  }}
                />
                <Typography 
                  variant="caption" 
                  style={{ 
                    color: isCurrentUser ? '#4CAF50' : '#fff',
                    fontWeight: isCurrentUser ? 'bold' : 'normal'
                  }}
                >
                  {isCurrentUser ? `${user.email} (You)` : user.email}
                </Typography>
          </div>
            );
          })
        )}
        
        {/* Connection Status */}
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #333' }}>
          <Typography variant="caption" style={{ color: '#999', fontSize: '10px' }}>
            Connected • Real-time sync active
          </Typography>
        </div>
      </div>
  
      {renderCursors()}
  
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
          transformOrigin: "top left"
        }}
      >
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible"
          }}
        >
          {visibleLinks.map((link) => {
            const sourceNode = nodes.find((n) => n.id === link.source);
            const targetNode = nodes.find((n) => n.id === link.target);
            if (!sourceNode || !targetNode) return null;
            
            const sourceWidth = sourceNode.width || DEFAULT_WIDTH;
            const sourceHeight = sourceNode.height || DEFAULT_HEIGHT;
            const targetWidth = targetNode.width || DEFAULT_WIDTH;
            const targetHeight = targetNode.height || DEFAULT_HEIGHT;
            
            // Account for group delta during multi-node dragging
            const sourceIsSelected = selectedNodes.includes(sourceNode.id);
            const targetIsSelected = selectedNodes.includes(targetNode.id);
            
            const sourceX = sourceNode.x + (sourceIsSelected ? groupDelta.x : 0);
            const sourceY = sourceNode.y + (sourceIsSelected ? groupDelta.y : 0);
            const targetX = targetNode.x + (targetIsSelected ? groupDelta.x : 0);
            const targetY = targetNode.y + (targetIsSelected ? groupDelta.y : 0);
            
            const x1 = sourceX + sourceWidth / 2;
            const y1 = sourceY + sourceHeight / 2;
            const x2 = targetX + targetWidth / 2;
            const y2 = targetY + targetHeight / 2;
            
            return (
              <line
                key={link.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="rgba(255, 255, 255, 0.29)"  // Subtle connector lines
                strokeWidth="5"
              />
            );
          })}
        </svg>
        <VirtualNodeRenderer
          nodes={nodes}
          zoom={zoomRef.current}
          pan={pan}
          outerRef={outerRef}
          visibleNodes={visibleNodes}
          selectedNodes={selectedNodes}
          groupDelta={groupDelta}
          editingNodeId={editingNodeId}
          editedText={editedText}
          hoveredNodeId={hoveredNodeId}
          linkingSource={linkingSource}
          currentUserEmail={currentUserEmail}
          isNodeHighlighted={isNodeHighlighted}
          handleResizeMouseDown={isMobile ? () => {} : handleResizeMouseDown}
          handleNodeClick={isMobile ? () => {} : handleNodeClick}
          handleDoubleClick={isMobile ? () => {} : handleDoubleClick}
          handleTyping={isMobile ? () => {} : handleTyping}
          handleTextBlur={isMobile ? () => {} : handleTextBlur}
          setEditedText={isMobile ? () => {} : setEditedText}
          setHoveredNodeId={isMobile ? () => {} : setHoveredNodeId}
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
        />
        <ResizeBoundingBox />
        {selectionBox && (() => {
          const avgDimension = (selectionBox.width + selectionBox.height) / 2;
          const computedStrokeWidth = Math.max(1, avgDimension * 0.02);
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
      <ContextMenu />
      <ChatBox
        localCursor={localCursor}
        canvasCenter={getCanvasCenter()}
        mergeMindMapData={mergeMindMapDataHandler}
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
        selectedNodes={selectedNodes}
        nodes={nodes}
        setNodes={setNodes}
        mindMapId={mindMapId}
        updateNodeText={updateNodeTextBatch}
        addNode={addNodeBatch}
        addLink={addLinkBatch}
        pushToUndoStack={pushSelectionToUndoStack}
      />
      <LoadingOverlay />
      <ErrorComponent />
      <SearchBar />
      <HotkeyHelpModal />
      <MiniMap />
      <MiniMapToggle />
    </div>
  );
};  

export default MindMapEditor;