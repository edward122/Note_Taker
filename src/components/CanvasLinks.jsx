// Canvas-based link rendering for high-performance at scale
// Replaces SVG <line> elements with a single <canvas> draw call
import React, { useRef, useEffect, memo } from "react";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "./constants";

const CanvasLinks = memo(({
  visibleLinks,
  nodeMap,
  selectedNodeSet,
  groupDelta,
  containerRef,
}) => {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Cancel any pending frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Size canvas to match the container's world-space needs
      // We use a very large canvas that covers the world area
      // The canvas is positioned at 0,0 in world space and scaled by the parent transform
      const dpr = window.devicePixelRatio || 1;

      // Find the bounding box of all visible link endpoints to size the canvas appropriately
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      const linesToDraw = [];

      for (let i = 0; i < visibleLinks.length; i++) {
        const link = visibleLinks[i];
        const sourceNode = nodeMap.get(link.source);
        const targetNode = nodeMap.get(link.target);
        if (!sourceNode || !targetNode) continue;

        const sourceWidth = sourceNode.width || DEFAULT_WIDTH;
        const sourceHeight = sourceNode.height || DEFAULT_HEIGHT;
        const targetWidth = targetNode.width || DEFAULT_WIDTH;
        const targetHeight = targetNode.height || DEFAULT_HEIGHT;

        const sourceIsSelected = selectedNodeSet.has(sourceNode.id);
        const targetIsSelected = selectedNodeSet.has(targetNode.id);

        const sx = sourceNode.x + (sourceIsSelected ? groupDelta.x : 0);
        const sy = sourceNode.y + (sourceIsSelected ? groupDelta.y : 0);
        const tx = targetNode.x + (targetIsSelected ? groupDelta.x : 0);
        const ty = targetNode.y + (targetIsSelected ? groupDelta.y : 0);

        const x1 = sx + sourceWidth / 2;
        const y1 = sy + sourceHeight / 2;
        const x2 = tx + targetWidth / 2;
        const y2 = ty + targetHeight / 2;

        linesToDraw.push(x1, y1, x2, y2);

        if (x1 < minX) minX = x1;
        if (y1 < minY) minY = y1;
        if (x2 < minX) minX = x2;
        if (y2 < minY) minY = y2;
        if (x1 > maxX) maxX = x1;
        if (y1 > maxY) maxY = y1;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }

      if (linesToDraw.length === 0) {
        canvas.width = 1;
        canvas.height = 1;
        return;
      }

      // Add padding
      const padding = 20;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;

      const width = maxX - minX;
      const height = maxY - minY;

      // Cap canvas size to avoid memory issues, but allow large sizes for big maps
      const maxCanvasSize = 8192;
      const scaleX = width * dpr > maxCanvasSize ? maxCanvasSize / (width * dpr) : 1;
      const scaleY = height * dpr > maxCanvasSize ? maxCanvasSize / (height * dpr) : 1;
      const canvasScale = Math.min(scaleX, scaleY);

      canvas.width = Math.ceil(width * dpr * canvasScale);
      canvas.height = Math.ceil(height * dpr * canvasScale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.left = `${minX}px`;
      canvas.style.top = `${minY}px`;

      ctx.setTransform(dpr * canvasScale, 0, 0, dpr * canvasScale, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Draw all links in a single batch
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.29)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";

      for (let i = 0; i < linesToDraw.length; i += 4) {
        ctx.moveTo(linesToDraw[i] - minX, linesToDraw[i + 1] - minY);
        ctx.lineTo(linesToDraw[i + 2] - minX, linesToDraw[i + 3] - minY);
      }

      ctx.stroke();
    });

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [visibleLinks, nodeMap, selectedNodeSet, groupDelta]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        pointerEvents: "none",
        imageRendering: "auto",
      }}
    />
  );
});

export default CanvasLinks;
