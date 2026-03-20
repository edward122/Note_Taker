// src/components/RemoteCursors.jsx
import React, { memo, useRef, useEffect, useState, useCallback } from "react";

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#FF8A5C', '#EA6F9A', '#7EC8E3',
];

// Assign stable colors based on uid hash
function getColorForUid(uid) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    hash |= 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

const ACTIVITY_ICONS = {
  editing: '✏️',
  selecting: '🔲',
  dragging: '✊',
  idle: null,
};

// Individual remote cursor component with smooth animation
const RemoteCursor = memo(({ cursor, zoom, pan }) => {
  const screenX = cursor.x * zoom + pan.x;
  const screenY = cursor.y * zoom + pan.y;
  const userColor = getColorForUid(cursor.uid);
  const userName = cursor.email ? cursor.email.split('@')[0] : 'User';
  const activity = cursor.activity || 'idle';
  const activityIcon = ACTIVITY_ICONS[activity];
  const isStale = Date.now() - cursor.lastActive > 3000;

  return (
    <div
      className="remote-cursor"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: `translate(${screenX}px, ${screenY}px)`,
        transition: "transform 0.08s linear",
        pointerEvents: "none",
        zIndex: 10000,
        opacity: isStale ? 0.4 : 1,
      }}
    >
      {/* SVG cursor arrow */}
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        fill="none"
        style={{ filter: `drop-shadow(0 1px 3px rgba(0,0,0,0.4))` }}
      >
        <path
          d="M2 1L18 12L10 13L7 22L2 1Z"
          fill={userColor}
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* Name + activity badge */}
      <div
        className="remote-cursor-label"
        style={{
          position: 'absolute',
          top: '18px',
          left: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: userColor,
          color: '#fff',
          padding: '2px 8px 2px 6px',
          borderRadius: '10px',
          fontSize: '11px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          letterSpacing: '0.2px',
          lineHeight: '16px',
        }}
      >
        {activityIcon && <span style={{ fontSize: '10px' }}>{activityIcon}</span>}
        {userName}
      </div>
    </div>
  );
});

RemoteCursor.displayName = 'RemoteCursor';

// Container component that renders all remote cursors
const RemoteCursors = memo(({ cursors, currentUserUid, zoom, pan }) => {
  const now = Date.now();
  const activeThreshold = 8000; // 8 seconds before hiding

  const activeCursors = cursors.filter(
    (cursor) =>
      cursor.uid !== currentUserUid &&
      cursor.x !== undefined &&
      cursor.y !== undefined &&
      now - cursor.lastActive < activeThreshold
  );

  if (activeCursors.length === 0) return null;

  return (
    <>
      {activeCursors.map((cursor) => (
        <RemoteCursor
          key={cursor.uid}
          cursor={cursor}
          zoom={zoom}
          pan={pan}
        />
      ))}
    </>
  );
});

RemoteCursors.displayName = 'RemoteCursors';

// Component to show remote user selections on nodes
export const RemoteSelectionOverlays = memo(({ cursors, currentUserUid, nodeMap }) => {
  const now = Date.now();
  const activeThreshold = 8000;

  const overlays = [];

  cursors.forEach((cursor) => {
    if (cursor.uid === currentUserUid) return;
    if (now - cursor.lastActive > activeThreshold) return;
    if (!cursor.selectedNodes || cursor.selectedNodes.length === 0) return;

    const userColor = getColorForUid(cursor.uid);
    const userName = cursor.email ? cursor.email.split('@')[0] : 'User';

    cursor.selectedNodes.forEach((nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      overlays.push(
        <div
          key={`${cursor.uid}-${nodeId}`}
          className="remote-selection-overlay"
          style={{
            position: 'absolute',
            left: node.x - 3,
            top: node.y - 3,
            width: (node.width || 100) + 6,
            height: (node.height || 40) + 6,
            border: `2px solid ${userColor}`,
            borderRadius: '8px',
            pointerEvents: 'none',
            zIndex: 99,
            boxShadow: `0 0 8px ${userColor}40`,
            transition: 'all 0.15s ease',
          }}
        >
          {/* Small user tag */}
          <div
            style={{
              position: 'absolute',
              top: -18,
              left: -2,
              backgroundColor: userColor,
              color: '#fff',
              fontSize: '9px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '4px 4px 0 0',
              whiteSpace: 'nowrap',
              lineHeight: '14px',
            }}
          >
            {userName}
          </div>
        </div>
      );
    });
  });

  if (overlays.length === 0) return null;
  return <>{overlays}</>;
});

RemoteSelectionOverlays.displayName = 'RemoteSelectionOverlays';

export { getColorForUid };
export default RemoteCursors;
