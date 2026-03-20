// Top toolbar bar for the Mind Map Editor
import React from "react";
import { Button, Typography } from "@mui/material";
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import { captureThumbnail, saveThumbnail } from '../utils/thumbnailStore';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/firebase';

const Toolbar = ({
  navigate,
  mindMapId,
  outerRef,
  handleAddNode,
  linkingMode,
  setLinkingMode,
  setLinkingSource,
  linkingSource,
  handleExport,
  handleZoomIn,
  handleZoomOut,
  setShowHotkeyHelp,
  onSettingsOpen,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "50px",
        backgroundColor: "rgba(29,32,34,0.9)",
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
          // Capture thumbnail synchronously before leaving
          if (outerRef?.current && mindMapId) {
            try {
              const dataUrl = captureThumbnail(outerRef.current);
              if (dataUrl) saveThumbnail(mindMapId, dataUrl); // fire-and-forget
            } catch { /* non-blocking */ }
          }
          // Update "last edited" timestamp
          if (mindMapId) {
            updateDoc(doc(db, 'mindMaps', mindMapId), { updatedAt: serverTimestamp() }).catch(() => {});
          }
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
      <div style={{ flex: 1 }} />
      <Button
        variant="contained"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSettingsOpen();
        }}
        style={{ background: "radial-gradient(circle at center,rgba(29, 32, 34, 0) 0%,rgba(56, 60, 63, 0.53) 130%)", minWidth: 'auto', padding: '6px 12px', fontSize: '18px' }}
        title="Settings"
      >
        ⚙️
      </Button>
    </div>
  );
};

export default Toolbar;
