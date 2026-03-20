// State manager classes and hooks for optimized node/link management
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "../components/constants";

// ===== NODE STATE MANAGER =====

/**
 * Immutable state updater with structural sharing
 * Only creates new objects for changed nodes, keeps unchanged nodes as-is
 */
export class NodeStateManager {
  constructor() {
    this.nodeMap = new Map();
    this.changeQueue = new Map();
    this.batchTimeout = null;
    this.subscribers = new Set();
  }

  setNodes(nodes) {
    this.nodeMap.clear();
    nodes.forEach(node => {
      this.nodeMap.set(node.id, node);
    });
    this.notifySubscribers();
  }

  getNodes() {
    return Array.from(this.nodeMap.values());
  }

  getNode(id) {
    return this.nodeMap.get(id);
  }

  updateNode(id, updates, immediate = false) {
    const currentNode = this.nodeMap.get(id);
    if (!currentNode) return false;

    const hasChanges = Object.keys(updates).some(key => 
      currentNode[key] !== updates[key]
    );
    
    if (!hasChanges) return false;

    if (immediate) {
      const updatedNode = { ...currentNode, ...updates };
      this.nodeMap.set(id, updatedNode);
      this.notifySubscribers();
      return true;
    } else {
      this.queueChange(id, updates);
      return true;
    }
  }

  updateNodes(nodeUpdates, immediate = false) {
    let hasAnyChanges = false;

    for (const [id, updates] of Object.entries(nodeUpdates)) {
      const currentNode = this.nodeMap.get(id);
      if (!currentNode) continue;

      const hasChanges = Object.keys(updates).some(key => 
        currentNode[key] !== updates[key]
      );
      
      if (!hasChanges) continue;

      if (immediate) {
        const updatedNode = { ...currentNode, ...updates };
        this.nodeMap.set(id, updatedNode);
        hasAnyChanges = true;
      } else {
        this.queueChange(id, updates);
        hasAnyChanges = true;
      }
    }

    if (immediate && hasAnyChanges) {
      this.notifySubscribers();
    }

    return hasAnyChanges;
  }

  queueChange(id, updates) {
    const existing = this.changeQueue.get(id) || {};
    this.changeQueue.set(id, { ...existing, ...updates });

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatchedChanges();
    }, 16);
  }

  processBatchedChanges() {
    if (this.changeQueue.size === 0) return;

    let hasChanges = false;
    for (const [id, updates] of this.changeQueue) {
      const currentNode = this.nodeMap.get(id);
      if (currentNode) {
        const updatedNode = { ...currentNode, ...updates };
        this.nodeMap.set(id, updatedNode);
        hasChanges = true;
      }
    }

    this.changeQueue.clear();
    this.batchTimeout = null;

    if (hasChanges) {
      this.notifySubscribers();
    }
  }

  addNode(node) {
    this.nodeMap.set(node.id, node);
    this.notifySubscribers();
  }

  removeNode(id) {
    const existed = this.nodeMap.delete(id);
    if (existed) {
      this.notifySubscribers();
    }
    return existed;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    const nodes = this.getNodes();
    this.subscribers.forEach(callback => callback(nodes));
  }

  flush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.processBatchedChanges();
    }
  }

  getNodesByIds(ids) {
    return ids.map(id => this.nodeMap.get(id)).filter(Boolean);
  }

  hasNode(id) {
    return this.nodeMap.has(id);
  }

  size() {
    return this.nodeMap.size;
  }
}

// ===== LINKS STATE MANAGER =====

export class LinksStateManager {
  constructor() {
    this.linkMap = new Map();
    this.sourceMap = new Map();
    this.targetMap = new Map();
    this.changeQueue = new Map();
    this.batchTimeout = null;
    this.subscribers = new Set();
  }

  setLinks(links) {
    this.linkMap.clear();
    this.sourceMap.clear();
    this.targetMap.clear();
    
    links.forEach(link => {
      this.linkMap.set(link.id, link);
      
      if (!this.sourceMap.has(link.source)) {
        this.sourceMap.set(link.source, new Set());
      }
      this.sourceMap.get(link.source).add(link.id);
      
      if (!this.targetMap.has(link.target)) {
        this.targetMap.set(link.target, new Set());
      }
      this.targetMap.get(link.target).add(link.id);
    });
    
    this.notifySubscribers();
  }

  getLinks() {
    return Array.from(this.linkMap.values());
  }

  getLink(id) {
    return this.linkMap.get(id);
  }

  getLinksBySource(nodeId) {
    const linkIds = this.sourceMap.get(nodeId);
    if (!linkIds) return [];
    return Array.from(linkIds).map(id => this.linkMap.get(id)).filter(Boolean);
  }

  getLinksByTarget(nodeId) {
    const linkIds = this.targetMap.get(nodeId);
    if (!linkIds) return [];
    return Array.from(linkIds).map(id => this.linkMap.get(id)).filter(Boolean);
  }

  getLinksByNode(nodeId) {
    const sourceLinks = this.getLinksBySource(nodeId);
    const targetLinks = this.getLinksByTarget(nodeId);
    const allLinks = [...sourceLinks, ...targetLinks];
    return allLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.id === link.id)
    );
  }

  updateLink(id, updates, immediate = false) {
    const currentLink = this.linkMap.get(id);
    if (!currentLink) return false;

    const hasChanges = Object.keys(updates).some(key => 
      currentLink[key] !== updates[key]
    );
    
    if (!hasChanges) return false;

    if (immediate) {
      const updatedLink = { ...currentLink, ...updates };
      this._updateLinkInMaps(currentLink, updatedLink);
      this.notifySubscribers();
      return true;
    } else {
      this.queueChange(id, updates);
      return true;
    }
  }

  _updateLinkInMaps(oldLink, newLink) {
    if (oldLink.source !== newLink.source) {
      const oldSourceSet = this.sourceMap.get(oldLink.source);
      if (oldSourceSet) {
        oldSourceSet.delete(oldLink.id);
        if (oldSourceSet.size === 0) {
          this.sourceMap.delete(oldLink.source);
        }
      }
      
      if (!this.sourceMap.has(newLink.source)) {
        this.sourceMap.set(newLink.source, new Set());
      }
      this.sourceMap.get(newLink.source).add(newLink.id);
    }

    if (oldLink.target !== newLink.target) {
      const oldTargetSet = this.targetMap.get(oldLink.target);
      if (oldTargetSet) {
        oldTargetSet.delete(oldLink.id);
        if (oldTargetSet.size === 0) {
          this.targetMap.delete(oldLink.target);
        }
      }
      
      if (!this.targetMap.has(newLink.target)) {
        this.targetMap.set(newLink.target, new Set());
      }
      this.targetMap.get(newLink.target).add(newLink.id);
    }

    this.linkMap.set(newLink.id, newLink);
  }

  queueChange(id, updates) {
    const existing = this.changeQueue.get(id) || {};
    this.changeQueue.set(id, { ...existing, ...updates });

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatchedChanges();
    }, 16);
  }

  processBatchedChanges() {
    if (this.changeQueue.size === 0) return;

    let hasChanges = false;
    for (const [id, updates] of this.changeQueue) {
      const currentLink = this.linkMap.get(id);
      if (currentLink) {
        const updatedLink = { ...currentLink, ...updates };
        this._updateLinkInMaps(currentLink, updatedLink);
        hasChanges = true;
      }
    }

    this.changeQueue.clear();
    this.batchTimeout = null;

    if (hasChanges) {
      this.notifySubscribers();
    }
  }

  addLink(link) {
    this.linkMap.set(link.id, link);
    
    if (!this.sourceMap.has(link.source)) {
      this.sourceMap.set(link.source, new Set());
    }
    this.sourceMap.get(link.source).add(link.id);
    
    if (!this.targetMap.has(link.target)) {
      this.targetMap.set(link.target, new Set());
    }
    this.targetMap.get(link.target).add(link.id);
    
    this.notifySubscribers();
  }

  removeLink(id) {
    const link = this.linkMap.get(id);
    if (!link) return false;

    this.linkMap.delete(id);
    
    const sourceSet = this.sourceMap.get(link.source);
    if (sourceSet) {
      sourceSet.delete(id);
      if (sourceSet.size === 0) {
        this.sourceMap.delete(link.source);
      }
    }
    
    const targetSet = this.targetMap.get(link.target);
    if (targetSet) {
      targetSet.delete(id);
      if (targetSet.size === 0) {
        this.targetMap.delete(link.target);
      }
    }
    
    this.notifySubscribers();
    return true;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    const links = this.getLinks();
    this.subscribers.forEach(callback => callback(links));
  }

  flush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.processBatchedChanges();
    }
  }

  size() {
    return this.linkMap.size;
  }

  hasLink(id) {
    return this.linkMap.has(id);
  }

  removeLinksForNode(nodeId) {
    const connectedLinks = this.getLinksByNode(nodeId);
    connectedLinks.forEach(link => this.removeLink(link.id));
  }
}

// ===== HOOKS =====

export const useOptimizedNodes = (initialNodes = []) => {
  const stateManagerRef = useRef(null);
  const [nodes, setNodesState] = useState(initialNodes);

  if (!stateManagerRef.current) {
    stateManagerRef.current = new NodeStateManager();
    stateManagerRef.current.setNodes(initialNodes);
  }

  useEffect(() => {
    const unsubscribe = stateManagerRef.current.subscribe((newNodes) => {
      setNodesState(newNodes);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    stateManagerRef.current.setNodes(initialNodes);
  }, [initialNodes]);

  const updateNode = useCallback((id, updates, immediate = false) => {
    return stateManagerRef.current.updateNode(id, updates, immediate);
  }, []);

  const updateNodes = useCallback((nodeUpdates, immediate = false) => {
    return stateManagerRef.current.updateNodes(nodeUpdates, immediate);
  }, []);

  const addNode = useCallback((node) => {
    stateManagerRef.current.addNode(node);
  }, []);

  const removeNode = useCallback((id) => {
    return stateManagerRef.current.removeNode(id);
  }, []);

  const getNode = useCallback((id) => {
    return stateManagerRef.current.getNode(id);
  }, []);

  const getNodesByIds = useCallback((ids) => {
    return stateManagerRef.current.getNodesByIds(ids);
  }, []);

  const flush = useCallback(() => {
    stateManagerRef.current.flush();
  }, []);

  return {
    nodes,
    updateNode,
    updateNodes,
    addNode,
    removeNode,
    getNode,
    getNodesByIds,
    flush,
    stateManager: stateManagerRef.current
  };
};

export const useOptimizedLinks = (initialLinks = []) => {
  const stateManagerRef = useRef(null);
  const [links, setLinksState] = useState(initialLinks);

  if (!stateManagerRef.current) {
    stateManagerRef.current = new LinksStateManager();
    stateManagerRef.current.setLinks(initialLinks);
  }

  useEffect(() => {
    const unsubscribe = stateManagerRef.current.subscribe((newLinks) => {
      setLinksState(newLinks);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    stateManagerRef.current.setLinks(initialLinks);
  }, [initialLinks]);

  const updateLink = useCallback((id, updates, immediate = false) => {
    return stateManagerRef.current.updateLink(id, updates, immediate);
  }, []);

  const addLink = useCallback((link) => {
    stateManagerRef.current.addLink(link);
  }, []);

  const removeLink = useCallback((id) => {
    return stateManagerRef.current.removeLink(id);
  }, []);

  const getLink = useCallback((id) => {
    return stateManagerRef.current.getLink(id);
  }, []);

  const getLinksBySource = useCallback((nodeId) => {
    return stateManagerRef.current.getLinksBySource(nodeId);
  }, []);

  const getLinksByTarget = useCallback((nodeId) => {
    return stateManagerRef.current.getLinksByTarget(nodeId);
  }, []);

  const getLinksByNode = useCallback((nodeId) => {
    return stateManagerRef.current.getLinksByNode(nodeId);
  }, []);

  const removeLinksForNode = useCallback((nodeId) => {
    return stateManagerRef.current.removeLinksForNode(nodeId);
  }, []);

  const flush = useCallback(() => {
    stateManagerRef.current.flush();
  }, []);

  return {
    links,
    updateLink,
    addLink,
    removeLink,
    getLink,
    getLinksBySource,
    getLinksByTarget,
    getLinksByNode,
    removeLinksForNode,
    flush,
    stateManager: stateManagerRef.current
  };
};

export const useVisibleNodes = (nodes, pan, zoom, containerRef) => {
  return useMemo(() => {
    if (!containerRef.current || nodes.length === 0) return nodes;

    const rect = containerRef.current.getBoundingClientRect();
    const buffer = Math.max(50, 200 / zoom);
    
    const visibleLeft = -pan.x / zoom - buffer;
    const visibleTop = -pan.y / zoom - buffer;
    const visibleWidth = rect.width / zoom + buffer * 2;
    const visibleHeight = rect.height / zoom + buffer * 2;

    return nodes.filter((node) => {
      const width = node.width || DEFAULT_WIDTH;
      const height = node.height || DEFAULT_HEIGHT;
      return (
        node.x + width >= visibleLeft &&
        node.x <= visibleLeft + visibleWidth &&
        node.y + height >= visibleTop &&
        node.y <= visibleTop + visibleHeight
      );
    });
  }, [nodes, Math.round(pan.x / 50) * 50, Math.round(pan.y / 50) * 50, Math.round(zoom * 20) / 20, containerRef]);
};

export const useVisibleLinks = (links, visibleNodeIds) => {
  return useMemo(() => {
    if (!visibleNodeIds || visibleNodeIds.size === 0) return [];
    
    return links.filter(link => 
      visibleNodeIds.has(link.source) || visibleNodeIds.has(link.target)
    );
  }, [links, visibleNodeIds]);
};

export const useNodeSelector = (nodes, selector, deps = []) => {
  return useMemo(() => selector(nodes), [nodes, ...deps]);
};
