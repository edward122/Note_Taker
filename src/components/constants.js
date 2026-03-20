// Shared constants and utility functions for the Mind Map Editor

export const DEFAULT_WIDTH = 100;
export const DEFAULT_HEIGHT = 40;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
export const ZOOM_STEP = 0.1;
export const MIN_PAN = -200;
export const MAX_PAN = 200;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const isMobile = typeof window !== 'undefined' && 
  (window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent));

export const presetSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];

export const HOTKEYS = {
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

export const rectsIntersect = (rect1, rect2) => {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
};
