import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button, TextField, ToggleButtonGroup, ToggleButton, styled } from "@mui/material";
import { ArrowDropUp, ArrowDropDown, Close } from "@mui/icons-material";
import FilterListIcon from '@mui/icons-material/FilterList';
import BorderClearIcon from '@mui/icons-material/BorderClear';
import Paper from '@mui/material/Paper';
// Import your Firebase functions as needed
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase";
// Dummy API call that simulates generating a mind map JSON from a prompt.
// Replace this with your actual API integration.
import { getDatabase, ref, get } from "firebase/database";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebase";



const fetchApiData = async (getWhat) => {
  const dbRealtime = getDatabase();
  const apiKeyRef = ref(dbRealtime, `Settings/${getWhat}`);
  try {
    const snapshot = await get(apiKeyRef);
    if (snapshot.exists()) {
      return snapshot.val(); // This is your actual API key as a string.
    } else {
      throw new Error("API key not found in database");
    }
  } catch (error) {
    console.error("Error fetching API key:", error);
    throw error;
  }
};

const ChatBox = ({
  localCursor,
  canvasCenter,
  mergeMindMapData,
  isChatOpen,
  setIsChatOpen,
  selectedNodes = [],
  nodes = [],
  setNodes,
  mindMapId,
  updateNodeText,
  addNode,
  addLink,
  pushToUndoStack,
}) => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLog, setChatLog] = useState([]);
  const chatLogRef = useRef(null);

  // Function to scroll chat to bottom
  const scrollToBottom = () => {
    if (chatLogRef.current) {
      setTimeout(() => {
        chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
      }, 100);
    }
  };

  const handleEditNodes = async (editNodes) => {
    if (!updateNodeText) {
      console.error("updateNodeText function not provided");
      return;
    }
    
    // Filter out nodes that don't exist in the current nodes array
    const validEditNodes = editNodes.filter(editNode => {
      const nodeExists = nodes.some(node => node.id === editNode.id);
      if (!nodeExists) {
        console.warn(`Skipping edit for non-existent node: ${editNode.id}`);
      }
      return nodeExists;
    });
    
    if (validEditNodes.length === 0) {
      console.warn("No valid nodes to edit");
      return;
    }
    
    // Push to undo stack before making changes (only once for the batch)
    if (pushToUndoStack && validEditNodes.length > 0) {
      pushToUndoStack();
    }
    
    // Update each valid node's text (using batch version that doesn't push to undo individually)
    for (const editNode of validEditNodes) {
      try {
        await updateNodeText(editNode.id, editNode.newText);
      } catch (error) {
        console.error(`Failed to update node ${editNode.id}:`, error);
        // Continue with other nodes even if one fails
      }
    }
    
    // Log results
    const successCount = validEditNodes.length;
    const skippedCount = editNodes.length - validEditNodes.length;
    if (skippedCount > 0) {
      console.log(`Updated ${successCount} nodes, skipped ${skippedCount} non-existent nodes`);
    }
  };

  const validateAndFixStyleProps = (styleProps) => {
    const validFontFamilies = ["cursive", "Microsoft Yahei", "Arial", "Times New Roman", "Courier New"];
    const fixedProps = { ...styleProps };
    
    // Validate and fix fontFamily
    if (fixedProps.fontFamily && !validFontFamilies.includes(fixedProps.fontFamily)) {
      console.warn(`Invalid fontFamily "${fixedProps.fontFamily}", using "Arial" instead`);
      fixedProps.fontFamily = "Arial";
    }
    
    return fixedProps;
  };

  const handleStyleNodes = async (styleNodes) => {
    if (!updateNodeText) {
      console.error("updateNodeText function not provided");
      return;
    }
    
    // Filter out nodes that don't exist in the current nodes array
    const validStyleNodes = styleNodes.filter(styleNode => {
      const nodeExists = nodes.some(node => node.id === styleNode.id);
      if (!nodeExists) {
        console.warn(`Skipping style for non-existent node: ${styleNode.id}`);
      }
      return nodeExists;
    });
    
    if (validStyleNodes.length === 0) {
      console.warn("No valid nodes to style");
      return;
    }
    
    // Push to undo stack before making changes (only once for the batch)
    if (pushToUndoStack && validStyleNodes.length > 0) {
      pushToUndoStack();
    }
    
    // Style each valid node
    for (const styleNode of validStyleNodes) {
      try {
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", styleNode.id);
        
        // Build update object with only the properties that were provided
        const updateData = { lastModified: serverTimestamp() };
        const { id, ...styleProps } = styleNode; // Remove id from style properties
        
        // Validate and fix style properties
        const validatedProps = validateAndFixStyleProps(styleProps);
        
        // Add each style property if it exists
        Object.keys(validatedProps).forEach(key => {
          if (validatedProps[key] !== undefined && validatedProps[key] !== null) {
            updateData[key] = validatedProps[key];
          }
        });
        
        await updateDoc(nodeRef, updateData);
        
        // Update local state
        setNodes((prev) =>
          prev.map((n) => (n.id === styleNode.id ? { ...n, ...validatedProps } : n))
        );
      } catch (error) {
        console.error(`Failed to style node ${styleNode.id}:`, error);
        // Continue with other nodes even if one fails
      }
    }
    
    // Log results
    const successCount = validStyleNodes.length;
    const skippedCount = styleNodes.length - validStyleNodes.length;
    if (skippedCount > 0) {
      console.log(`Styled ${successCount} nodes, skipped ${skippedCount} non-existent nodes`);
    }
  };

  const handleMoveNodes = async (moveNodes) => {
    if (!updateNodeText) {
      console.error("updateNodeText function not provided");
      return;
    }
    
    // Filter out nodes that don't exist in the current nodes array
    const validMoveNodes = moveNodes.filter(moveNode => {
      const nodeExists = nodes.some(node => node.id === moveNode.id);
      if (!nodeExists) {
        console.warn(`Skipping move for non-existent node: ${moveNode.id}`);
      }
      return nodeExists;
    });
    
    if (validMoveNodes.length === 0) {
      console.warn("No valid nodes to move");
      return;
    }
    
    // Push to undo stack before making changes (only once for the batch)
    if (pushToUndoStack && validMoveNodes.length > 0) {
      pushToUndoStack();
    }
    
    // Move each valid node to its new position
    for (const moveNode of validMoveNodes) {
      try {
        // Use the updateNodeText function but for position updates
        const nodeRef = doc(db, "mindMaps", mindMapId, "nodes", moveNode.id);
        await updateDoc(nodeRef, {
          x: moveNode.x,
          y: moveNode.y,
          lastModified: serverTimestamp(),
        });
        
        // Update local state
        setNodes((prev) =>
          prev.map((n) => (n.id === moveNode.id ? { ...n, x: moveNode.x, y: moveNode.y } : n))
        );
      } catch (error) {
        console.error(`Failed to move node ${moveNode.id}:`, error);
        // Continue with other nodes even if one fails
      }
    }
    
    // Log results
    const successCount = validMoveNodes.length;
    const skippedCount = moveNodes.length - validMoveNodes.length;
    if (skippedCount > 0) {
      console.log(`Moved ${successCount} nodes, skipped ${skippedCount} non-existent nodes`);
    }
  };

  const handleAddNodes = async (newNodes, newLinks) => {
    if (!addNode || !addLink) {
      console.error("addNode or addLink functions not provided");
      return;
    }
    
    // Push to undo stack before making changes (only once for the entire operation)
    if (pushToUndoStack && (newNodes.length > 0 || (newLinks && newLinks.length > 0))) {
      pushToUndoStack();
    }
    
    // Create a mapping from AI-generated IDs to Firebase-generated IDs
    const idMapping = {};
    
    // Get selected nodes data for context - only include nodes that actually exist
    const selectedNodesData = selectedNodes.map(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) {
        console.warn(`Selected node ${nodeId} not found in nodes array`);
        return null;
      }
      return {
        id: node.id,
        text: node.text || "Untitled",
        x: node.x,
        y: node.y,
        bgColor: node.bgColor,
        textColor: node.textColor,
        fontSize: node.fontSize,
        fontFamily: node.fontFamily,
        width: node.width,
        height: node.height,
        type: node.type, // Include node type (text, image, etc.)
        imageUrl: node.imageUrl, // Include image URL if it's an image node
        storagePath: node.storagePath // Include storage path for image nodes
      };
    }).filter(Boolean);
    
    // If no valid selected nodes, log warning
    if (selectedNodes.length > 0 && selectedNodesData.length === 0) {
      console.warn("No valid selected nodes found");
    }
    
    // Add each new node and track ID mapping (using batch version that doesn't push to undo individually)
    for (const node of newNodes) {
      // Check if this node has generated image data
      if (node.imageData) {
        try {
          // Upload the generated image
          const { downloadURL, storagePath } = await uploadGeneratedImage(node.imageData, node.id);
          
          // Create image node
          const imageNode = {
            type: "image",
            imageUrl: downloadURL,
            storagePath: storagePath,
            x: node.x,
            y: node.y,
            width: node.width || 200,
            height: node.height || 150,
            lockedBy: null,
            typing: false
          };
          
          const firebaseId = await addNode(imageNode);
          idMapping[node.id] = firebaseId;
        } catch (error) {
          console.error(`Failed to create image node ${node.id}:`, error);
          // Continue with other nodes even if one fails
        }
      } else if (node.imagePrompt || node.imageEditPrompt) {
        try {
          let imageData;
          
          if (node.imageEditPrompt) {
            // Image editing: find the original image from selected nodes
            const originalImageNode = selectedNodesData.find(n => n.type === 'image' && n.imageUrl);
            if (originalImageNode) {
              // Get the original image base64 data
              const imageUrl = originalImageNode.imageUrl.includes('firebasestorage.googleapis.com') 
                ? `/firebase-storage${originalImageNode.imageUrl.split('firebasestorage.googleapis.com')[1]}`
                : originalImageNode.imageUrl;
              
              const response = await fetch(imageUrl);
              if (response.ok) {
                const blob = await response.blob();
                const originalImageBase64 = await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result.split(',')[1]);
                  reader.readAsDataURL(blob);
                });
                
                console.log(`Editing image for node ${node.id} with prompt: ${node.imageEditPrompt}`);
                imageData = await generateImage(node.imageEditPrompt, originalImageBase64);
              } else {
                throw new Error("Could not fetch original image for editing");
              }
            } else {
              throw new Error("No original image found for editing");
            }
          } else {
            // New image generation
            console.log(`Generating image for node ${node.id} with prompt: ${node.imagePrompt}`);
            imageData = await generateImage(node.imagePrompt);
          }
          
          // Upload the generated/edited image
          const { downloadURL, storagePath } = await uploadGeneratedImage(imageData, node.id);
          
          // Create image node
          const imageNode = {
            type: "image",
            imageUrl: downloadURL,
            storagePath: storagePath,
            x: node.x,
            y: node.y,
            width: node.width || 200,
            height: node.height || 150,
            lockedBy: null,
            typing: false
          };
          
          const firebaseId = await addNode(imageNode);
          idMapping[node.id] = firebaseId;
        } catch (error) {
          console.error(`Failed to create image node ${node.id}:`, error);
          // Continue with other nodes even if one fails
        }
      } else {
        // Regular text node
        const { id, text, x, y, imageData, imagePrompt, imageEditPrompt, ...styleProps } = node;
        const validatedProps = validateAndFixStyleProps(styleProps);
        const validatedNode = { id, text, x, y, ...validatedProps };
        
        const firebaseId = await addNode(validatedNode);
        idMapping[node.id] = firebaseId;
      }
    }
    
    // Add each new link using the mapped IDs (using batch version that doesn't push to undo individually)
    if (newLinks) {
      for (const link of newLinks) {
        const mappedSource = idMapping[link.source] || link.source; // Use mapped ID or original if it's an existing node
        const mappedTarget = idMapping[link.target] || link.target;
        
        await addLink({
          source: mappedSource,
          target: mappedTarget
        });
      }
    }
  };

  // Helper function to upload generated image to Firebase Storage
  // Note: Requires Firebase Storage rules to allow authenticated users to read/write to 'images/' folder
  const uploadGeneratedImage = async (base64Data, nodeId) => {
    try {
      // Convert base64 to blob
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      
      // Upload to Firebase Storage - using 'images/' folder to match your rules
      const timestamp = Date.now();
      const imagePath = `images/generated_${timestamp}_${nodeId}.png`;
      const storageReference = storageRef(storage, imagePath);
      await uploadBytes(storageReference, blob);
      const downloadURL = await getDownloadURL(storageReference);
      
      return { downloadURL, storagePath: imagePath };
    } catch (error) {
      console.error("Error uploading generated image:", error);
      throw error;
    }
  };

  const callAIMindMapAPI = async (promptText, useCursorPosition = false) => {

    const apiKey = await fetchApiData("Key");
    const apiContent = await fetchApiData("prompt1");
    const apiModelMax = await fetchApiData("modelMax");
    if (!apiKey) {
      console.error("No API key found. Ensure Gemini API key is set.");
      throw new Error("API key missing");
    }
    
    // Get selected nodes data for context - only include nodes that actually exist
    const selectedNodesData = selectedNodes.map(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) {
        console.warn(`Selected node ${nodeId} not found in nodes array`);
        return null;
      }
      return {
        id: node.id,
        text: node.text || "Untitled",
        x: node.x,
        y: node.y,
        bgColor: node.bgColor,
        textColor: node.textColor,
        fontSize: node.fontSize,
        fontFamily: node.fontFamily,
        width: node.width,
        height: node.height,
        type: node.type, // Include node type (text, image, etc.)
        imageUrl: node.imageUrl, // Include image URL if it's an image node
        storagePath: node.storagePath // Include storage path for image nodes
      };
    }).filter(Boolean);
    
    // If no valid selected nodes, log warning
    if (selectedNodes.length > 0 && selectedNodesData.length === 0) {
      console.warn("No valid selected nodes found");
    }
    
    // Calculate drop position for when no nodes are selected
    const dropPosition = useCursorPosition && localCursor && localCursor.x !== undefined && localCursor.y !== undefined 
      ? localCursor 
      : canvasCenter;
    
    // Build context-aware prompt and prepare content parts
    let contextualPrompt;
    let contentParts = [];
    
    if (selectedNodesData.length > 0) {
      const nodeDescriptions = selectedNodesData.map(node => {
        let description = `- "${node.text || 'Untitled'}" (ID: ${node.id})`;
        if (node.type === 'image' && node.imageUrl) {
          description += ` [IMAGE NODE - see attached image]`;
        }
        return description;
      }).join('\n');
      
      // Check if any selected nodes are image nodes
      const hasImageNodes = selectedNodesData.some(node => node.type === 'image' && node.imageUrl);
      
      // Build the text prompt
      contextualPrompt = `You are helping with a mind map that has selected nodes. Based on the user's request, decide whether they want to:
1. EDIT the text content of existing selected nodes, OR
2. ADD new nodes around/near the selected nodes, OR
3. GENERATE IMAGES for new nodes, OR
4. EDIT EXISTING IMAGES (when image nodes are selected)

CONTEXT: The user has selected ${selectedNodesData.length} existing node(s):
${nodeDescriptions}

${hasImageNodes ? `\nIMAGE EDITING: Some selected nodes contain images that are attached to this message. When the user asks to modify, edit, or add text to these images, you should create NEW nodes with "imageEditPrompt" that describes how to modify the original image. The system will use the original image + your edit instructions to create the modified version.` : ''}

ANALYZE the user's request and choose the appropriate action:

If the user wants to EDIT existing text nodes (modify text content, improve wording, change descriptions, etc.):
Return JSON with "editNodes" array containing objects with "id" and "newText" for each selected node.

If the user wants to STYLE existing nodes (change colors, fonts, sizes, appearance, etc.):
Return JSON with "styleNodes" array containing objects with "id" and style properties for each node.

If the user wants to MOVE/REPOSITION existing nodes (organize, arrange, layout, align, etc.):
Return JSON with "moveNodes" array containing objects with "id", "x", and "y" for each node to reposition.

If the user wants to ADD new nodes (create additional nodes, expand the map, add related concepts, etc.):
Return JSON with "addNodes" and "addLinks" arrays to create new nodes positioned around the selected ones.

If the user wants to EDIT EXISTING IMAGES (add text, modify colors, change elements in the uploaded image):
Return JSON with "addNodes" array where nodes include "imageEditPrompt" field with instructions for editing the original image.

If the user wants to GENERATE COMPLETELY NEW IMAGES:
Return JSON with "addNodes" array where nodes include "imagePrompt" field with a description for generating a new image from scratch.

USER REQUEST: "${promptText}"

Guidelines for IMAGE EDITING (when modifying existing images):
- Use "imageEditPrompt" instead of "imagePrompt" when editing existing images
- The imageEditPrompt should describe what changes to make to the original image
- Examples: "Add the text 'HELLO WORLD' in bold white letters across the center", "Change the background to blue", "Add a red border around the image"
- Keep the edit instructions simple and specific
- The original image will be used as the base for editing

Guidelines for NEW IMAGE GENERATION:
- Use "imagePrompt" for completely new images
- Provide detailed descriptions for new image creation
- Examples: "A cartoon cat wearing a hat", "A flowchart showing the water cycle"

Guidelines for EDITING:
- Focus on improving, changing, or updating the text content of the selected nodes
- Each selected node should get updated text that reflects the user's request
- Do NOT create new nodes, move positions, or change styling - only modify text content

Guidelines for STYLING:
- Change visual properties like colors, fonts, sizes, dimensions, etc.
- Available properties: 
  * bgColor (hex): background color like "#FF5733", "#3498DB", "#2ECC71"
  * textColor (hex): text color like "#FFFFFF", "#000000", "#FF0000"
  * fontSize (number): font size in pixels, typically 10-24
  * fontFamily (string): ONLY use these exact values: "cursive", "Microsoft Yahei", "Arial", "Times New Roman", "Courier New"
  * width (number): node width in pixels, typically 120-300
  * height (number): node height in pixels, typically 40-100
- Color suggestions: Red "#E74C3C", Blue "#3498DB", Green "#2ECC71", Orange "#F39C12", Purple "#9B59B6", Yellow "#F1C40F"
- Font family mapping: For serif use "Times New Roman", for sans-serif use "Arial", for monospace use "Courier New"
- CRITICAL: Never use "serif", "sans-serif", "monospace", "fantasy" - these will cause errors!
- Current styles: ${selectedNodesData.map(n => `${n.id}: bg:${n.bgColor || 'default'}, text:${n.textColor || 'default'}, font:${n.fontSize || 'default'}px ${n.fontFamily || 'default'}`).join(', ')}
- Do NOT change text content or positions, only visual styling and dimensions

Guidelines for MOVING/REPOSITIONING:
- Calculate new x,y positions to organize the selected nodes in a better layout
- Consider requests like "organize", "arrange in a line", "make a circle", "align vertically", etc.
- Use the current positions as reference: ${selectedNodesData.map(n => `${n.id}: (${n.x}, ${n.y})`).join(', ')}
- Keep nodes reasonably spaced (100-200 pixels apart)
- Do NOT change text content or styling, only positions

Guidelines for ADDING:
- Create 2-8 new nodes that relate to the user's request
- Position new nodes around the selected ones using their current positions as reference
- Current selected node positions: ${selectedNodesData.map(n => `${n.id}: (${n.x}, ${n.y})`).join(', ')}
- Place new nodes 150-300 pixels away from existing ones
- Each new node should have: id, text, x, y coordinates
- Optionally include styling: bgColor, textColor, fontSize, fontFamily, width, height
- Create links connecting new nodes to the existing selected node IDs
- Consider the user's specific requests about positioning, number of nodes, styling, etc.
- You can style new nodes to match or complement existing selected nodes

Example EDIT response:
{
  "editNodes": [
    {"id": "nodeId1", "newText": "Updated text content"},
    {"id": "nodeId2", "newText": "Another updated text"}
  ]
}

Example STYLE response:
{
  "styleNodes": [
    {"id": "nodeId1", "bgColor": "#FF5733", "textColor": "#FFFFFF", "fontSize": 16, "fontFamily": "Times New Roman"},
    {"id": "nodeId2", "bgColor": "#3498DB", "textColor": "#FFFFFF", "width": 200, "height": 60},
    {"id": "nodeId3", "fontSize": 18, "fontFamily": "Courier New", "bgColor": "#2ECC71"}
  ]
}

Example MOVE response:
{
  "moveNodes": [
    {"id": "nodeId1", "x": 200, "y": 100},
    {"id": "nodeId2", "x": 400, "y": 100},
    {"id": "nodeId3", "x": 600, "y": 100}
  ]
}

Example ADD response:
{
  "addNodes": [
    {"id": "new1", "text": "Related concept 1", "x": 250, "y": 100, "bgColor": "#3498DB", "textColor": "#FFFFFF"},
    {"id": "new2", "text": "Related concept 2", "x": 450, "y": 150, "fontSize": 16, "fontFamily": "Arial"}
  ],
  "addLinks": [
    {"source": "existingNodeId", "target": "new1"},
    {"source": "existingNodeId", "target": "new2"}
  ]
}

Example IMAGE EDITING response (modifying existing image):
{
  "addNodes": [
    {"id": "img1", "text": "Edited Image", "x": 300, "y": 200, "width": 300, "height": 200, "imageEditPrompt": "Add the text 'PODCAST THING' in bold white letters across the center of the image"}
  ],
  "addLinks": [
    {"source": "existingNodeId", "target": "img1"}
  ]
}

Example NEW IMAGE GENERATION response:
{
  "addNodes": [
    {"id": "img1", "text": "New Image", "x": 300, "y": 200, "width": 300, "height": 200, "imagePrompt": "A cartoon cat wearing a red hat sitting on a blue chair"}
  ],
  "addLinks": [
    {"source": "existingNodeId", "target": "img1"}
  ]
}`;

      // Add the text prompt as the first part
      contentParts.push({ text: contextualPrompt });
      
      // Add image data for any image nodes
      for (const node of selectedNodesData) {
        if (node.type === 'image' && node.imageUrl) {
          try {
            // Simple approach: try to fetch the image with proper headers
            const imageUrl = node.imageUrl.includes('firebasestorage.googleapis.com') 
              ? `/firebase-storage${node.imageUrl.split('firebasestorage.googleapis.com')[1]}`
              : node.imageUrl;
              
            const response = await fetch(imageUrl);
            
            if (response.ok) {
              const blob = await response.blob();
              const base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
              });
              
              contentParts.push({
                inlineData: {
                  mimeType: blob.type || "image/jpeg",
                  data: base64
                }
              });
              console.log(`Successfully loaded image for node ${node.id}`);
            } else {
              // Fallback: just mention the image in text
              contentParts.push({
                text: `[Note: Image node "${node.text}" - unable to load image for analysis]`
              });
            }
          } catch (error) {
            console.warn(`Could not load image for node ${node.id}:`, error);
            // Fallback: just mention the image in text
            contentParts.push({
              text: `[Note: Image node "${node.text}" - image analysis not available]`
            });
          }
        }
      }
    } else {
      // NO NODES SELECTED - Enhanced prompt for versatile actions
      contextualPrompt = `You are helping with a mind map. The user has NO nodes currently selected. Based on their request, analyze what they want to do and choose the appropriate action:

POSITIONING INFORMATION:
- Target position for new content: x=${Math.round(dropPosition.x)}, y=${Math.round(dropPosition.y)}
- This is either the mouse cursor position or screen center
- Position new nodes around this target location

AVAILABLE ACTIONS (No selection required):

1. GENERATE IMAGES: If user asks for images, pictures, drawings, visual content
   - Return JSON with "addNodes" array where nodes include "imagePrompt" field
   - Position images around target location (${Math.round(dropPosition.x)}, ${Math.round(dropPosition.y)})
   - Examples: "create an image of...", "generate a picture of...", "draw me..."

2. ADD TEXT NODES: If user wants to add individual text concepts, ideas, or notes
   - Return JSON with "addNodes" array with text nodes
   - Position nodes around target location (${Math.round(dropPosition.x)}, ${Math.round(dropPosition.y)})
   - Examples: "add a note about...", "create nodes for...", "add some ideas about..."

3. CREATE FULL MIND MAP: If user explicitly wants a complete mind map structure
   - Return JSON with comprehensive "nodes" and "links" arrays (traditional format)
   - Use this ONLY when user clearly asks for "mind map", "map about", "diagram of", etc.
   - Examples: "create a mind map about...", "make a diagram of...", "map out..."

4. RESPOND WITH TEXT: If request is unclear, asking for help, or needs clarification
   - Return JSON with "response" field containing helpful text
   - Examples: "what can you do?", "help me", unclear requests

USER REQUEST: "${promptText}"

IMPORTANT GUIDELINES:

For IMAGE GENERATION:
- Use "imagePrompt" field with detailed visual descriptions
- Make images reasonably sized (200-300px width/height)
- Position around target: spread within ±150px of (${Math.round(dropPosition.x)}, ${Math.round(dropPosition.y)})
- Examples: "A blue cat wearing a hat", "A flowchart showing water cycle"

For TEXT NODES:
- Create 1-5 individual nodes with meaningful text
- Each node should have: id, text, x, y coordinates
- Position around target: spread within ±150px of (${Math.round(dropPosition.x)}, ${Math.round(dropPosition.y)})
- Optionally add styling: bgColor, textColor, fontSize, fontFamily

For FULL MIND MAPS:
- Create comprehensive node structure with central topic
- Include meaningful links between related nodes
- Center the main topic around (${Math.round(dropPosition.x)}, ${Math.round(dropPosition.y)})
- Include 5-15 nodes typically

For TEXT RESPONSES:
- Provide helpful information or ask for clarification
- Use when user request is unclear or needs guidance

ANALYZE the request and determine the user's intent:

Example IMAGE GENERATION response (positioned around target):
{
  "addNodes": [
    {"id": "img1", "text": "Generated Image", "x": ${Math.round(dropPosition.x - 50)}, "y": ${Math.round(dropPosition.y - 50)}, "width": 250, "height": 200, "imagePrompt": "A cartoon cat wearing a red hat"},
    {"id": "img2", "text": "Another Image", "x": ${Math.round(dropPosition.x + 50)}, "y": ${Math.round(dropPosition.y + 50)}, "width": 250, "height": 200, "imagePrompt": "A blue ocean with waves"}
  ]
}

Example TEXT NODES response (positioned around target):
{
  "addNodes": [
    {"id": "note1", "text": "Important concept", "x": ${Math.round(dropPosition.x - 100)}, "y": ${Math.round(dropPosition.y - 50)}, "bgColor": "#3498DB", "textColor": "#FFFFFF"},
    {"id": "note2", "text": "Related idea", "x": ${Math.round(dropPosition.x + 100)}, "y": ${Math.round(dropPosition.y)}, "bgColor": "#2ECC71", "textColor": "#FFFFFF"},
    {"id": "note3", "text": "Follow-up task", "x": ${Math.round(dropPosition.x)}, "y": ${Math.round(dropPosition.y + 100)}, "bgColor": "#F39C12", "textColor": "#000000"}
  ],
  "addLinks": [
    {"source": "note1", "target": "note2"},
    {"source": "note2", "target": "note3"}
  ]
}

Example FULL MIND MAP response (centered around target):
{
  "nodes": [
    {"id": "center", "text": "Main Topic", "x": ${Math.round(dropPosition.x)}, "y": ${Math.round(dropPosition.y)}, "bgColor": "#E74C3C", "textColor": "#FFFFFF"},
    {"id": "branch1", "text": "Subtopic 1", "x": ${Math.round(dropPosition.x - 150)}, "y": ${Math.round(dropPosition.y - 100)}, "bgColor": "#3498DB", "textColor": "#FFFFFF"},
    {"id": "branch2", "text": "Subtopic 2", "x": ${Math.round(dropPosition.x + 150)}, "y": ${Math.round(dropPosition.y - 100)}, "bgColor": "#2ECC71", "textColor": "#FFFFFF"}
  ],
  "links": [
    {"source": "center", "target": "branch1"},
    {"source": "center", "target": "branch2"}
  ]
}

Example TEXT RESPONSE:
{
  "response": "I can help you create images, add individual nodes, or build complete mind maps. What would you like me to create for you?"
}

USER REQUEST: "${promptText}"`;

      contentParts.push({ text: contextualPrompt });
    }
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: contentParts
          }
        ],
        generationConfig: {
        temperature: 0.7,
          maxOutputTokens: apiModelMax,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error details:", response.status, errorText);
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    let rawContent = data.candidates[0].content.parts[0].text.trim();
    console.log("Raw content from AI:", rawContent);
    
    // Clean up the response - remove markdown code blocks if present
    if (rawContent.startsWith('```json')) {
      rawContent = rawContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (rawContent.startsWith('```')) {
      rawContent = rawContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    try {
      const parsedData = JSON.parse(rawContent);
      
      // Process image generation if nodes have imagePrompt
      if (parsedData.addNodes) {
        for (const node of parsedData.addNodes) {
          if (node.imagePrompt) {
            try {
              console.log(`Generating image for node ${node.id} with prompt: ${node.imagePrompt}`);
              const imageData = await generateImage(node.imagePrompt);
              node.imageData = imageData; // Add the generated image data
              delete node.imagePrompt; // Remove the prompt as it's no longer needed
            } catch (error) {
              console.error(`Failed to generate image for node ${node.id}:`, error);
              // Continue without the image - the node will be created as text only
            }
          }
        }
      }
      
      return parsedData;
    } catch (err) {
      console.error("Error parsing JSON:", err);
      console.log("Cleaned content:", rawContent);
      throw err;
    }
  };

  // Simple image generation and editing using Gemini 2.0 Flash
  const generateImage = async (imagePrompt, originalImageBase64 = null) => {
    try {
      const apiKey = await fetchApiData("Key");
      
      // Prepare content parts
      const contentParts = [];
      
      if (originalImageBase64) {
        // Image editing mode: include original image + edit instructions
        contentParts.push({
          text: `Please edit this image: ${imagePrompt}`
        });
        contentParts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: originalImageBase64
          }
        });
      } else {
        // New image generation mode
        contentParts.push({
          text: imagePrompt
        });
      }
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: contentParts
            }
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Image generation failed:", response.status, errorText);
        throw new Error(`Image generation failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Find the image in the response
      if (data.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            return part.inlineData.data; // Return base64 image data
          }
        }
      }
      
      throw new Error("No image found in response");
    } catch (error) {
      console.error("Image generation error:", error);
      throw error;
    }
  };

  const handleSend = async (useCursorPosition) => {
    if (!prompt.trim()) return;
    if (loading) return;
    setLoading(true);
    
    // Add context info to chat log
    let contextInfo;
    if (selectedNodes.length > 0) {
      contextInfo = `[AI analyzing ${selectedNodes.length} selected node(s)]`;
    } else {
      contextInfo = "[AI ready to help]";
    }
    
    setChatLog((prev) => [...prev, { from: "user", text: `${contextInfo} ${prompt}` }]);
    scrollToBottom();
    try {
      const aiData = await callAIMindMapAPI(prompt, useCursorPosition);
      
      // Handle text-only responses (when AI provides information/clarification)
      if (aiData.response) {
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: aiData.response },
        ]);
        scrollToBottom();
      }
      // Check if this is an edit operation
      else if (aiData.editNodes) {
        // Handle editing existing nodes
        const validEditNodes = aiData.editNodes.filter(editNode => 
          nodes.some(node => node.id === editNode.id)
        );
        await handleEditNodes(aiData.editNodes);
        
        const successCount = validEditNodes.length;
        const skippedCount = aiData.editNodes.length - validEditNodes.length;
        let message = `Updated ${successCount} node(s)`;
        if (skippedCount > 0) {
          message += ` (${skippedCount} skipped)`;
        }
        message += " (Ctrl+Z to undo)";
        
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: message, json: aiData },
        ]);
        scrollToBottom();
      } else if (aiData.styleNodes) {
        // Handle styling existing nodes
        const validStyleNodes = aiData.styleNodes.filter(styleNode => 
          nodes.some(node => node.id === styleNode.id)
        );
        await handleStyleNodes(aiData.styleNodes);
        
        const successCount = validStyleNodes.length;
        const skippedCount = aiData.styleNodes.length - validStyleNodes.length;
        let message = `Styled ${successCount} node(s)`;
        if (skippedCount > 0) {
          message += ` (${skippedCount} skipped)`;
        }
        message += " (Ctrl+Z to undo)";
        
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: message, json: aiData },
        ]);
        scrollToBottom();
      } else if (aiData.moveNodes) {
        // Handle moving/repositioning existing nodes
        const validMoveNodes = aiData.moveNodes.filter(moveNode => 
          nodes.some(node => node.id === moveNode.id)
        );
        await handleMoveNodes(aiData.moveNodes);
        
        const successCount = validMoveNodes.length;
        const skippedCount = aiData.moveNodes.length - validMoveNodes.length;
        let message = `Repositioned ${successCount} node(s)`;
        if (skippedCount > 0) {
          message += ` (${skippedCount} skipped)`;
        }
        message += " (Ctrl+Z to undo)";
        
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: message, json: aiData },
        ]);
        scrollToBottom();
      } else if (aiData.addNodes) {
        // Handle adding individual nodes (works for both selected and non-selected scenarios)
        const imageCount = aiData.addNodes.filter(node => node.imageData || node.imagePrompt).length;
        const textCount = aiData.addNodes.length - imageCount;
        
        await handleAddNodes(aiData.addNodes, aiData.addLinks);
        
        let message = `Added ${aiData.addNodes.length} new node(s)`;
        if (imageCount > 0 && textCount > 0) {
          message += ` (${imageCount} image${imageCount > 1 ? 's' : ''}, ${textCount} text)`;
        } else if (imageCount > 0) {
          message += ` (${imageCount} image${imageCount > 1 ? 's' : ''})`;
        }
        message += " (Ctrl+Z to undo)";
        
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: message, json: aiData },
        ]);
        scrollToBottom();
      } else if (aiData.nodes && aiData.links) {
        // Handle creating a full new mind map (traditional format with nodes and links arrays)
        const responseText = "Generated new mind map";
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: `${responseText} (Ctrl+Z to undo)`, json: aiData },
        ]);
        scrollToBottom();
        
        // Pass the AI data and the current local cursor (drop point) to merge function.
        const dropPosition = useCursorPosition
          ? localCursor // from MindMapEditor state
          : canvasCenter;
        await mergeMindMapData(aiData, dropPosition, view);
      } else {
        // Fallback: treat as a full mind map if no other structure matches
        const responseText = "Generated content";
        setChatLog((prev) => [
          ...prev,
          { from: "ai", text: `${responseText} (Ctrl+Z to undo)`, json: aiData },
        ]);
        scrollToBottom();
        
        // Pass the AI data and the current local cursor (drop point) to merge function.
        const dropPosition = useCursorPosition
          ? localCursor // from MindMapEditor state
          : canvasCenter;
        await mergeMindMapData(aiData, dropPosition, view);
      }
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setChatLog((prev) => [
        ...prev,
        { from: "ai", text: "Error generating content. Please try again." },
      ]);
      scrollToBottom();
    } finally {
      setLoading(false);
      setPrompt("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend(true); // true means "use cursor position"
    }
    // Prevent paste events from bubbling up to parent
    if (e.ctrlKey && e.key === 'v') {
      e.stopPropagation();
    }
  };
  const onButtonClick = (e) => {
    handleSend(false); // true means "use cursor position"
    
  };
  const [view, setView] = useState('bottomLay');

  // Auto-scroll when chat log updates
  useEffect(() => {
    scrollToBottom();
  }, [chatLog]);

  return (
    <>
      <style>
        {`
          @keyframes pulse {
            0%, 50% { opacity: 1; }
            25%, 75% { opacity: 0.5; }
          }
        `}
      </style>
    <div
      style={{
        position: "fixed",
        bottom: isChatOpen ? "0" : "-270px", // slide out/in vertically
        left: "0",
        width: "300px",
        height: "300px",
        background: "radial-gradient(circle at center,rgba(29, 32, 34, 0.66) 0%, #0f1011 100%)",
        color: "#fff",
        borderTopRightRadius: "8px",
        //border: "1px solid #444",
        transition: "bottom 0.3s ease",
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
      }}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Prevent keyboard shortcuts from affecting the main canvas when chatbox is focused
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
        }
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          background: "radial-gradient(circle at center,rgba(29, 32, 34, 0.66) 0%,rgb(27, 29, 31) 100%)",
          borderTopRightRadius: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
             onClick={() => setIsChatOpen((prev) => !prev)}>
          {isChatOpen ? <ArrowDropDown /> : <ArrowDropUp />}
          <span style={{ marginLeft: "4px", fontWeight:"bold" }}>
            MindMap Maker (AI)
            {selectedNodes.length > 0 && (
              <span style={{ 
                marginLeft: "8px", 
                fontSize: "0.8em", 
                backgroundColor: "rgba(136, 150, 221, 0.3)", 
                padding: "2px 6px", 
                borderRadius: "4px",
                color: "#8896DD"
              }}>
                {selectedNodes.length} selected
              </span>
            )}
          </span>
        </div>
        <Close
          style={{ cursor: "pointer"}}
          onClick={() => setIsChatOpen(false)}
        />
      </div>
      <div
        ref={chatLogRef}
        style={{
          flex: 1,
          padding: "8px",
          overflowY: "auto",
          fontSize: "0.9rem",
          maxHeight: "200px",
        }}
        onWheel={(e) => {
          // Prevent wheel events from bubbling up to parent (prevents zoom)
          e.stopPropagation();
        }}
      >
        {chatLog.map((entry, index) => (
          <div key={index} style={{ 
            marginBottom: "12px", 
            lineHeight: "1.4",
            padding: "6px 8px",
            borderRadius: "6px",
            backgroundColor: entry.from === "user" 
              ? "rgba(136, 150, 221, 0.1)" 
              : "rgba(78, 205, 196, 0.1)",
            border: `1px solid ${entry.from === "user" ? "rgba(136, 150, 221, 0.2)" : "rgba(78, 205, 196, 0.2)"}`
          }}>
            <strong style={{ color: entry.from === "user" ? "#8896DD" : "#4ECDC4" }}>
              {entry.from === "user" ? "You:" : "AI:"}
            </strong>{" "}
            <span style={{ color: "#EAEAEA" }}>{entry.text}</span>
          </div>
        ))}
        {loading && (
          <div style={{ 
            marginBottom: "12px", 
            lineHeight: "1.4",
            padding: "6px 8px",
            borderRadius: "6px",
            backgroundColor: "rgba(78, 205, 196, 0.1)",
            border: "1px solid rgba(78, 205, 196, 0.2)"
          }}>
            <strong style={{ color: "#4ECDC4" }}>AI:</strong>{" "}
            <span style={{ color: "#EAEAEA" }}>
              Thinking
              <span style={{ animation: "pulse 1.5s infinite" }}>...</span>
            </span>
          </div>
        )}
      </div>
      <div  style={{width:"16%", marginLeft:"83%", marginTop:"22%", background: "radial-gradient(circle at center,rgba(29, 32, 34, .5) 0%,rgba(56, 60, 63, 0.73) 130%)", color:"white", borderRadius:"8px",position:"absolute"}}>
        <paper
        
        >
          
      <ToggleButtonGroup
                      value={view}
                      exclusive
                      onChange={(e, newAlign) => {
                        if (newAlign !== null) {
                          setView(newAlign);
                          // Optionally, call handleSidebarSave() for instant saving
                        }
                      }}
                      //style={backgroundColor:"red"}
                      
                      orientation="vertical"
                      aria-label="text alignment"
                      color="info"
                      size="small"
                      sx={{ mx: 0.5, my: .5, background: "radial-gradient(circle at center,rgba(36, 39, 43, 0.5) 0%,rgba(108, 115, 121, 0.73) 130%)" }}
                      //onChange={handleChange}
                    >
                      <ToggleButton value="bottomLay" aria-label="bottomLay" style={{transform: "rotate(180deg)"}}>
                        <FilterListIcon />
                      </ToggleButton>
                      <ToggleButton value="rightLay" aria-label="rightLay" style={{transform: "rotate(90deg)"}}>
                        <FilterListIcon />
                      </ToggleButton>
                      <ToggleButton value="centerLay" aria-label="centerLay" >
                        <BorderClearIcon />
                      </ToggleButton>
                    </ToggleButtonGroup>
                    </paper>
                    </div>
      <div style={{ padding: "7px", display: "flex" }}>
        <TextField
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => e.stopPropagation()}
          onCopy={(e) => e.stopPropagation()}
          onCut={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          variant="filled"
          size="small"
          placeholder={selectedNodes.length > 0 
            ? `Tell me what to do with ${selectedNodes.length} selected node(s)... (can generate images!)` 
            : "Create new mind map or generate images..."}
          InputProps={{
            style: { background: "radial-gradient(circle at center,rgba(29, 32, 34, .5) 0%,rgba(56, 60, 63, 0.73) 130%)", color: "#fff" },
          }}
          fullWidth
        />
         
        <Button
          variant="contained"
          onClick={onButtonClick}
          disabled={loading || !prompt.trim()}
          style={{ 
            marginLeft: "4px", 
            background: loading || !prompt.trim() 
              ? "rgba(60, 60, 60, 0.5)" 
              : "radial-gradient(circle at center,rgba(29, 32, 34, .5) 0%,rgba(56, 60, 63, 0.73) 130%)",
            minWidth: "60px"
          }}
        >
          {loading ? "..." : "Send"}
        </Button>
      </div>
    </div>
    </>
  );
};

export default ChatBox;
