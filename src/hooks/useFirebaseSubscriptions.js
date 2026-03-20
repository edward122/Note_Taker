// src/hooks/useFirebaseSubscriptions.js
import { useEffect, useRef, useCallback } from "react";
import {
  collection,
  query,
  onSnapshot,
  setDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { remove, onDisconnect } from "firebase/database";
import { db, auth } from "../firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, set, onValue, off } from "firebase/database";
import throttle from "lodash.throttle";

/**
 * Hook that manages all Firebase subscriptions:
 * - Auth state
 * - Firestore nodes/links subscriptions
 * - Presence tracking
 * - Cursor tracking (RTDB push + remote cursor subscription)
 * - Global world-coords mouse tracking
 * - User activity broadcasting
 */
export function useFirebaseSubscriptions({
  mindMapId,
  currentUserUid,
  currentUserEmail,
  setCurrentUserEmail,
  setCurrentUserUid,
  setRawNodes,
  setRawLinks,
  setPresenceUsers,
  setCursors,
  setIsLoading,
  setError,
  setSelectedNodes,
  localCursorRef,
  containerRef,
  outerRef,
  pan,
  zoom,
  panRef,
  zoomRef,
  nodes,
  selectedNodes,
  editingNodeId,
  isDragging,
}) {
  // Refs to hold latest values without causing effect re-runs
  const currentUserUidRef = useRef(currentUserUid);
  const currentUserEmailRef = useRef(currentUserEmail);
  const selectedNodesRef = useRef(selectedNodes);
  const editingNodeIdRef = useRef(editingNodeId);
  const isDraggingRef = useRef(isDragging);
  
  // Keep refs in sync
  currentUserUidRef.current = currentUserUid;
  currentUserEmailRef.current = currentUserEmail;
  selectedNodesRef.current = selectedNodes;
  editingNodeIdRef.current = editingNodeId;
  isDraggingRef.current = isDragging;

  // Derive current activity from state
  const getActivity = useCallback(() => {
    if (editingNodeIdRef.current) return 'editing';
    if (isDraggingRef.current) return 'dragging';
    if (selectedNodesRef.current && selectedNodesRef.current.length > 0) return 'selecting';
    return 'idle';
  }, []);

  // AUTH: subscribe to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUserEmail(user.email);
        setCurrentUserUid(user.uid);
      } else {
        setError("Please log in to access the mind map");
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to nodes in Firestore
  useEffect(() => {
    if (!mindMapId) return;

    setIsLoading(true);
    const q = query(collection(db, "mindMaps", mindMapId, "nodes"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        try {
          const nodesData = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          setRawNodes(nodesData);
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
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        try {
          const linksData = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          setRawLinks(linksData);
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
    const presenceDocRef = doc(db, "mindMaps", mindMapId, "presence", currentUserUid);
    setDoc(presenceDocRef, { email: currentUserEmail, lastActive: serverTimestamp() }, { merge: true }).catch(console.error);
    const intervalId = setInterval(() => {
      setDoc(presenceDocRef, { lastActive: serverTimestamp() }, { merge: true }).catch(console.error);
    }, 5000);
    return () => {
      clearInterval(intervalId);
      deleteDoc(presenceDocRef).catch(console.error);
    };
  }, [mindMapId, currentUserUid, currentUserEmail]);

  // Subscribe to presence users
  useEffect(() => {
    if (!mindMapId) return;
    const q = query(collection(db, "mindMaps", mindMapId, "presence"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map((doc) => doc.data());
      setPresenceUsers(users);
    });
    return () => unsubscribe();
  }, [mindMapId]);

  // Ephemeral Cursor Tracking — push to RTDB with throttled updates
  useEffect(() => {
    if (!mindMapId || !currentUserUid) return;
    const dbRealtime = getDatabase();
    const cursorRef = ref(dbRealtime, `mindMaps/${mindMapId}/cursors/${currentUserUid}`);

    // Set up onDisconnect to auto-remove cursor when connection drops
    onDisconnect(cursorRef).remove().catch(console.error);

    // Throttled push — called by the mouse move handler below
    const pushCursor = throttle(() => {
      if (document.hidden) return;
      const cursor = localCursorRef.current;
      if (cursor.x === undefined || cursor.y === undefined) return;
      
      set(cursorRef, {
        x: cursor.x,
        y: cursor.y,
        email: currentUserEmailRef.current,
        lastActive: Date.now(),
        uid: currentUserUidRef.current,
        activity: getActivity(),
        selectedNodes: (selectedNodesRef.current || []).slice(0, 20), // Cap at 20 to limit data
        editingNodeId: editingNodeIdRef.current || null,
      }).catch(console.error);
    }, 60, { leading: true, trailing: true }); // 60ms throttle (~16fps) — smooth enough

    // Also keep a heartbeat for when mouse isn't moving
    const heartbeatInterval = setInterval(() => {
      if (!document.hidden) {
        pushCursor();
      }
    }, 1000);

    // Store pushCursor on the ref so the mouse move handler can call it
    localCursorRef._pushCursor = pushCursor;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        remove(cursorRef).catch(console.error);
      } else {
        pushCursor();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(heartbeatInterval);
      pushCursor.cancel();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      remove(cursorRef).catch(console.error);
      localCursorRef._pushCursor = null;
    };
  }, [mindMapId, currentUserUid, getActivity]);

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

    onValue(cursorsRef, handleValue, (error) => {
      console.error("Error receiving remote cursor data:", error);
    });

    return () => {
      off(cursorsRef, "value", handleValue);
    };
  }, [mindMapId]);

  // Clean up selectedNodes when nodes change to remove stale node IDs
  useEffect(() => {
    if (selectedNodes.length > 0) {
      const existingNodeIds = new Set(nodes.map((node) => node.id));
      const validSelectedNodes = selectedNodes.filter((nodeId) => existingNodeIds.has(nodeId));
      if (validSelectedNodes.length !== selectedNodes.length) {
        setSelectedNodes(validSelectedNodes);
      }
    }
  }, [nodes]);

  // Global world-coords mouse tracking — uses REFS to avoid stale closures
  useEffect(() => {
    if (!outerRef.current) return;

    const handleGlobalMouseMove = throttle((e) => {
      const container = outerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Use refs for pan/zoom to always have the latest values
      const currentPan = panRef.current;
      const currentZoom = zoomRef.current;
      const worldX = (e.clientX - rect.left - currentPan.x) / currentZoom;
      const worldY = (e.clientY - rect.top - currentPan.y) / currentZoom;
      localCursorRef.current = { x: worldX, y: worldY };
      
      // Immediately trigger a throttled RTDB push
      if (localCursorRef._pushCursor) {
        localCursorRef._pushCursor();
      }
    }, 16);

    document.addEventListener("mousemove", handleGlobalMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      handleGlobalMouseMove.cancel();
    };
  }, []); // No deps — panRef/zoomRef are refs, always up to date
}
