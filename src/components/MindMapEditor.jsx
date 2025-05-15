// src/components/MindMapEditor.jsx
// Global CSS: html, body { overflow: hidden; height: 100%; margin: 0; padding: 0; }
import React, { useEffect, useState, useRef, useMemo, useCallback  } from "react";
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
import { BlockPicker } from 'react-color';

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

const MindMapEditor = () => {
  const { id: mindMapId } = useParams();

  // Persistent state from Firestore
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [editedText, setEditedText] = useState("");
  const [linkingMode, setLinkingMode] = useState(false);
  const [linkingSource, setLinkingSource] = useState(null);
  const [copiedNodes, setCopiedNodes] = useState([]);
  const toggleLinkingMode = () => {
    setLinkingMode((prev) => !prev);
    setLinkingSource(null);
  };
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

  // Local hover state for highlighting
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  const [selectionUndoStack, setSelectionUndoStack] = useState([]); // Each snapshot is an object: { [nodeId]: { ...nodeState }
  const [selectionRedoStack, setSelectionRedoStack] = useState([]);

  // Ref for the canvas container (zoomable/pannable)
  const containerRef = useRef(null);
  const outerRef = useRef(null);

  const [tempBgColor, setTempBgColor] = useState("#1e1e1e");
  const [tempTextColor, setTempTextColor] = useState("#fff");
  const [tempText, setTempText] = useState("");
  const [tempWidth, setTempWidth] = useState(DEFAULT_WIDTH);
  const [tempHeight, setTempHeight] = useState(DEFAULT_HEIGHT);
  const [tempFontFamily, setTempFontFamily] = useState("cursive");
  const [tempFontSize, setTempFontSize] = useState(14);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const multiDragStartRef = useRef({});
  const [isDragging, setIsDragging] = useState(false);
  const groupDeltaRef = useRef({ x: 0, y: 0 });
  const [groupDelta, setGroupDelta] = useState({ x: 0, y: 0 });
  const isAnimatingRef = useRef(false);
  const activeCustomizationNode = selectedNodes.length
    ? nodes.find((n) => n.id === selectedNodes[0])
    : null;

  const updateGroupDelta = (delta) => {
    groupDeltaRef.current = delta;
    if (!isAnimatingRef.current) {
      isAnimatingRef.current = true;
      requestAnimationFrame(() => {
        setGroupDelta({ ...groupDeltaRef.current });
        isAnimatingRef.current = false;
      });
    }
  };

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

  const handleTextStyleChange = (event, newStyles) => {
    setTextStyle(newStyles);
  };
  // Check if we have bold, italic, underline in textStyle array
  const isBold = textStyle.includes("bold");
  const isItalic = textStyle.includes("italic");
  const isUnderline = textStyle.includes("underline");

  const presetSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
  //const [fontSize, setFontSize] = useState(14);
  const rightClickStartRef = useRef(null);
  const [rightClickMoved, setRightClickMoved] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);




  //useEffect(() => {
  //  const outer = outerRef.current;
  //  if (!outer) return;
  //  outer.addEventListener("contextmenu", handleCanvasContextMenu);
  //  return () => outer.removeEventListener("contextmenu", handleCanvasContextMenu);
  //}, []);


  const [contextMenuu, setContextMenu] = useState({ visible: false, x: 0, y: 0, type: null });
  const closeContextMenu = () => setContextMenu({ visible: false, x: 0, y: 0, type: null });
  
  // Handler for right-click on the canvas (outerRef)
  const handleCanvasContextMenu = (e) => {
    if (rightClickMoved) {
      e.preventDefault();
      //closeContextMenu();
      return;
    }
   // e.preventDefault();
    // Debug log to see if this handler is called
    //console.log("Canvas contextmenu triggered", e.target);
    // If the right-click target is not inside a node, show canvas menu
    if (selectedNodes.length) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        type: "node"
      });
      return
    };
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
  };

  const handleReset = () => {
    // Reset pan and zoom.
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    zoomRef.current = 1;
    console.log("Reset pan/zoom");
    closeContextMenu();
  };

  const processKeyInteraction = (event) => {
    console.log("Processing key interaction:", event.key);
  };



  // AUTH: subscribe to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUserEmail(user.email);
        setCurrentUserUid(user.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to nodes in Firestore
  useEffect(() => {
    if (!mindMapId) return;
    const q = query(collection(db, "mindMaps", mindMapId, "nodes"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const nodesData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setNodes(nodesData);
      // Optionally, reset undo/redo stacks when data is reloaded
      //setUndoStack([]);
      //setRedoStack([]);
    });
    return () => unsubscribe();
  }, [mindMapId]);

  // Subscribe to links in Firestore
  useEffect(() => {
    if (!mindMapId) return;
    const q = query(collection(db, "mindMaps", mindMapId, "links"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const linksData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setLinks(linksData);
    });
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
        addDoc(collection(db, "mindMaps", mindMapId, "links"), {
          source: linkingSource,
          target: node.id,
        })
          .then(() => {
            setLinkingSource(null);
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

  const handleResizeMouseDown = (node, e) => {
    if (e.button !== 0) return;
    pushSingleNodeToUndoStack(node);
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = node.width || DEFAULT_WIDTH;
    const initialHeight = node.height || DEFAULT_HEIGHT;
    let finalWidth = initialWidth;
    let finalHeight = initialHeight;
    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      finalWidth = Math.max(50, initialWidth + deltaX / zoom);
      finalHeight = Math.max(20, initialHeight + deltaY / zoom);
      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === node.id
            ? { ...n, width: finalWidth, height: finalHeight }
            : n,
        ),
      );
    };

    const onMouseUp = async () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      try {
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
        await updateDoc(nodeRef, { width: finalWidth, height: finalHeight });
      } catch (error) {
        console.error("Error updating node size:", error);
      }
    };
    document.addEventListener("mousemove", onMouseMove);
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
  const handleAddNode = async () => {
    if (!mindMapId) return;
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
      await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: centerWorldX,
        y: centerWorldY,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
      });
      
    } catch (error) {
      console.error("Error adding node:", error);
    }
  };

  const doubleClickAddNode = async () => {
    if (!mindMapId) return;
    try {
      const dropX = localCursor.x;
      const dropY = localCursor.y;
      // Convert the screen center to world coordinates using the latest pan/zoom.
      await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: dropX - DEFAULT_WIDTH/2,
        y: dropY - DEFAULT_HEIGHT/2,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
      });

    } catch (error) {
      console.error("Error adding node:", error);
    }
  };


  const handleDoubleClick = (node) => {
    if (linkingMode) return;
    if (node.type === "image") return;
    if (node.lockedBy && node.lockedBy !== currentUserEmail) {
      alert(`Node is currently locked by ${node.lockedBy}`);
      return;
    }
    const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
    updateDoc(nodeRef, { lockedBy: currentUserEmail, typing: true }).catch(
      console.error,
    );
    setEditingNodeId(node.id);
    setEditedText(node.text);
  };

  const handleTextBlur = async (nodeId) => {
    try {
      if (selectedNodes.includes(nodeId)) {
        pushSelectionToUndoStack();
      } else {
        // For a single node, you might push a snapshot for just that node.
        pushSelectionToUndoStack(); // Or you can adjust this logic if you want to handle it separately.
      }
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
      await updateDoc(nodeRef, {
        text: editedText,
        lockedBy: null,
        typing: false,
      });
      setEditingNodeId(null);
      setEditedText("");
    } catch (error) {
      console.error("Error updating node text:", error);
    }
  };

  const handleTyping = (nodeId) => {
    const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
    updateDoc(nodeRef, { typing: true }).catch(console.error);
  };




  // --- COPY/PASTE/DUPLICATE/DELETE ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA"
      )
        return;
      





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
  }, [nodes, selectedNodes, selectionUndoStack, selectionRedoStack]);

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
    }

    if (Object.keys(updatedProps).length === 0) {
      // Nothing changed; do nothing.
      return;
    }

    // Batch update all selected nodes with only the changed properties.
    const batch = writeBatch(db);
    selectedNodes.forEach((id) => {
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
      batch.update(nodeRef, updatedProps);
    });
    try {
      await batch.commit();
      // Update local state:
      setNodes((prev) =>
        prev.map((n) =>
          selectedNodes.includes(n.id) ? { ...n, ...updatedProps } : n
        )
      );
    } catch (error) {
      console.error("Error updating nodes:", error);
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
    const activeThreshold = 500; // 5 seconds
    return cursors
      .filter((cursor) => 
        cursor.uid !== currentUserUid && 
        now - cursor.lastActive < activeThreshold
      )
      .map((cursor) => {
        const screenX = cursor.x * zoom + pan.x;
        const screenY = cursor.y * zoom + pan.y;
        return (
          <div
            key={cursor.uid}
            style={{
              position: "absolute",
              top: screenY,
              left: screenX,
              transform: "translate(-50%, -50%)",
              transition: "top 0.35s ease, left 0.35s ease",
              backgroundColor: "blue",
              color: "#fff",
              padding: "2px 4px",
              borderRadius: "4px",
              fontSize: "10px",
              pointerEvents: "none",
              zIndex: 150,
            }}
          >
            {cursor.email}
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
  
  const visibleNodes = useMemo(() => {
    // If outerRef is not available (e.g., on initial render) return all nodes.
    if (!outerRef.current) return nodes;
  
    const { visibleLeft, visibleTop, visibleWidth, visibleHeight } = getVisibleArea();
    // Buffer so nodes near the border are still rendered
    const buffer = 100; // adjust as needed
    
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
  }, [nodes, pan, zoom]); // outerRef.current is not a reactive dependency so assume it is stable
  
  const visibleLinks = useMemo(() => {
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
        activeCustomizationNode.fontFamily !== tempFontFamily
      ) {
        const timer = setTimeout(() => {
          handleSidebarSave();
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [tempBgColor, tempTextColor, tempFontSize, tempTextStyle, tempTextAlign, tempFontFamily, activeCustomizationNode]);

  const navigate = useNavigate();
  const ContextMenu = () => {
    if (!contextMenuu.visible) return null;
    if (rightClickMoved) return null;
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
                //e.preventDefault();
                //e.stopPropagation();
                handlePaste(e);
              }}
            >
              Paste
            </div>
            <div className="context-menu-item"
              style={{ padding: "4px 8px", cursor: "pointer" }}
              onMouseDown={handleReset}
            >
              Reset
            </div>
          </>
        )}
        {contextMenuu.type === "node" && (
          <div className="context-menu-item"
            
            onMouseDown={(e) => {
              //e.preventDefault();
              //e.stopPropagation();
              handleCopy(e);
            }}
          >
            Copy
          </div>
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



  // Make sure to close context menu on click anywhere.
  useEffect(() => {
    const handleClick = () => {
      if (contextMenuu.visible) {
        closeContextMenu();
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenuu.visible]);
  









  
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

  const handleTouchMove = (e) => {
    if (!isMobile) return;
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
      setZoom(newZoom);
      zoomRef.current = newZoom;
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
          onClick={() => navigate(`/dashboard`)}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          <ArrowBackIosIcon />
        </Button>
        <Button
          variant="contained"
          onClick={handleAddNode}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          Add Node
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            setLinkingMode((prev) => !prev);
            setLinkingSource(null);
          }}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          {linkingMode ? "Exit Linking Mode" : "Link Nodes"}
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          Export
        </Button>
        <Button
          variant="contained"
          onClick={handleZoomIn}
          style={{ marginRight: "10px", background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)" }}
        >
          Zoom In
        </Button>
        <Button variant="contained" onClick={handleZoomOut} style={{background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)"}}>
          Zoom Out
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
              <Typography
                variant="h6"
                style={{
                  marginBottom: "10px",
                  color: "#fff",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                Customize Menu
              </Typography>

              {/* Font Label */}
              <Typography
                variant="subtitle1"
                style={{
                  marginBottom: "4px",
                  color: "#ccc",
                  fontWeight: 400,
                  fontFamily: "Arial",
                }}
              >
                Font
              </Typography>

              {/* Font Selector */}
              <FormControl
                variant="filled"
                size="small"
                sx={{ minWidth: 210 }}
                style={{
                  marginBottom: "10px",
                }}
              >
                <InputLabel style={{ color: "#ccc" }}>Font</InputLabel>
                <Select
                  value={tempFontFamily}
                  onChange={(e) => setTempFontFamily(e.target.value)}
                  style={{
                    color: "#fff",
                    backgroundColor: "#2b2b2b",
                    width: "100%",
                  }}
                >
                  <MenuItem value="cursive">Cursive</MenuItem>
                  <MenuItem value="Microsoft Yahei">Microsoft Yahei</MenuItem>
                  <MenuItem value="Arial">Arial</MenuItem>
                  <MenuItem value="Times New Roman">Times New Roman</MenuItem>
                  <MenuItem value="Courier New">Courier New</MenuItem>
                </Select>
              </FormControl>

              {/* Font Size Label */}
              <Typography
                variant="subtitle1"
                style={{
                  marginBottom: "4px",
                  color: "#ccc",
                  fontWeight: 400,
                }}
              >
                Font size
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
                  "& .MuiInputBase-root": {
                    color: "#fff",
                  },
                  "& .MuiFilledInput-root": {
                    backgroundColor: "#2b2b2b",
                  },
                  "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                  "& .MuiAutocomplete-popupIndicator": { color: "#fff" },
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Font Size"
                    variant="filled"
                    InputLabelProps={{ style: { color: "#ccc" } }}
                  />
                )}
                style={{
                  marginBottom: "12px",
                  boxShadow: "inset 0 0 4px rgba(0,0,0,0.6)",
                  borderRadius: "6px",
                  color: "white",
                }}
              />

              {/* Text Style + Alignment Toggles */}
              <Stack direction="column" spacing={1} sx={{ alignItems: "center" }}>
                <ToggleButtonGroup
                  color="primary"
                  value={tempTextStyle}
                  onChange={(e, newStyles) => setTempTextStyle(newStyles)}
                  style={{
                    backgroundColor: "#2b2b2b",
                    marginBottom: "8px",
                    borderRadius: "6px",
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
                  style={{
                    backgroundColor: "#2b2b2b",
                    borderRadius: "6px",
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

              {/* Node Background Color */}
              <Box
                component="div"
                sx={{
                  //color: "#fff",
                  fontSize: "1rem",
                  marginTop: "12px",
                  //marginBottom: "4px",
                  color: "#ccc",
                  fontWeight: 400,
                  fontFamily: "Arial",
                }}
                variant="subtitle1"
              >
                Background
                <input
                  type="color"
                  value={tempBgColor}
                  onChange={(e) => setTempBgColor(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "40px",
                    marginTop: "5px",
                    border: "none",
                    backgroundColor: "transparent",
                    padding: 0,
                    borderRadius: "6px",
                    cursor: "pointer",
                    
                  }}
                />
              </Box>

              {/* Node Font Color */}
              <Box
                component="div"
                sx={{
                  //color: "#fff",
                  fontSize: "1rem",
                  marginTop: "12px",
                  //marginBottom: "4px",
                  color: "#ccc",
                  fontWeight: 400,
                  fontFamily: "Arial",
                }}
                variant="subtitle1"
              >
                Font Color
                <input
                  type="color"
                  value={tempTextColor}
                  onChange={(e) => setTempTextColor(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "40px",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    marginTop: "5px",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                />
              </Box>

              {/* Remove All Links Button */}
              <Button
                variant="contained"
                onClick={handleRemoveLinks}
                style={{
                  marginTop: "30px",
                  backgroundColor: "#a11",
                  color: "#fff",
                  width: "100%",
                }}
              >
                Remove All Links
              </Button>
            </>
          ) : (
            <Typography variant="body2" style={{ color: "#fff" }}>
              Select a node to customize...
            </Typography>
          )}
        </div>
      )}

      {/* Active Users Panel (only one instance now) */}
      <div
        style={{
          position: "fixed",
          top: 60,
          right: 290,
          background: "radial-gradient(circle at center,rgba(29, 32, 34, 0.63) 0%, #0f1011 100%)",
          color: "#fff",
          padding: "8px",
          borderRadius: "4px",
          zIndex: 250
        }}
      >
        <Typography variant="caption">Active Users:</Typography>
        {presenceUsers.map((user, index) => (
          <div key={index}>
            <Typography variant="caption">{user.email}</Typography>
          </div>
        ))}
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
                stroke="rgba(255, 255, 255, 0.29)"  // Subtle connector lines
                strokeWidth="5"
              />
            );
          })}
        </svg>
        {visibleNodes.map((node) => (
          <MindMapNode
            key={node.id}
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
                selectedNodes.forEach((id) => {
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
                }
                multiDragStartRef.current = {};
                setGroupDelta({ x: 0, y: 0 });
              } else {
                setNodes((prev) =>
                  prev.map((n) => (n.id === node.id ? { ...n, x: finalX, y: finalY } : n))
                );
                try {
                  const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", node.id);
                  await updateDoc(nodeRef, { x: finalX, y: finalY });
                } catch (error) {
                  console.error("Error updating node position:", error);
                }
              }
              setIsDragging(false);
            }}
          />
        ))}
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
      />
    </div>
  );
};  

  export default MindMapEditor;