import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button, TextField } from "@mui/material";
import { ArrowDropUp, ArrowDropDown, Close } from "@mui/icons-material";
// Import your Firebase functions as needed
//import { collection, addDoc, writeBatch, doc, getDocs } from "firebase/firestore";
//import { db } from "../firebase/firebase";
// Dummy API call that simulates generating a mind map JSON from a prompt.
// Replace this with your actual API integration.
import { getDatabase, ref, get } from "firebase/database";

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
}) => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLog, setChatLog] = useState([]);
  const callAIMindMapAPI = async (promptText) => {

    const apiKey = await fetchApiData("Key");
    const apiContent = await fetchApiData("prompt1");
    const apiModel = await fetchApiData("model");
    const apiModelMax = await fetchApiData("modelMax");
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
        model: apiModel, // or "gpt-4" if available
        messages: [
          {
            role: "system",
            content: apiContent,
          },
          {
            role: "user",
            content: promptText,
          },
        ],
        temperature: 0.7,
        max_tokens: apiModelMax,
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
