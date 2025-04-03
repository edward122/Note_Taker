// src/components/MindMapEditor.jsx
// Global CSS: html, body { overflow: hidden; height: 100%; margin: 0; padding: 0; }
import React, { useEffect, useState, useRef } from "react";
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
} from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";
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
} from "@mui/material";
import Draggable from "react-draggable";
import PaletteIcon from "@mui/icons-material/Palette";
import { BlockPicker } from 'react-color';
import "./new.css";


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

  // Zoom and pan state for canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const mouseStart = useRef({ x: 0, y: 0 });

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

  

  // Handle text alignment toggles
  const handleTextAlignChange = (event, newAlign) => {
    if (newAlign !== null) {
      setTextAlign(newAlign);
    }
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
    const cursorRef = ref(
      dbRealtime,
      `mindMaps/${mindMapId}/cursors/${currentUserUid}`,
    );
    const container = containerRef.current;
    if (!container) return;
    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setLocalCursor({ x, y });
    };
    container.addEventListener("mousemove", handleMouseMove);
    const interval = setInterval(() => {
      set(cursorRef, {
        ...localCursor,
        email: currentUserEmail,
        lastActive: Date.now(),
      }).catch(console.error);
    }, 200);
    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      clearInterval(interval);
      // Let a backend cleanup handle stale cursors instead of deleting here.
    };
  }, [mindMapId, currentUserUid, currentUserEmail, localCursor]);

  // Subscribe to remote cursors from RTDB
  useEffect(() => {
    if (!mindMapId) return;
    const dbRealtime = getDatabase();
    const cursorsRef = ref(dbRealtime, `mindMaps/${mindMapId}/cursors`);
    const handleValue = (snapshot) => {
      const data = snapshot.val() || {};
      const cursorsArray = Object.entries(data).map(([uid, cursorData]) => ({
        uid,
        ...cursorData,
      }));
      setCursors(cursorsArray);
    };
    onValue(cursorsRef, handleValue);
    return () => {
      off(cursorsRef);
    };
  }, [mindMapId]);

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

  const pushSelectionToUndoStack = () => {
    const snapshot = {};
    selectedNodes.forEach((id) => {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        snapshot[id] = { ...node };
      }
    });
    // Use a deep clone to ensure no undefined values remain:
    const deepSnapshot = JSON.parse(JSON.stringify(snapshot));
    //const linksSnapshot = JSON.parse(JSON.stringify(links));
    //const snapshot2 = { nodes: deepSnapshot, links: linksSnapshot };
    //console.log("Pushing snapshot:", snapshot2);
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
    const snapshot = selectionUndoStack[selectionUndoStack.length - 1];
    setSelectionRedoStack((prev) => [
      ...prev,
      selectedNodes.reduce((acc, id) => {
        const node = nodes.find((n) => n.id === id);
        if (node) acc[id] = { ...node };
        return acc;
      }, {}),
    ]);
    // Update Firestore and local state with the snapshot:
    console.log(snapshot);
    for (const id in snapshot) {
      try {
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
        await updateDoc(nodeRef, snapshot[id]);
        console.log("Updated node in undo:", id);
      } catch (error) {
        if (
          error.message.includes("No document to update") ||
          error.code === "not-found"
        ) {
          try {
            const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
            await setDoc(nodeRef, snapshot[id]);
            console.log("Re-created node in undo:", id);
          } catch (setError) {
            console.error("Error re-creating node in undo:", setError);
          }
        } else {
          console.error("Error updating node in undo:", error);
        }
      }
    }
    setNodes((prev) =>
      prev.map((n) => (snapshot[n.id] ? { ...n, ...snapshot[n.id] } : n)),
    );
    setSelectionUndoStack((prev) => prev.slice(0, prev.length - 1));
  };

  const handleRedoSelection = async () => {
    if (selectionRedoStack.length === 0) return;
    const snapshot = selectionRedoStack[selectionRedoStack.length - 1];

    // Update Firestore and local state with the snapshot:
    console.log(snapshot);
    for (const id in snapshot) {
      try {
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
        await updateDoc(nodeRef, snapshot[id]);
        console.log("Updated node in undo:", id);
      } catch (error) {
        if (
          error.message.includes("No document to update") ||
          error.code === "not-found"
        ) {
          try {
            const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
            await setDoc(nodeRef, snapshot[id]);
            console.log("Re-created node in undo:", id);
          } catch (setError) {
            console.error("Error re-creating node in undo:", setError);
          }
        } else {
          console.error("Error updating node in undo:", error);
        }
      }
    }
    setNodes((prev) =>
      prev.map((n) => (snapshot[n.id] ? { ...n, ...snapshot[n.id] } : n)),
    );
    setSelectionRedoStack((prev) => prev.slice(0, prev.length - 1));
  };

  const handleResizeMouseDown = (node, e) => {
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
    setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  };
  const handleZoomOut = () => {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
  };
  useEffect(() => {
    const container = outerRef.current;
    const container2 = containerRef.current;
    if (!container) return;
    const handleWheelCustom = (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        // Get the container's bounding rect
        const rect = container2.getBoundingClientRect();
        // Calculate cursor's position within the container
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const oldZoom = zoom;
        let newZoom = zoom;
        if (e.deltaY < 0) {
          newZoom = Math.min(MAX_ZOOM, oldZoom + ZOOM_STEP);
        } else {
          newZoom = Math.max(MIN_ZOOM, oldZoom - ZOOM_STEP);
        }
        // Factor difference between new and old zoom
        const factor = newZoom / oldZoom - 1;
        // Adjust pan so that the point under the cursor remains fixed:
        const newPan = {
          x: pan.x - cursorX * factor,
          y: pan.y - cursorY * factor,
        };
        setZoom(newZoom);
        setPan(newPan);
      }
    };
    container.addEventListener("wheel", handleWheelCustom, { passive: false });
    return () => container.removeEventListener("wheel", handleWheelCustom);
  }, [zoom, pan]);

  // --- PANNING ---
  const handleContextMenu = (e) => {
    e.preventDefault();
  };
  const handleMouseDown = (e) => {
    if (e.button !== 2) return;
    e.preventDefault(); // ensure default is prevented
    panStart.current = { ...pan };
    mouseStart.current = { x: e.clientX, y: e.clientY };
    const handleMouseMovePan = (moveEvent) => {
      const deltaX = moveEvent.clientX - mouseStart.current.x;
      const deltaY = moveEvent.clientY - mouseStart.current.y;
      const newX = panStart.current.x + deltaX;
      const newY = panStart.current.y + deltaY;
      setPan({ x: newX, y: newY });
    };
    const handleMouseUpPan = () => {
      document.removeEventListener("mousemove", handleMouseMovePan);
      document.removeEventListener("mouseup", handleMouseUpPan);
    };
    document.addEventListener("mousemove", handleMouseMovePan);
    document.addEventListener("mouseup", handleMouseUpPan);
  };

  // --- NODE ACTIONS ---
  const handleAddNode = async () => {
    if (!mindMapId) return;
    try {
      await addDoc(collection(db, "mindMaps", mindMapId, "nodes"), {
        text: "New Node",
        x: 500,
        y: 500,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        lockedBy: null,
        typing: false,
      });
    } catch (error) {
      console.error("Error adding node:", error);
    }
  };

  const handleStopDrag = async (e, data, nodeId) => {
    try {
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", nodeId);
      await updateDoc(nodeRef, { x: data.x, y: data.y });
    } catch (error) {
      console.error("Error updating node position:", error);
    }
  };

  const handleDoubleClick = (node) => {
    if (linkingMode) return;
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
      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        if (selectedNodes.length > 0) {
          const nodesToCopy = nodes.filter((n) => selectedNodes.includes(n.id));
          setCopiedNodes(nodesToCopy);
          console.log("Copied nodes:", nodesToCopy);
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === "v") {
        if (copiedNodes.length > 0) {
          copiedNodes.forEach((node) => {
            // For example, duplicate with an offset of 20 pixels:
            duplicateNode(node, 20);
          });
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === "d") {
        if (selectedNodes.length > 0) {
          e.preventDefault();
          // Duplicate all selected nodes
          const nodesToDuplicate = nodes.filter((n) =>
            selectedNodes.includes(n.id),
          );
          nodesToDuplicate.forEach((node) => duplicateNode(node, 20));
        }
      }

      if (
        !editingNodeId &&
        selectedNodes.length > 0 &&
        (e.key === "Backspace" || e.key === "Delete")
      ) {
        e.preventDefault();
        if (
          window.confirm("Are you sure you want to delete the selected nodes?")
        ) {
          pushSelectionToUndoStack(); // capture state before deletion
          for (const id of selectedNodes) {
            const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
            deleteDoc(nodeRef).catch(console.error);
          }
          // Optimistically update local state:
          setNodes((prev) => prev.filter((n) => !selectedNodes.includes(n.id)));
          setSelectedNodes([]);
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
    setSelectionBox({ ...selectionBox, x, y, width, height });
  };

  const handleOuterMouseUp = (e) => {
    if (!selectionBox) return;
    // Determine which nodes are within the selection box.
    // (This example uses full containment; you may adjust to partial intersection.)
    const newSelection = nodes
      .filter((node) => {
        const nodeWidth = node.width || DEFAULT_WIDTH;
        const nodeHeight = node.height || DEFAULT_HEIGHT;
        return (
          node.x >= selectionBox.x &&
          node.x + nodeWidth <= selectionBox.x + selectionBox.width &&
          node.y >= selectionBox.y &&
          node.y + nodeHeight <= selectionBox.y + selectionBox.height
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

  const duplicateNode = async (node) => {
    if (!mindMapId) return;
    if (selectedNodes.length === 0) return;
    pushSelectionToUndoStack();
    const offset = 20;
    // Destructure to get the original node's id and data
    const { id: originalNodeId, ...nodeData } = node;
    try {
      // Duplicate the node and get its new ID
      const newDocRef = await addDoc(
        collection(db, "mindMaps", mindMapId, "nodes"),
        {
          ...nodeData,
          x: node.x + offset,
          y: node.y + offset,
          lockedBy: null,
          typing: false,
        },
      );
      const newNodeId = newDocRef.id;
      console.log("Duplicated node with new id:", newNodeId);

      // Duplicate outgoing links: where original node is the source
      const outgoingQuery = query(
        collection(db, "mindMaps", mindMapId, "links"),
        where("source", "==", originalNodeId),
      );
      const outgoingSnapshot = await getDocs(outgoingQuery);
      outgoingSnapshot.forEach(async (docSnap) => {
        const linkData = docSnap.data();
        await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
          ...linkData,
          source: newNodeId, // new duplicate node becomes the source
        });
      });

      // Duplicate incoming links: where original node is the target
      const incomingQuery = query(
        collection(db, "mindMaps", mindMapId, "links"),
        where("target", "==", originalNodeId),
      );
      const incomingSnapshot = await getDocs(incomingQuery);
      incomingSnapshot.forEach(async (docSnap) => {
        const linkData = docSnap.data();
        await addDoc(collection(db, "mindMaps", mindMapId, "links"), {
          ...linkData,
          target: newNodeId, // new duplicate node becomes the target
        });
      });
    } catch (error) {
      console.error("Error duplicating node and links:", error);
    }
  };

  // --- SIDEBAR FOR CUSTOMIZATION ---
  const handleSidebarSave = async () => {
    console.log("Save clicked for nodes:", selectedNodes);
    if (!selectedNodes || selectedNodes.length === 0) return;
    // Prepare the updated properties (you can extend this with more fields)
    const updatedProps = {
      bgColor: tempBgColor,
      textColor: tempTextColor,
      fontSize: tempFontSize,
      textStyle: tempTextStyle,  // e.g., an array like ['bold','italic']
      textAlign: tempTextAlign,  // e.g., "left", "center", or "right"
      fontFamily: tempFontFamily,
    };
    // Update Firestore for each selected node using a for...of loop.
    for (const id of selectedNodes) {
      try {
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
        await updateDoc(nodeRef, updatedProps);
      } catch (error) {
        console.error("Error updating node:", id, error);
      }
    }
    // Optimistically update local state:
    setNodes((prev) =>
      prev.map((n) =>
        selectedNodes.includes(n.id) ? { ...n, ...updatedProps } : n,
      ),
    );
    // Clear the selection (or you can leave it if you want)
    //setSelectedNodes([]);
  };

  const handleSidebarCancel = () => {
    console.log("Cancel clicked");
    setSelectedNodes([]);
  };

  const handleRemoveLinks = async () => {
    if (!selectedNodes || selectedNodes.length === 0) return;
    try {
      for (const nodeId of selectedNodes) {
        // Query for outgoing links where the node is the source
        const outgoingQuery = query(
          collection(db, "mindMaps", mindMapId, "links"),
          where("source", "==", nodeId),
        );
        const outgoingSnapshot = await getDocs(outgoingQuery);
        for (const docSnap of outgoingSnapshot.docs) {
          await deleteDoc(doc(db, "mindMaps", mindMapId, "links", docSnap.id));
        }

        // Query for incoming links where the node is the target
        const incomingQuery = query(
          collection(db, "mindMaps", mindMapId, "links"),
          where("target", "==", nodeId),
        );
        const incomingSnapshot = await getDocs(incomingQuery);
        for (const docSnap of incomingSnapshot.docs) {
          await deleteDoc(doc(db, "mindMaps", mindMapId, "links", docSnap.id));
        }
      }
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

  const renderLinks = () => {
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
  };

  // Render remote cursors from RTDB
  const renderCursors = () => {
    return cursors
      .filter((cursor) => cursor.uid !== currentUserUid)
      .map((cursor) => (
        <div
          key={cursor.uid}
          style={{
            position: "absolute",
            top: cursor.y,
            left: cursor.x,
            transform: "translate(-50%, -50%)",
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
      ));
  };

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
  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        backgroundColor: "#121212",
        userSelect: "none",
      }}
      ref={outerRef}
      onContextMenu={(e) => e.preventDefault()}
      //onMouseDown={handleMouseDown}
      onMouseDown={(e) => {
        if (e.target === outerRef.current) {
          handleOuterMouseDown(e);
          if (e.button !== 2) return;
          handleMouseDown(e);
        }
      }}
      onMouseMove={(e) => {
        if (e.target === outerRef.current) {
          handleOuterMouseMove(e);
        }
      }}
      onMouseUp={(e) => {
        if (e.target === outerRef.current) {
          handleOuterMouseUp(e);
        }
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "50px",
          backgroundColor: "#333",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          zIndex: 300,
        }}
      >
        <Button
          variant="contained"
          onClick={() => navigate(`/dashboard`)}
          style={{ marginRight: "10px" }}
        >
          <ArrowBackIosIcon />
        </Button>
        <Button
          variant="contained"
          onClick={handleAddNode}
          style={{ marginRight: "10px" }}
        >
          Add Node
        </Button>
        <Button
          variant="contained"
          onClick={toggleLinkingMode}
          style={{ marginRight: "10px" }}
        >
          {linkingMode ? "Exit Linking Mode" : "Link Nodes"}
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
          style={{ marginRight: "10px" }}
        >
          Export
        </Button>
        <Button
          variant="contained"
          onClick={handleZoomIn}
          style={{ marginRight: "10px" }}
        >
          Zoom In
        </Button>
        <Button variant="contained" onClick={handleZoomOut}>
          Zoom Out
        </Button>
        {linkingMode && (
          <Typography
            variant="body2"
            style={{ color: "#fff", marginLeft: "10px" }}
          >
            {linkingSource ? "Select target node..." : "Select source node..."}
          </Typography>
        )}
      </div>
      {/* Right Sidebar */}
      <div
        style={{
          position: "fixed",
          top: 50,
          right: 0,
          width: "250px",
          height: "calc(100% - 50px)",
          backgroundColor: "#333",
          padding: "20px",
          boxSizing: "border-box",
          zIndex: 300,
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()} // Prevent outer container events
        onMouseDown={(e) => e.stopPropagation()}
      >
        {activeCustomizationNode ? (
          <>
            
            <Typography variant="h6" style={{ marginBottom: "5px", color: "#fff", fontWeight: "bold" }}>
              Font
            </Typography>
            <Box display="flex" alignItems="center" gap={1}
              
              >
              {/* Font Family */}
              <FormControl
                variant="filled"
                size="small"
                sx={{ minWidth: 120 }}
                style={{ marginBottom: "10px" }}
              >
                <InputLabel style={{ color: "#fff" }}>Font</InputLabel>
                <Select
                  value={tempFontFamily}
                  onChange={(e) => setTempFontFamily(e.target.value)}
                  style={{
                    color: "#fff",
                    backgroundColor: "#444",
                    width: "100%",
                  }}
                >
                  <MenuItem value="cursive">Cursive</MenuItem>
                  <MenuItem value="Microsoft Yahei">Microsoft Yahei</MenuItem>
                  <MenuItem value="Arial">Arial</MenuItem>
                  <MenuItem value="Times New Roman">Times New Roman</MenuItem>
                  <MenuItem value="Courier New">Courier New</MenuItem>
                  {/* Add more fonts as needed */}
                </Select>
              </FormControl>
              {/* Font Size */}

              <Autocomplete
                freeSolo
                options={presetSizes}
                getOptionLabel={(option) => option.toString()}
                value={tempFontSize}
                onChange={(e, newValue) => {
                  // newValue might be a number or a string
                  let parsed;
                  if (typeof newValue === 'number') {
                    parsed = newValue;
                  } else if (typeof newValue === 'string' && newValue.trim() !== '') {
                    parsed = parseInt(newValue, 10);
                  }
                  if (!isNaN(parsed)) {
                    setTempFontSize(parsed);
                    //handleSidebarSave(); // Save instantly when a valid value is chosen
                  }
                }}
                onInputChange={(e, newInputValue) => {
                  // Here we update the value as the user types, but we don't save immediately
                  const parsed = parseInt(newInputValue, 10);
                  if (!isNaN(parsed)) {
                    setTempFontSize(parsed);
                  }
                }}
                sx={{
                  width: 10,
                  "& .MuiInputBase-root": {
                    backgroundColor: "#444",
                    color: "#fff",
                  },
                  "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                  "& .MuiAutocomplete-popupIndicator": { color: "#fff" },
                }}
                PaperProps={{
                  sx: {
                    backgroundColor: "#444",
                    color: "#fff",
                  },
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Font Size" variant="filled" InputLabelProps={{ style: { color: "#fff" } }} />
                )}
                style={{
                  marginBottom: "10px",
                  background: "#444",
                  color: "white",
                  width: "40%",
                }}
              />
              
            </Box>
            
            
            {/* Bold, Italic, Underline Toggles */}
            <ToggleButtonGroup
              value={tempTextStyle}
              onChange={(e, newStyles) => {
                setTempTextStyle(newStyles);
                // Optionally, call handleSidebarSave() here for instant saving
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

            {/* Text Alignment */}
            <ToggleButtonGroup
              value={tempTextAlign}
              exclusive
              onChange={(e, newAlign) => {
                if (newAlign !== null) {
                  setTempTextAlign(newAlign);
                  // Optionally, call handleSidebarSave() for instant saving
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


            <Typography variant="h6" style={{ marginBottom: "5px", color: "#fff", fontWeight: "bold",borderTop: '1px solid #fff', paddingTop: '10px' }}>
              Topic
            </Typography>

            <Box display="flex" alignItems="center" gap={1}>
              <Box component="span" sx={{ color: '#fff', fontSize: '0.9rem' }}>
                Background:
                <input
                  type="color"
                  value={tempBgColor}
                  onChange={(e) => setTempBgColor(e.target.value)}
                  style={{
                    width: 64,
                    height: 32,
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                  }}
                />
              </Box>
              <Box component="span" sx={{ color: '#fff', fontSize: '0.9rem' }}>
                Font Color:
                <input
                  type="color"
                  value={tempTextColor}
                  onChange={(e) => setTempTextColor(e.target.value)}
                  style={{
                    width: 64,
                    height: 32,
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                  }}
                />
              </Box>
            </Box>
            
            
            
            <Button
              variant="contained"
              onClick={handleRemoveLinks}
              style={{ marginRight: "10px", backgroundColor: "red", marginTop: '200%' }}
            >
              Remove All Links
            </Button>
            
          </>
        ) : (
          <Typography variant="caption" style={{ color: "#fff" }}>
            Select a node to customize...
          </Typography>
        )}
      </div>
      <div
        style={{
          position: "fixed",
          top: 60,
          right: 270,
          backgroundColor: "rgba(0,0,0,0.7)",
          color: "#fff",
          padding: "8px",
          borderRadius: "4px",
          zIndex: 250,
        }}
      >
        <Typography variant="caption">Active Users:</Typography>
        {presenceUsers.map((user, index) => (
          <div key={index}>
            <Typography variant="caption">{user.email}</Typography>
          </div>
        ))}
      </div>
      {/* Render remote cursors from RTDB */}
      {renderCursors()}
      {/* Canvas Container (Zoomable & Pannable) */}
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          if (e.target === containerRef.current) setSelectedNodes([]);
        }}
        style={{
          position: "absolute",
          top: "0", // still below the top bar
          left: "0",
          // Set a large virtual area:
          width: ".1px",
          height: ".1px",
          // Allow content to be visible outside the initial area:
          overflow: "visible",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "top left",
        }}
      >
        {/* SVG for links */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {renderLinks()}
        </svg>
        {nodes.map((node) => {
          const effectiveX = selectedNodes.includes(node.id)
            ? node.x + groupDelta.x
            : node.x;
          const effectiveY = selectedNodes.includes(node.id)
            ? node.y + groupDelta.y
            : node.y;
          const isHighlighted = isNodeHighlighted(node);

          return (
            <Draggable
              scale={zoom}
              key={node.id}
              position={{ x: effectiveX, y: effectiveY }}
              onStart={(e, data) => {
                setIsDragging(true);
                if (
                  selectedNodes.length > 1 &&
                  selectedNodes.includes(node.id)
                ) {
                  // Only record once per drag:

                  if (Object.keys(multiDragStartRef.current).length === 0) {
                    selectedNodes.forEach((id) => {
                      const found = nodes.find((n) => n.id === id);
                      if (found) {
                        multiDragStartRef.current[id] = {
                          x: found.x,
                          y: found.y,
                        };
                      }
                    });
                  }
                  // Also record the leader's starting position for delta calculation:
                  dragStartRef.current = { x: node.x, y: node.y };
                } else {
                  dragStartRef.current = { x: node.x, y: node.y };
                }
              }}
              onDrag={(e, data) => {
                if (
                  selectedNodes.length > 1 &&
                  selectedNodes.includes(node.id)
                ) {
                  const deltaX = data.x - dragStartRef.current.x;
                  const deltaY = data.y - dragStartRef.current.y;
                  updateGroupDelta({ x: deltaX, y: deltaY });
                }
              }}
              onStop={async (e, data) => {
                const start = dragStartRef.current;
                const distance = Math.sqrt(Math.pow(data.x - start.x, 2) + Math.pow(data.y - start.y, 2));
                const threshold = 2; // pixels threshold (adjust as needed)

                // If movement is less than threshold, treat it as a click (no drag)
                if (distance < threshold) {
                  setIsDragging(false);
                  return;
                }
                if (selectedNodes.length > 0) {
                  pushSelectionToUndoStack();
                } else {
                  pushSingleNodeToUndoStack(node);
                }
                if (
                  selectedNodes.includes(node.id) &&
                  selectedNodes.length > 1
                ) {
                  // Use the leader’s delta for multi-drag.
                  // Compute delta from the leader's starting position:
                  const deltaX = data.x - dragStartRef.current.x;
                  const deltaY = data.y - dragStartRef.current.y;
                  const newPositions = {};
                  selectedNodes.forEach((id) => {
                    const startPos = multiDragStartRef.current[id];
                    if (startPos) {
                      const newX = startPos.x + deltaX;
                      const newY = startPos.y + deltaY;
                      newPositions[id] = { x: newX, y: newY };
                    }
                  });
                  // Update Firestore and local state:
                  for (let id of selectedNodes) {
                    if (newPositions[id]) {
                      try {
                        const nodeRef = doc(
                          db,
                          "mindMaps",
                          mindMapId,
                          "nodes",
                          id,
                        );
                        await updateDoc(nodeRef, {
                          x: newPositions[id].x,
                          y: newPositions[id].y,
                        });
                        console.log(
                          "Updated node:",
                          id,
                          newPositions[id].x,
                          newPositions[id].y,
                        );
                      } catch (error) {
                        console.error("Error updating node position:", error);
                      }
                    }
                  }
                  setNodes((prev) =>
                    prev.map((n) =>
                      selectedNodes.includes(n.id) && newPositions[n.id]
                        ? {
                            ...n,
                            x: newPositions[n.id].x,
                            y: newPositions[n.id].y,
                          }
                        : n,
                    ),
                  );
                  multiDragStartRef.current = {};
                  setGroupDelta({ x: 0, y: 0 });
                } else {
                  // Single drag:

                  const deltaX = data.x - dragStartRef.current.x;
                  const deltaY = data.y - dragStartRef.current.y;
                  const newX = dragStartRef.current.x + deltaX;
                  const newY = dragStartRef.current.y + deltaY;
                  try {
                    const nodeRef = doc(
                      db,
                      "mindMaps",
                      mindMapId,
                      "nodes",
                      node.id,
                    );
                    await updateDoc(nodeRef, { x: newX, y: newY });
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id ? { ...n, x: newX, y: newY } : n,
                      ),
                    );
                    console.log("Updated node:", node.id, newX, newY);
                  } catch (error) {
                    console.error("Error updating node position:", error);
                  }
                }
                setIsDragging(false);
              }}
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
                  padding: "5px",
                  boxShadow: isHighlighted
                    ? "0 1px 10px 2px rgba(300, 300,300, 0.5)"
                    : "none",
                  backgroundColor: node.bgColor
                    ? node.bgColor
                    : linkingSource === node.id
                      ? "#333"
                      : "#1e1e1e",
                  color: node.textColor ? node.textColor : "#fff",
                  borderRadius: "4px",
                  cursor: "move",
                  minWidth: "100px",
                  width: node.width ? `${node.width}px` : `${DEFAULT_WIDTH}px`,
                  height: node.height
                    ? `${node.height}px`
                    : `${DEFAULT_HEIGHT}px`,
                  overflow: "hidden",
                  //textwrap: 'balance',
                  boxSizing: "border-box",
                  fontSize: node.fontSize ? `${node.fontSize}px` : "14px",
                  textAlign: node.textAlign || 'left',
                  fontStyle: node.textStyle && node.textStyle.includes('italic') ? 'italic' : 'normal',
                  textDecoration: node.textStyle && node.textStyle.includes('underline') ? 'underline' : 'none',
                  fontWeight: node.textStyle && node.textStyle.includes('bold') ? 'bold' : 'normal',
                  fontFamily: node.fontFamily ? node.fontFamily : "cursive",
                  //fontweight: '900',
                  //textAlign: 'left',
                  //textshadow: '#fc0 1px 0 10px',
                  fontopticalsizing: "auto",
                  border: isHighlighted ? "2px solid white" : "none",
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
                    //variant="outlined"

                    style={{
                      backgroundColor: "inherit",
                      //borderRadius: '4px',
                      width: "100%",
                      height: "100%",
                      fontSize: "inherit",
                      color: "inherit",
                      fontFamily: "inherit",
                      //lineHeight: 'inherit',
                      //verticalAlign: 'top',
                      fontopticalsizing: "auto",
                      //alignItems: 'center',
                      //textAlign: 'left',
                      //textAlign: 'end',
                      border: "none",
                      outline: "none",
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
                {node.typing &&
                  node.lockedBy &&
                  node.lockedBy !== currentUserEmail && (
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
                    width: "10px",
                    height: "10px",
                    cursor: "nwse-resize",
                    backgroundColor: "#ccc",
                  }}
                ></div>
              </div>
            </Draggable>
          );
        })}
        {/* Render selection rectangle: Convert world coordinates to screen coordinates */}
        {selectionBox && (
          <div
            style={{
              position: "absolute",
              border: "1px dashed #fff",
              backgroundColor: "rgba(255,255,255,0.1)",
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.width,
              height: selectionBox.height,
              pointerEvents: "none",
              zIndex: 500,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default MindMapEditor;
