// layoutUtils.js
// layoutUtils.js

/**
 * Computes a pyramid (top-down tree) layout while using the node.parent property (if available)
 * to determine each node’s level.
 * 
 * @param {Array} nodes - Array of node objects (each with id, text, and optionally parent)
 * @param {Array} links - Array of links (each with source and target) — used as a fallback
 * @param {number} levelSpacing - Vertical distance between levels.
 * @param {number} baseWidth - The base canvas width.
 * @param {number} widthScaleFactor - How much the width increases per level.
 * @returns {Object} An object with:
 *    - layout: a mapping from node id to { x, y } coordinates.
 *    - levelMap: a mapping from node id to its computed level.
 */
export const computePyramidLayoutWithLevels = (
    nodes,
    links,
    levelSpacing = 150,
    baseWidth = 800,
    widthScaleFactor = 1.5
  ) => {
    // First, build a level map using node.parent when available.
    const levelMap = {};
  
    // A recursive function that computes the level for a node.
    const assignLevel = (node) => {
      if (node.parent) {
        // If parent's level isn't computed, compute it.
        if (levelMap[node.parent] === undefined) {
          const parentNode = nodes.find((n) => n.id === node.parent);
          // If parent exists, compute its level; otherwise assume level 0.
          if (parentNode) {
            assignLevel(parentNode);
          } else {
            levelMap[node.parent] = 0;
          }
        }
        levelMap[node.id] = levelMap[node.parent] + 1;
      } else {
        levelMap[node.id] = 0;
      }
    };
  
    nodes.forEach((node) => {
      if (levelMap[node.id] === undefined) {
        assignLevel(node);
      }
    });
  
    // Next, group nodes by their computed level.
    const levels = {};
    nodes.forEach((node) => {
      const level = levelMap[node.id];
      if (!levels[level]) levels[level] = [];
      levels[level].push(node.id);
    });
  
    // Now, compute positions for nodes at each level.
    const layout = {};
    Object.keys(levels).forEach((levelKey) => {
      const level = parseInt(levelKey, 10);
      const levelNodes = levels[level];
      const count = levelNodes.length;
      // Compute effective width for this level.
      const effectiveWidth = baseWidth * Math.pow(widthScaleFactor, level);
      levelNodes.forEach((nodeId, index) => {
        // Evenly distribute nodes horizontally, then center them relative to baseWidth.
        const rawX = (index + 1) / (count + 1) * effectiveWidth;
        const x = rawX - effectiveWidth / 2 + baseWidth / 2;
        const y = level * levelSpacing;
        layout[nodeId] = { x, y };
      });
    });
  
    return { layout, levelMap };
  };
  
  
  
  
  
  
  
  