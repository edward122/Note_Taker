// Settings modal for configuring default node preferences
import React, { useState } from 'react';
import { ChromePicker } from 'react-color';
import { DEFAULT_SETTINGS } from '../hooks/useSettings';
import { presetSizes } from './constants';

const FONT_OPTIONS = [
  { value: 'cursive', label: 'Cursive' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Microsoft Yahei', label: 'Microsoft Yahei' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Inter, sans-serif', label: 'Inter' },
];

const ALIGN_OPTIONS = [
  { value: 'left', label: '◧', title: 'Left' },
  { value: 'center', label: '▣', title: 'Center' },
  { value: 'right', label: '◨', title: 'Right' },
];

const STYLE_OPTIONS = [
  { value: 'bold', label: 'B', style: { fontWeight: 'bold' }, title: 'Bold' },
  { value: 'italic', label: 'I', style: { fontStyle: 'italic' }, title: 'Italic' },
  { value: 'underline', label: 'U', style: { textDecoration: 'underline' }, title: 'Underline' },
];

export default function SettingsModal({ settings, updateSettings, resetSettings, onClose }) {
  const [activePicker, setActivePicker] = useState(null); // 'bg' | 'text' | null
  const [activeTab, setActiveTab] = useState('appearance'); // 'appearance' | 'size' | 'advanced'

  const toggleTextStyle = (style) => {
    const current = settings.defaultTextStyle || [];
    const next = current.includes(style)
      ? current.filter((s) => s !== style)
      : [...current, style];
    updateSettings({ defaultTextStyle: next });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <span className="settings-header-icon">⚙️</span>
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close-btn" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="settings-tabs">
          {[
            { id: 'appearance', label: 'Appearance' },
            { id: 'size', label: 'Size' },
            { id: 'advanced', label: 'Advanced' },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="settings-body">
          {/* ── Appearance Tab ── */}
          {activeTab === 'appearance' && (
            <>
              {/* Background Color */}
              <div className="settings-section">
                <label className="settings-label">Default Background</label>
                <div className="settings-color-row">
                  <div
                    className="settings-color-swatch"
                    style={{ backgroundColor: settings.defaultBgColor }}
                    onClick={() => setActivePicker(activePicker === 'bg' ? null : 'bg')}
                  />
                  <span className="settings-color-hex">{settings.defaultBgColor.toUpperCase()}</span>
                </div>
                {activePicker === 'bg' && (
                  <div className="settings-picker-wrap">
                    <ChromePicker
                      color={settings.defaultBgColor}
                      onChange={(c) => updateSettings({ defaultBgColor: c.hex })}
                      disableAlpha
                      styles={{ default: {
                        picker: { backgroundColor: '#1e1e1e', border: 'none', borderRadius: '8px', boxShadow: 'none' },
                        input: { backgroundColor: '#2b2b2b', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '12px' },
                        label: { color: '#ccc', fontSize: '11px' },
                      }}}
                    />
                  </div>
                )}
              </div>

              {/* Text Color */}
              <div className="settings-section">
                <label className="settings-label">Default Text Color</label>
                <div className="settings-color-row">
                  <div
                    className="settings-color-swatch"
                    style={{ backgroundColor: settings.defaultTextColor }}
                    onClick={() => setActivePicker(activePicker === 'text' ? null : 'text')}
                  />
                  <span className="settings-color-hex">{settings.defaultTextColor.toUpperCase()}</span>
                </div>
                {activePicker === 'text' && (
                  <div className="settings-picker-wrap">
                    <ChromePicker
                      color={settings.defaultTextColor}
                      onChange={(c) => updateSettings({ defaultTextColor: c.hex })}
                      disableAlpha
                      styles={{ default: {
                        picker: { backgroundColor: '#1e1e1e', border: 'none', borderRadius: '8px', boxShadow: 'none' },
                        input: { backgroundColor: '#2b2b2b', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '12px' },
                        label: { color: '#ccc', fontSize: '11px' },
                      }}}
                    />
                  </div>
                )}
              </div>

              {/* Font Family */}
              <div className="settings-section">
                <label className="settings-label">Default Font</label>
                <select
                  className="settings-select"
                  value={settings.defaultFontFamily}
                  onChange={(e) => updateSettings({ defaultFontFamily: e.target.value })}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Font Size */}
              <div className="settings-section">
                <label className="settings-label">Default Font Size</label>
                <select
                  className="settings-select"
                  value={settings.defaultFontSize}
                  onChange={(e) => updateSettings({ defaultFontSize: Number(e.target.value) })}
                >
                  {presetSizes.map((s) => (
                    <option key={s} value={s}>{s}px</option>
                  ))}
                </select>
              </div>

              {/* Text Alignment */}
              <div className="settings-section">
                <label className="settings-label">Default Alignment</label>
                <div className="settings-btn-group">
                  {ALIGN_OPTIONS.map((a) => (
                    <button
                      key={a.value}
                      className={`settings-toggle-btn ${settings.defaultTextAlign === a.value ? 'active' : ''}`}
                      onClick={() => updateSettings({ defaultTextAlign: a.value })}
                      title={a.title}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Style */}
              <div className="settings-section">
                <label className="settings-label">Default Text Style</label>
                <div className="settings-btn-group">
                  {STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      className={`settings-toggle-btn ${(settings.defaultTextStyle || []).includes(s.value) ? 'active' : ''}`}
                      onClick={() => toggleTextStyle(s.value)}
                      style={s.style}
                      title={s.title}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview */}
              <div className="settings-section">
                <label className="settings-label">Preview</label>
                <div
                  className="settings-preview-node"
                  style={{
                    backgroundColor: settings.defaultBgColor,
                    color: settings.defaultTextColor,
                    fontFamily: settings.defaultFontFamily,
                    fontSize: `${settings.defaultFontSize}px`,
                    textAlign: settings.defaultTextAlign,
                    fontWeight: (settings.defaultTextStyle || []).includes('bold') ? 'bold' : 'normal',
                    fontStyle: (settings.defaultTextStyle || []).includes('italic') ? 'italic' : 'normal',
                    textDecoration: (settings.defaultTextStyle || []).includes('underline') ? 'underline' : 'none',
                    width: `${Math.min(settings.defaultNodeWidth, 200)}px`,
                    height: `${Math.min(settings.defaultNodeHeight, 80)}px`,
                  }}
                >
                  New Node
                </div>
              </div>
            </>
          )}

          {/* ── Size Tab ── */}
          {activeTab === 'size' && (
            <>
              <div className="settings-section">
                <label className="settings-label">Default Width</label>
                <div className="settings-number-row">
                  <input
                    type="range"
                    className="settings-range"
                    min={60}
                    max={400}
                    value={settings.defaultNodeWidth}
                    onChange={(e) => updateSettings({ defaultNodeWidth: Number(e.target.value) })}
                  />
                  <span className="settings-number-val">{settings.defaultNodeWidth}px</span>
                </div>
              </div>

              <div className="settings-section">
                <label className="settings-label">Default Height</label>
                <div className="settings-number-row">
                  <input
                    type="range"
                    className="settings-range"
                    min={24}
                    max={200}
                    value={settings.defaultNodeHeight}
                    onChange={(e) => updateSettings({ defaultNodeHeight: Number(e.target.value) })}
                  />
                  <span className="settings-number-val">{settings.defaultNodeHeight}px</span>
                </div>
              </div>

              {/* Size Preview */}
              <div className="settings-section">
                <label className="settings-label">Preview</label>
                <div className="settings-size-preview-container">
                  <div
                    className="settings-preview-node"
                    style={{
                      backgroundColor: settings.defaultBgColor,
                      color: settings.defaultTextColor,
                      fontFamily: settings.defaultFontFamily,
                      fontSize: `${settings.defaultFontSize}px`,
                      width: `${Math.min(settings.defaultNodeWidth, 280)}px`,
                      height: `${Math.min(settings.defaultNodeHeight, 120)}px`,
                    }}
                  >
                    New Node
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Advanced Tab ── */}
          {activeTab === 'advanced' && (
            <>
              <div className="settings-section">
                <div className="settings-switch-row">
                  <label className="settings-label" style={{ marginBottom: 0 }}>Snap to Grid</label>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.snapToGrid}
                      onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>
                {settings.snapToGrid && (
                  <div style={{ marginTop: '10px' }}>
                    <label className="settings-label" style={{ fontSize: '12px' }}>Grid Size</label>
                    <div className="settings-number-row">
                      <input
                        type="range"
                        className="settings-range"
                        min={5}
                        max={50}
                        step={5}
                        value={settings.gridSize}
                        onChange={(e) => updateSettings({ gridSize: Number(e.target.value) })}
                      />
                      <span className="settings-number-val">{settings.gridSize}px</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-section">
                <div className="settings-switch-row">
                  <label className="settings-label" style={{ marginBottom: 0 }}>Auto-select New Nodes</label>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.autoSelectNewNodes}
                      onChange={(e) => updateSettings({ autoSelectNewNodes: e.target.checked })}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-switch-row">
                  <label className="settings-label" style={{ marginBottom: 0 }}>Show MiniMap by Default</label>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.showMiniMapByDefault}
                      onChange={(e) => updateSettings({ showMiniMapByDefault: e.target.checked })}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="settings-reset-btn" onClick={resetSettings}>
            Reset to Defaults
          </button>
          <button className="settings-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
