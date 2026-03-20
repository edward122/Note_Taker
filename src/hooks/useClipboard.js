// src/hooks/useClipboard.js
import { useEffect, useCallback } from "react";
import {
  collection,
  query,
  addDoc,
  where,
  getDocs,
} from "firebase/firestore";
import { db, storage } from "../firebase/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "../components/constants";

/**
 * Hook that manages copy/paste operations for mind map nodes.
 * Handles JSON node data, images, and plain text paste.
 */
export function useClipboard({
  mindMapId,
  editingNodeId,
  selectedNodes,
  nodes,
  localCursor,
  zoomRef,
  duplicateNodeWithPosition,
  pushSelectionToUndoStack,
  pushAction,
  closeContextMenu,
}) {
  // Copy handler
  const handleCopy = useCallback(async (e) => {
    if (editingNodeId) return;
    if (selectedNodes.length > 0) {
      const nodesToCopy = nodes.filter((n) => selectedNodes.includes(n.id));
      const jsonData = JSON.stringify(nodesToCopy);
      if (e.clipboardData) {
        e.clipboardData.setData("application/json", jsonData);
        e.clipboardData.setData("text/plain", jsonData);
        e.preventDefault();
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(jsonData);
        } catch (err) {
          console.error("Failed to copy nodes:", err);
        }
      }
    }
  }, [editingNodeId, selectedNodes, nodes]);

  // Register copy listener
  useEffect(() => {
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [handleCopy]);

  // Paste handler
  const handlePaste = useCallback(async () => {
    if (editingNodeId) return;
    try {
      closeContextMenu();
      let groupUndoSnapshot = {};
      let nodesData = null;
      let imageHandled = false;

      // Try clipboard items API (supports images)
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

                const dropX = localCursor.x;
                const dropY = localCursor.y;

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
              break;
            }
          }
        }

        // If no image, try text
        if (!imageHandled) {
          const clipboardText = await navigator.clipboard.readText();
          const trimmedText = clipboardText.trim();
          if (trimmedText.startsWith("{") || trimmedText.startsWith("[")) {
            try {
              nodesData = JSON.parse(trimmedText);
              if (!Array.isArray(nodesData)) nodesData = [nodesData];
            } catch {
              nodesData = null;
            }
          }
        }
      } else {
        // Fallback
        const clipboardText = await navigator.clipboard.readText();
        try {
          nodesData = JSON.parse(clipboardText);
          if (!Array.isArray(nodesData)) nodesData = [nodesData];
        } catch {
          nodesData = null;
        }
      }

      // Process JSON node data
      if (nodesData) {
        const dropX = localCursor.x;
        const dropY = localCursor.y;

        if (nodesData.length === 1) {
          const node = nodesData[0];
          const nodeWidth = node.width || DEFAULT_WIDTH;
          const nodeHeight = node.height || DEFAULT_HEIGHT;
          const nodeCenterX = node.x + nodeWidth / 2;
          const nodeCenterY = node.y + nodeHeight / 2;
          const deltaX = dropX - nodeCenterX;
          const deltaY = dropY - nodeCenterY;
          const newNodeId = await duplicateNodeWithPosition(node, { x: node.x + deltaX, y: node.y + deltaY });
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
          const deltaX = dropX - (minX + maxX) / 2;
          const deltaY = dropY - (minY + maxY) / 2;

          const nodeIdMapping = {};
          await Promise.all(
            nodesData.map(async (node) => {
              const newId = await duplicateNodeWithPosition(node, { x: node.x + deltaX, y: node.y + deltaY }, {});
              if (newId) {
                nodeIdMapping[node.id] = newId;
                groupUndoSnapshot[newId] = { id: newId, isNew: true };
              }
            })
          );
          // Duplicate links with mapping
          await Promise.all(
            nodesData.map(async (node) => {
              const newId = nodeIdMapping[node.id];
              if (!newId) return;
              const outQ = query(collection(db, "mindMaps", mindMapId, "links"), where("source", "==", node.id));
              const outSnap = await getDocs(outQ);
              for (const docSnap of outSnap.docs) {
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
      } else if (!imageHandled) {
        // Plain text paste
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
        pushAction({
          type: 'compound',
          nodes: {
            before: {},
            after: groupUndoSnapshot,
          },
          links: { before: {}, after: {} },
        });
      }
    } catch (error) {
      console.error("Error handling paste:", error);
    }
  }, [mindMapId, editingNodeId, localCursor, zoomRef, duplicateNodeWithPosition, pushAction, closeContextMenu]);

  // Register paste listener
  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return { handlePaste, handleCopy };
}
