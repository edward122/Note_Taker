// Custom hook for persistent user settings via localStorage
import { useState, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'mindmap-settings';

export const DEFAULT_SETTINGS = {
  // Node Appearance
  defaultBgColor: '#1e1e1e',
  defaultTextColor: '#EAEAEA',
  defaultFontFamily: 'cursive',
  defaultFontSize: 14,
  defaultTextAlign: 'left',
  defaultTextStyle: [],

  // Node Size
  defaultNodeWidth: 100,
  defaultNodeHeight: 40,

  // Advanced / Editor
  snapToGrid: false,
  gridSize: 20,
  autoSelectNewNodes: true,
  showMiniMapByDefault: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    // Merge with defaults so new keys are always present
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    console.warn('Failed to save settings to localStorage');
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState(loadSettings);

  const updateSettings = useCallback((partial) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    setSettingsState({ ...DEFAULT_SETTINGS });
  }, []);

  return useMemo(() => ({
    settings,
    updateSettings,
    resetSettings,
  }), [settings, updateSettings, resetSettings]);
}
