import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button, TextField } from "@mui/material";
import { ArrowDropUp, ArrowDropDown, Close } from "@mui/icons-material";
// Import your Firebase functions as needed
import { collection, addDoc, writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase/firebase";

// Dummy API call that simulates generating a mind map JSON from a prompt.
// Replace this with your actual API integration.


const ChatBox = ({
  localCursor,
  canvasCenter,
  mergeMindMapData,
  isChatOpen,
  setIsChatOpen,
}) => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLog, setChatLog] = useState([]);

  const callAIMindMapAPI = async (promptText) => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      console.error("No API key found. Ensure VITE_OPENAI_API_KEY is set.");
      throw new Error("API key missing");
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo", // or "gpt-4" if available
        messages: [
          {
            role: "system",
            content:
            "You are an expert mind map generator. When given a prompt, output complete valid JSON with two arrays: 'nodes' and 'links'. Each node should include at least an 'id' and a 'text' property. Each link should specify a parent-child relationship with 'source' and 'target'. " +
            "Generate a deep, multi‑level mind map structured as follows: " +
            "1. The root node represents the main topic. " +
            "2. Create at least four subtopics as direct children of the root node. " +
            "3. For each subtopic, create at least two additional child nodes: one that provides a brief explanation of what that subtopic is, and one that discusses its benefits, challenges, or examples. " +
            "4. If the subtopic is complex, add an extra level of child nodes that give even more detailed explanations. " +
            "5. Make sure that if you add any subtopic children then make sure the other subtopics have some as well. " +
            "6. Ensure that each node has a 'parent' field. For the root node, set parent to null, and for all other nodes, include the id of its parent." +
            "Output only valid JSON with no markdown or extra text.",
          },
          {
            role: "user",
            content: promptText,
          },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error details:", response.status, errorText);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const rawContent = data.choices[0].message.content.trim();
    console.log("Raw content from AI:", rawContent);
    try {
      return JSON.parse(rawContent);
    } catch (err) {
      console.error("Error parsing JSON:", err);
      console.log("Raw content:", rawContent);
      throw err;
    }
  };

  const handleSend = async (useCursorPosition) => {
    if (!prompt.trim()) return;
    if (loading) return;
    setLoading(true);
    setChatLog((prev) => [...prev, { from: "user", text: prompt }]);
    try {
      const aiData = await callAIMindMapAPI(prompt);
      setChatLog((prev) => [
        ...prev,
        { from: "ai", text: "Generated mind map JSON", json: aiData },
      ]);
      // Pass the AI data and the current local cursor (drop point) to merge function.
      const dropPosition = useCursorPosition
      ? localCursor // from MindMapEditor state
      : canvasCenter;
      await mergeMindMapData(aiData, dropPosition);
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
      setChatLog((prev) => [
        ...prev,
        { from: "ai", text: "Error generating mind map" },
      ]);
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
  };
  const onButtonClick = (e) => {
    handleSend(false); // true means "use cursor position"
    
  };


  return (
    <div
      style={{
        position: "fixed",
        bottom: isChatOpen ? "0" : "-270px", // slide out/in vertically
        left: "0",
        width: "300px",
        height: "300px",
        backgroundColor: "#222",
        color: "#fff",
        borderTopRightRadius: "8px",
        border: "1px solid #444",
        transition: "bottom 0.3s ease",
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          backgroundColor: "#333",
          borderTopRightRadius: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
             onClick={() => setIsChatOpen((prev) => !prev)}>
          {isChatOpen ? <ArrowDropDown /> : <ArrowDropUp />}
          <span style={{ marginLeft: "4px", fontWeight:"bold" }}>MindMap Maker (Ai)</span>
        </div>
        <Close
          style={{ cursor: "pointer"}}
          onClick={() => setIsChatOpen(false)}
        />
      </div>
      <div
        style={{
          flex: 1,
          padding: "8px",
          overflowY: "auto",
          fontSize: "0.9rem",
        }}
      >
        {chatLog.map((entry, index) => (
          <div key={index} style={{ marginBottom: "4px"}}>
            <strong>{entry.from === "user" ? "You:" : "AI:"}</strong>{" "}
            {entry.text}
          </div>
        ))}
      </div>
      <div style={{ padding: "7px", display: "flex" }}>
        <TextField
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          variant="filled"
          size="small"
          placeholder="Enter prompt..."
          InputProps={{
            style: { backgroundColor: "#333", color: "#fff" },
          }}
          fullWidth
        />
        <Button
          variant="contained"
          onClick={onButtonClick}
          disabled={loading}
          style={{ marginLeft: "4px" }}
        >
          {loading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  );
};

export default ChatBox;
