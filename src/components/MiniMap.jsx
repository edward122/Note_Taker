// Mini-map navigation component with performance optimizations
import React, { useRef, useMemo, useCallback } from "react";
import { Button } from "@mui/material";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT, isMobile } from "./constants";

export const MiniMap = ({
  nodes,
  links,
  selectedNodes,
  pan,
  zoom,
  outerRef,
  showMiniMap,
  setShowMiniMap,
  setPan,
  panRef,
}) => {
  const miniMapRef = useRef(null);
  const lastUpdateRef = useRef(0);

  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 200, maxY: 150 };
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      const nodeMaxX = node.x + width;
      const nodeMaxY = node.y + height;
      
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (nodeMaxX > maxX) maxX = nodeMaxX;
      if (nodeMaxY > maxY) maxY = nodeMaxY;
    }
    
    const padding = 50;
    return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
  }, [nodes]);

  const miniMapScale = useMemo(() => {
    const mapWidth = 200;
    const mapHeight = 150;
    const worldWidth = bounds.maxX - bounds.minX;
    const worldHeight = bounds.maxY - bounds.minY;
    return Math.min(mapWidth / worldWidth, mapHeight / worldHeight);
  }, [bounds]);

  const handleMiniMapClick = useCallback((e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const now = Date.now();
    if (now - lastUpdateRef.current < 100) return;
    lastUpdateRef.current = now;
    
    const rect = miniMapRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top - 20;
    if (clickY < 0) return;
    
    const worldX = bounds.minX + (clickX / miniMapScale);
    const worldY = bounds.minY + (clickY / miniMapScale);
    
    const outerRect = outerRef.current.getBoundingClientRect();
    const sidebarWidth = 250;
    const topBarHeight = 50;
    const canvasWidth = outerRect.width - sidebarWidth;
    const canvasHeight = outerRect.height - topBarHeight;
    
    const newPan = {
      x: (canvasWidth / 2) - worldX * zoom,
      y: (canvasHeight / 2) - worldY * zoom,
    };
    
    setPan(newPan);
    panRef.current = newPan;
  }, [bounds, miniMapScale, zoom, outerRef, setPan, panRef]);

  const viewportRect = useMemo(() => {
    const outerRect = outerRef.current?.getBoundingClientRect();
    if (!outerRect) return { x: 0, y: 0, width: 0, height: 0 };
    
    const sidebarWidth = 250;
    const topBarHeight = 50;
    const canvasWidth = outerRect.width - sidebarWidth;
    const canvasHeight = outerRect.height - topBarHeight;
    
    const visibleMinX = (-pan.x) / zoom;
    const visibleMinY = (-pan.y) / zoom;
    const visibleMaxX = visibleMinX + canvasWidth / zoom;
    const visibleMaxY = visibleMinY + canvasHeight / zoom;
    
    return {
      x: (visibleMinX - bounds.minX) * miniMapScale,
      y: (visibleMinY - bounds.minY) * miniMapScale,
      width: (visibleMaxX - visibleMinX) * miniMapScale,
      height: (visibleMaxY - visibleMinY) * miniMapScale,
    };
  }, [
    Math.round(pan.x / 10) * 10,
    Math.round(pan.y / 10) * 10,
    Math.round(zoom * 100) / 100,
    bounds, miniMapScale
  ]);

  const nodeRenderData = useMemo(() => {
    const selectedSet = new Set(selectedNodes);
    return nodes.map(node => ({
      id: node.id,
      x: (node.x - bounds.minX) * miniMapScale,
      y: (node.y - bounds.minY) * miniMapScale,
      width: Math.max(1, ((node.width || DEFAULT_WIDTH) * miniMapScale)),
      height: Math.max(1, ((node.height || DEFAULT_HEIGHT) * miniMapScale)),
      bgColor: node.bgColor || '#666',
      isSelected: selectedSet.has(node.id),
      zIndex: node.zIndex || 1
    })).filter(node => 
      node.x > -node.width && node.y > -node.height && 
      node.x < 200 + node.width && node.y < 130 + node.height
    );
  }, [nodes, bounds, miniMapScale, selectedNodes]);

  const linkRenderData = useMemo(() => {
    if (links.length > 300 || nodes.length > 2000) return [];
    // Build local nodeMap for O(1) lookups
    const localNodeMap = new Map(nodes.map(n => [n.id, n]));
    return links.map(link => {
      const sourceNode = localNodeMap.get(link.source);
      const targetNode = localNodeMap.get(link.target);
      if (!sourceNode || !targetNode) return null;
      
      const x1 = (sourceNode.x - bounds.minX) * miniMapScale + ((sourceNode.width || DEFAULT_WIDTH) * miniMapScale) / 2;
      const y1 = (sourceNode.y - bounds.minY) * miniMapScale + ((sourceNode.height || DEFAULT_HEIGHT) * miniMapScale) / 2;
      const x2 = (targetNode.x - bounds.minX) * miniMapScale + ((targetNode.width || DEFAULT_WIDTH) * miniMapScale) / 2;
      const y2 = (targetNode.y - bounds.minY) * miniMapScale + ((targetNode.height || DEFAULT_HEIGHT) * miniMapScale) / 2;
      
      if ((x1 < 0 && x2 < 0) || (x1 > 200 && x2 > 200) || (y1 < 0 && y2 < 0) || (y1 > 130 && y2 > 130)) return null;
      
      return {
        id: link.id,
        x1: Math.max(0, Math.min(200, x1)),
        y1: Math.max(0, Math.min(130, y1)),
        x2: Math.max(0, Math.min(200, x2)),
        y2: Math.max(0, Math.min(130, y2))
      };
    }).filter(Boolean);
  }, [links, nodes, bounds, miniMapScale]);

  if (!showMiniMap || nodes.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: '20px', right: isMobile ? '20px' : '280px',
        width: '200px', height: '150px', backgroundColor: 'rgba(0, 0, 0, 0.9)',
        border: '2px solid #444', borderRadius: '8px', overflow: 'hidden',
        zIndex: 1000, cursor: 'pointer', transition: 'transform 0.1s ease-out, box-shadow 0.1s ease-out',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
      onMouseDown={handleMiniMapClick}
      ref={miniMapRef}
    >
      <div 
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '20px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 8px', fontSize: '10px', color: '#ccc',
          zIndex: 1001, cursor: 'default',
        }}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <span>Mini Map ({nodeRenderData.length} nodes)</span>
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setShowMiniMap(false); }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
          style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '12px', padding: '2px 4px', borderRadius: '2px' }}
        >
          ✕
        </button>
      </div>

      <svg width="200" height="150"
        style={{ position: 'absolute', top: '20px', cursor: 'pointer', pointerEvents: 'auto' }}
        onMouseDown={(e) => { e.stopPropagation(); handleMiniMapClick(e); }}
      >
        {nodeRenderData.sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1)).map((node) => (
          <rect key={node.id} x={node.x} y={node.y} width={node.width} height={node.height}
            fill={node.isSelected ? '#4CAF50' : node.bgColor}
            stroke={node.isSelected ? '#8BC34A' : 'none'}
            strokeWidth={node.isSelected ? "0.5" : "0"} opacity="0.8"
          />
        ))}
        {linkRenderData.map(link => (
          <line key={link.id} x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}
            stroke="#555" strokeWidth="0.5" opacity="0.4"
          />
        ))}
        <rect
          x={Math.max(0, Math.min(200, viewportRect.x))}
          y={Math.max(0, Math.min(130, viewportRect.y))}
          width={Math.max(0, Math.min(200 - Math.max(0, viewportRect.x), viewportRect.width))}
          height={Math.max(0, Math.min(130 - Math.max(0, viewportRect.y), viewportRect.height))}
          fill="none" stroke="#4CAF50" strokeWidth="1" strokeDasharray="2,2" opacity="0.8"
        />
      </svg>
    </div>
  );
};

export const MiniMapToggle = ({ showMiniMap, setShowMiniMap, nodeCount }) => {
  const shouldAutoHide = nodeCount > 1000;
  
  if (showMiniMap || nodeCount === 0) return null;

  return (
    <Button
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowMiniMap(true); }}
      style={{
        position: 'fixed', bottom: '20px', right: isMobile ? '20px' : '280px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#fff', minWidth: 'auto',
        padding: '8px', borderRadius: '4px', zIndex: 1000, transition: 'all 0.2s ease',
      }}
      title={shouldAutoHide ? "Show Mini Map (Large dataset - may impact performance)" : "Show Mini Map"}
    >
      🗺️ {shouldAutoHide && <span style={{fontSize: '10px'}}>⚠️</span>}
    </Button>
  );
};
