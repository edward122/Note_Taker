// src/hooks/useUndoRedo.js
import { useState, useCallback, useRef } from "react";
import {
  collection,
  doc,
  query,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

const MAX_UNDO_STACK_SIZE = 50;

/**
 * Action record shape:
 * {
 *   type: 'move' | 'create' | 'delete' | 'modify' | 'link_create' | 'link_delete' | 'compound',
 *   nodes: {
 *     before: { [id]: nodeSnapshot | null },  // null = didn't exist before this action
 *     after:  { [id]: nodeSnapshot | null },   // null = doesn't exist after this action
 *   },
 *   links: {
 *     before: { [id]: linkSnapshot | null },   // null = didn't exist
 *     after:  { [id]: linkSnapshot | null },    // null = doesn't exist
 *   }
 * }
 *
 * Semantics:
 *   null   → entity does not exist in this state
 *   object → entity exists with this data
 *   key missing (undefined) → entity is not tracked by this action (don't touch)
 *
 * UNDO applies the `before` state.
 * REDO applies the `after` state.
 */

/**
 * Hook that manages undo/redo state and operations with full node + link tracking.
 */
export function useUndoRedo({ mindMapId, nodes, links, selectedNodes, setNodes, setLinks }) {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  
  // Refs for latest state access in callbacks without stale closures
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const linksRef = useRef(links);
  linksRef.current = links;

  // ── Push an action record onto the undo stack ──
  const pushAction = useCallback((action) => {
    if (!action) return;
    const normalized = {
      type: action.type || 'modify',
      nodes: action.nodes || { before: {}, after: {} },
      links: action.links || { before: {}, after: {} },
    };
    const hasNodes = Object.keys(normalized.nodes.before).length > 0 || Object.keys(normalized.nodes.after).length > 0;
    const hasLinks = Object.keys(normalized.links.before).length > 0 || Object.keys(normalized.links.after).length > 0;
    if (!hasNodes && !hasLinks) return;
    setUndoStack((prev) => {
      const next = [...prev, normalized];
      return next.length > MAX_UNDO_STACK_SIZE ? next.slice(-MAX_UNDO_STACK_SIZE) : next;
    });
    setRedoStack([]);
  }, []);

  // ── Convenience helpers ──
  const snapshotSelectedNodes = useCallback(() => {
    const snap = {};
    nodesRef.current.forEach((n) => {
      if (selectedNodes.includes(n.id)) snap[n.id] = structuredClone(n);
    });
    return snap;
  }, [selectedNodes]);

  const snapshotNode = useCallback((nodeOrId) => {
    if (!nodeOrId) return {};
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
    const node = typeof nodeOrId === 'string'
      ? nodesRef.current.find((n) => n.id === id)
      : nodeOrId;
    if (!node) return {};
    return { [id]: structuredClone(node) };
  }, []);

  const snapshotLinksForNodes = useCallback((nodeIds) => {
    const snap = {};
    const idSet = new Set(Array.isArray(nodeIds) ? nodeIds : [nodeIds]);
    (linksRef.current || []).forEach((link) => {
      if (idSet.has(link.source) || idSet.has(link.target)) {
        snap[link.id] = structuredClone(link);
      }
    });
    return snap;
  }, []);

  // ── Legacy API wrappers ──
  const pushSelectionToUndoStack = useCallback((customSnapshot) => {
    let nodesBefore = {};
    if (customSnapshot) {
      nodesBefore = structuredClone(customSnapshot);
    } else {
      nodesBefore = snapshotSelectedNodes();
    }
    if (Object.keys(nodesBefore).length === 0) return;
    pushAction({
      type: 'modify',
      nodes: { before: nodesBefore, after: {} },
    });
  }, [snapshotSelectedNodes, pushAction]);

  const pushSingleNodeToUndoStack = useCallback((node) => {
    if (!node) return;
    pushAction({
      type: 'modify',
      nodes: { before: { [node.id]: structuredClone(node) }, after: {} },
    });
  }, [pushAction]);

  // ── Capture current live state for a set of entity IDs ──
  const captureLiveState = useCallback((nodeIds, linkIds) => {
    const liveNodes = nodesRef.current;
    const liveLinks = linksRef.current || [];
    const nodeSnap = {};
    const linkSnap = {};
    for (const id of nodeIds) {
      const n = liveNodes.find((x) => x.id === id);
      nodeSnap[id] = n ? structuredClone(n) : null;
    }
    for (const id of linkIds) {
      const l = liveLinks.find((x) => x.id === id);
      linkSnap[id] = l ? structuredClone(l) : null;
    }
    return { nodes: nodeSnap, links: linkSnap };
  }, []);

  // ── Apply a state dict: set each entity to the given snapshot, or delete if null ──
  const applyState = useCallback(async (nodeState, linkState) => {
    const batch = writeBatch(db);
    const nodeIdsToDelete = [];
    const nodesToCreate = [];
    const linkIdsToDelete = [];
    const linksToCreate = [];

    // Process nodes
    for (const [id, val] of Object.entries(nodeState)) {
      const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", id);
      if (val === null || (val && val.isNew)) {
        // Delete this node
        batch.delete(nodeRef);
        nodeIdsToDelete.push(id);
        // Also clean up connected links in Firebase
        try {
          const outQ = query(collection(db, "mindMaps", mindMapId, "links"), where("source", "==", id));
          const outSnap = await getDocs(outQ);
          outSnap.docs.forEach((d) => { batch.delete(doc(db, "mindMaps", mindMapId, "links", d.id)); linkIdsToDelete.push(d.id); });
          const inQ = query(collection(db, "mindMaps", mindMapId, "links"), where("target", "==", id));
          const inSnap = await getDocs(inQ);
          inSnap.docs.forEach((d) => { batch.delete(doc(db, "mindMaps", mindMapId, "links", d.id)); linkIdsToDelete.push(d.id); });
        } catch (err) { console.warn("Link cleanup error:", err); }
      } else {
        // Create or update this node
        const { id: _id, ...data } = val;
        const exists = nodesRef.current.find((n) => n.id === id);
        if (exists) {
          batch.set(nodeRef, data, { merge: true });
        } else {
          batch.set(nodeRef, data);
          nodesToCreate.push(val);
        }
      }
    }

    // Process links
    for (const [id, val] of Object.entries(linkState)) {
      const linkRef = doc(db, "mindMaps", mindMapId, "links", id);
      if (val === null) {
        batch.delete(linkRef);
        linkIdsToDelete.push(id);
      } else {
        const { id: _id, ...data } = val;
        const exists = (linksRef.current || []).find((l) => l.id === id);
        if (exists) {
          batch.set(linkRef, data, { merge: true });
        } else {
          batch.set(linkRef, data);
          linksToCreate.push(val);
        }
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      console.error("Error during undo/redo batch:", error);
    }

    // Update local node state
    setNodes((prev) => {
      let updated = prev.filter((n) => !nodeIdsToDelete.includes(n.id));
      updated = updated.map((n) => {
        const val = nodeState[n.id];
        if (val && val !== null && !val.isNew) return { ...n, ...val };
        return n;
      });
      for (const node of nodesToCreate) {
        if (!updated.find((n) => n.id === node.id)) updated.push(node);
      }
      return updated;
    });

    // Update local link state
    if (setLinks) {
      setLinks((prev) => {
        let updated = prev.filter((l) => !linkIdsToDelete.includes(l.id));
        updated = updated.map((l) => {
          const val = linkState[l.id];
          if (val && val !== null) return { ...l, ...val };
          return l;
        });
        for (const link of linksToCreate) {
          if (!updated.find((l) => l.id === link.id)) updated.push(link);
        }
        return updated;
      });
    }
  }, [mindMapId, setNodes, setLinks]);

  // ── Undo ──
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];

    // Collect all entity IDs mentioned in this action
    const allNodeIds = new Set([...Object.keys(action.nodes.before), ...Object.keys(action.nodes.after)]);
    const allLinkIds = new Set([...Object.keys(action.links.before), ...Object.keys(action.links.after)]);

    // Capture live state BEFORE applying undo → becomes the redo's "after"
    const live = captureLiveState(allNodeIds, allLinkIds);

    // Build redo entry: before = what we're restoring TO now, after = live state (to redo back to)
    const redoEntry = {
      type: action.type,
      nodes: { before: action.nodes.before, after: live.nodes },
      links: { before: action.links.before, after: live.links },
    };
    setRedoStack((prev) => [...prev, redoEntry]);

    // Apply the "before" state (undo)
    await applyState(action.nodes.before, action.links.before);

    setUndoStack((prev) => prev.slice(0, -1));
  }, [undoStack, captureLiveState, applyState]);

  // ── Redo ──
  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];

    // Collect all entity IDs
    const allNodeIds = new Set([...Object.keys(action.nodes.before), ...Object.keys(action.nodes.after)]);
    const allLinkIds = new Set([...Object.keys(action.links.before), ...Object.keys(action.links.after)]);

    // Capture live state BEFORE applying redo → becomes the undo's "before"
    const live = captureLiveState(allNodeIds, allLinkIds);

    // Build undo entry
    const undoEntry = {
      type: action.type,
      nodes: { before: live.nodes, after: action.nodes.after },
      links: { before: live.links, after: action.links.after },
    };
    setUndoStack((prev) => [...prev, undoEntry]);

    // Apply the "after" state (redo)
    await applyState(action.nodes.after, action.links.after);

    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, captureLiveState, applyState]);

  return {
    undoStack,
    redoStack,
    selectionUndoStack: undoStack,
    selectionRedoStack: redoStack,
    pushSelectionToUndoStack,
    pushSingleNodeToUndoStack,
    pushAction,
    snapshotNode,
    snapshotSelectedNodes,
    snapshotLinksForNodes,
    handleUndo,
    handleRedo,
    handleUndoSelection: handleUndo,
    handleRedoSelection: handleRedo,
  };
}
