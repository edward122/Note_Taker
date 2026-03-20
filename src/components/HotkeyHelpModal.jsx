// Keyboard shortcuts help modal
import React from "react";
import { Typography, Button } from "@mui/material";
import { HOTKEYS } from "./constants";

const HotkeyHelpModal = ({ showHotkeyHelp, setShowHotkeyHelp }) => {
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

export default HotkeyHelpModal;
