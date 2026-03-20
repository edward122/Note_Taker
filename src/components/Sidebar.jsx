// Right sidebar for node customization
import React from "react";
import {
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Autocomplete,
  Stack
} from "@mui/material";
import PaletteIcon from "@mui/icons-material/Palette";
import { ChromePicker } from 'react-color';
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import { presetSizes } from "./constants";

const Sidebar = ({
  activeCustomizationNode,
  selectedNodes,
  tempFontFamily,
  setTempFontFamily,
  tempFontSize,
  setTempFontSize,
  tempTextStyle,
  setTempTextStyle,
  tempTextAlign,
  setTempTextAlign,
  tempBgColor,
  setTempBgColor,
  tempTextColor,
  setTempTextColor,
  tempZIndex,
  setTempZIndex,
  showBgColorPicker,
  setShowBgColorPicker,
  showTextColorPicker,
  setShowTextColorPicker,
  handleBringToFront,
  handleSendToBack,
  handleZIndexChange,
  handleRemoveLinks,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 10,
        width: "250px",
        height: "calc(100% - 60px)",
        boxShadow: "0 2px 10px rgba(39, 39, 39, 0.6)",
        background: "radial-gradient(circle at center, #1D2022 0%, #0f1011 110%)",
        padding: "20px",
        boxSizing: "border-box",
        zIndex: 300,
        overflowY: "auto",
        borderRadius: "8px",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {activeCustomizationNode ? (
        <>
          {/* Title */}
          <div
            style={{
              marginBottom: "24px",
              textAlign: "center",
              borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
              paddingBottom: "16px",
            }}
          >
            <Typography
              variant="h6"
              style={{
                color: "#ffffff",
                fontWeight: "600",
                fontSize: "18px",
                letterSpacing: "0.5px",
                textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
              }}
            >
              Node Customization
            </Typography>
            <Typography
              variant="caption"
              style={{
                color: "rgba(255, 255, 255, 0.6)",
                fontSize: "12px",
                display: "block",
                marginTop: "4px",
              }}
            >
              {selectedNodes.length} node{selectedNodes.length !== 1 ? 's' : ''} selected
            </Typography>
          </div>

          {/* Font Section */}
          <div style={{ marginBottom: "20px" }}>
            <Typography
              variant="subtitle1"
              style={{
                marginBottom: "12px",
                color: "rgba(255, 255, 255, 0.9)",
                fontWeight: "500",
                fontSize: "14px",
                letterSpacing: "0.3px",
                textTransform: "uppercase",
                borderLeft: "3px solid rgba(255, 255, 255, 0.3)",
                paddingLeft: "12px",
              }}
            >
              Typography
            </Typography>

            {/* Font Selector */}
            <FormControl
              variant="filled"
              size="small"
              sx={{ 
                minWidth: "100%",
                marginBottom: "16px",
                "& .MuiFilledInput-root": {
                  backgroundColor: "rgba(43, 43, 43, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  "&:hover": { backgroundColor: "rgba(43, 43, 43, 0.9)", borderColor: "rgba(255, 255, 255, 0.2)" },
                  "&.Mui-focused": { backgroundColor: "rgba(43, 43, 43, 1)", borderColor: "rgba(255, 255, 255, 0.3)" }
                },
                "& .MuiInputLabel-root": { color: "rgba(255, 255, 255, 0.7)", fontSize: "13px" },
                "& .MuiSelect-select": { color: "#fff", fontSize: "14px" }
              }}
            >
              <InputLabel>Font Family</InputLabel>
              <Select value={tempFontFamily} onChange={(e) => setTempFontFamily(e.target.value)}>
                <MenuItem value="cursive">Cursive</MenuItem>
                <MenuItem value="Microsoft Yahei">Microsoft Yahei</MenuItem>
                <MenuItem value="Arial">Arial</MenuItem>
                <MenuItem value="Times New Roman">Times New Roman</MenuItem>
                <MenuItem value="Courier New">Courier New</MenuItem>
              </Select>
            </FormControl>

            {/* Font Size */}
            <Typography variant="body2" style={{ marginBottom: "8px", color: "rgba(255, 255, 255, 0.8)", fontSize: "13px", fontWeight: "500" }}>
              Font Size
            </Typography>
            <Autocomplete
              freeSolo
              options={presetSizes}
              getOptionLabel={(option) => option.toString()}
              value={tempFontSize}
              onChange={(e, newValue) => {
                let parsed;
                if (typeof newValue === "number") parsed = newValue;
                else if (typeof newValue === "string" && newValue.trim() !== "") parsed = parseInt(newValue, 10);
                if (!isNaN(parsed)) setTempFontSize(parsed);
              }}
              onInputChange={(e, newInputValue) => {
                const parsed = parseInt(newInputValue, 10);
                if (!isNaN(parsed)) setTempFontSize(parsed);
              }}
              sx={{
                width: "100%",
                marginBottom: "16px",
                "& .MuiInputBase-root": { color: "#fff" },
                "& .MuiFilledInput-root": {
                  backgroundColor: "rgba(43, 43, 43, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  "&:hover": { backgroundColor: "rgba(43, 43, 43, 0.9)", borderColor: "rgba(255, 255, 255, 0.2)" },
                  "&.Mui-focused": { backgroundColor: "rgba(43, 43, 43, 1)", borderColor: "rgba(255, 255, 255, 0.3)" }
                },
                "& .MuiInputLabel-root": { color: "rgba(255, 255, 255, 0.7)", fontSize: "13px" },
                "& .MuiAutocomplete-popupIndicator": { color: "rgba(255, 255, 255, 0.6)" },
              }}
              renderInput={(params) => <TextField {...params} label="Font Size" variant="filled" />}
            />

            {/* Text Style + Alignment */}
            <div style={{ marginBottom: "16px" }}>
              <Typography variant="body2" style={{ marginBottom: "8px", color: "rgba(255, 255, 255, 0.8)", fontSize: "13px", fontWeight: "500" }}>
                Text Style
              </Typography>
              <Stack direction="column" spacing={2} sx={{ alignItems: "center" }}>
                <ToggleButtonGroup
                  color="primary"
                  value={tempTextStyle}
                  onChange={(e, newStyles) => setTempTextStyle(newStyles)}
                  sx={{
                    backgroundColor: "rgba(43, 43, 43, 0.8)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    "& .MuiToggleButton-root": {
                      color: "rgba(255, 255, 255, 0.7)",
                      border: "none",
                      "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.1)" },
                      "&.Mui-selected": { backgroundColor: "rgba(255, 255, 255, 0.2)", color: "#fff" }
                    }
                  }}
                  aria-label="text style"
                  size="small"
                >
                  <ToggleButton value="bold" aria-label="bold"><FormatBoldIcon /></ToggleButton>
                  <ToggleButton value="italic" aria-label="italic"><FormatItalicIcon /></ToggleButton>
                  <ToggleButton value="underline" aria-label="underline"><FormatUnderlinedIcon /></ToggleButton>
                </ToggleButtonGroup>

                <ToggleButtonGroup
                  value={tempTextAlign}
                  color="primary"
                  exclusive
                  onChange={(e, newAlign) => { if (newAlign !== null) setTempTextAlign(newAlign); }}
                  sx={{
                    backgroundColor: "rgba(43, 43, 43, 0.8)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    "& .MuiToggleButton-root": {
                      color: "rgba(255, 255, 255, 0.7)",
                      border: "none",
                      "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.1)" },
                      "&.Mui-selected": { backgroundColor: "rgba(255, 255, 255, 0.2)", color: "#fff" }
                    }
                  }}
                  aria-label="text alignment"
                  size="small"
                >
                  <ToggleButton value="left" aria-label="left"><FormatAlignLeftIcon /></ToggleButton>
                  <ToggleButton value="center" aria-label="center"><FormatAlignCenterIcon /></ToggleButton>
                  <ToggleButton value="right" aria-label="right"><FormatAlignRightIcon /></ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </div>
          </div>

          {/* Colors Section */}
          <div style={{ marginBottom: "20px" }}>
            <Typography
              variant="subtitle1"
              style={{
                marginBottom: "16px",
                color: "rgba(255, 255, 255, 0.9)",
                fontWeight: "500",
                fontSize: "14px",
                letterSpacing: "0.3px",
                textTransform: "uppercase",
                borderLeft: "3px solid rgba(255, 255, 255, 0.3)",
                paddingLeft: "12px",
              }}
            >
              Colors
            </Typography>

            {/* Background Color Picker */}
            <div data-color-picker="bg" style={{ position: "relative", marginTop: "8px" }}>
              <div
                onClick={() => setShowBgColorPicker(!showBgColorPicker)}
                style={{
                  display: "flex", alignItems: "center", gap: "12px", padding: "12px",
                  backgroundColor: "#2b2b2b", borderRadius: "8px", border: "1px solid #444", cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => e.target.style.borderColor = "#666"}
                onMouseLeave={(e) => e.target.style.borderColor = "#444"}
              >
                <div style={{
                  width: "40px", height: "40px", backgroundColor: tempBgColor,
                  borderRadius: "8px", border: "2px solid #555",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    background: `linear-gradient(45deg, transparent 25%, rgba(255,255,255,0.1) 25%, rgba(255,255,255,0.1) 50%, transparent 50%, transparent 75%, rgba(255,255,255,0.1) 75%)`,
                    backgroundSize: "8px 8px",
                  }} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "14px", color: "#fff", fontWeight: "500" }}>Background</span>
                  <span style={{ fontSize: "12px", color: "#999", fontFamily: "monospace" }}>{tempBgColor.toUpperCase()}</span>
                </div>
                <PaletteIcon style={{ color: "#666", fontSize: "20px" }} />
              </div>
              
              {showBgColorPicker && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, zIndex: 1000, marginTop: "8px",
                  borderRadius: "8px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", border: "1px solid #444", overflow: "hidden",
                }}>
                  <ChromePicker
                    color={tempBgColor}
                    onChange={(color) => setTempBgColor(color.hex)}
                    disableAlpha={true}
                    styles={{
                      default: {
                        picker: { backgroundColor: "#1e1e1e", border: "none", borderRadius: "8px", boxShadow: "none" },
                        saturation: { borderRadius: "4px" },
                        hue: { borderRadius: "4px" },
                        input: { backgroundColor: "#2b2b2b", border: "1px solid #444", borderRadius: "4px", color: "#fff", fontSize: "12px" },
                        label: { color: "#ccc", fontSize: "11px" },
                      },
                    }}
                  />
                  <div style={{ padding: "8px", backgroundColor: "#1e1e1e", borderTop: "1px solid #333", display: "flex", justifyContent: "flex-end" }}>
                    <Button size="small" onClick={() => setShowBgColorPicker(false)}
                      style={{ color: "#fff", backgroundColor: "#333", fontSize: "11px", minWidth: "auto", padding: "4px 12px" }}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Text Color Picker */}
            <div data-color-picker="text" style={{ position: "relative", marginTop: "8px" }}>
              <div
                onClick={() => setShowTextColorPicker(!showTextColorPicker)}
                style={{
                  display: "flex", alignItems: "center", gap: "12px", padding: "12px",
                  backgroundColor: "#2b2b2b", borderRadius: "8px", border: "1px solid #444", cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => e.target.style.borderColor = "#666"}
                onMouseLeave={(e) => e.target.style.borderColor = "#444"}
              >
                <div style={{
                  width: "40px", height: "40px", backgroundColor: tempTextColor,
                  borderRadius: "8px", border: "2px solid #555",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "16px", fontWeight: "bold", color: tempBgColor,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    background: `linear-gradient(45deg, transparent 25%, rgba(255,255,255,0.1) 25%, rgba(255,255,255,0.1) 50%, transparent 50%, transparent 75%, rgba(255,255,255,0.1) 75%)`,
                    backgroundSize: "8px 8px",
                  }} />
                  <span style={{ position: "relative", zIndex: 1 }}>Aa</span>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "14px", color: "#fff", fontWeight: "500" }}>Font Color</span>
                  <span style={{ fontSize: "12px", color: "#999", fontFamily: "monospace" }}>{tempTextColor.toUpperCase()}</span>
                </div>
                <PaletteIcon style={{ color: "#666", fontSize: "20px" }} />
              </div>
              
              {showTextColorPicker && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, zIndex: 1000, marginTop: "8px",
                  borderRadius: "8px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", border: "1px solid #444", overflow: "hidden",
                }}>
                  <ChromePicker
                    color={tempTextColor}
                    onChange={(color) => setTempTextColor(color.hex)}
                    disableAlpha={true}
                    styles={{
                      default: {
                        picker: { backgroundColor: "#1e1e1e", border: "none", borderRadius: "8px", boxShadow: "none" },
                        saturation: { borderRadius: "4px" },
                        hue: { borderRadius: "4px" },
                        input: { backgroundColor: "#2b2b2b", border: "1px solid #444", borderRadius: "4px", color: "#fff", fontSize: "12px" },
                        label: { color: "#ccc", fontSize: "11px" },
                      },
                    }}
                  />
                  <div style={{ padding: "8px", backgroundColor: "#1e1e1e", borderTop: "1px solid #333", display: "flex", justifyContent: "flex-end" }}>
                    <Button size="small" onClick={() => setShowTextColorPicker(false)}
                      style={{ color: "#fff", backgroundColor: "#333", fontSize: "11px", minWidth: "auto", padding: "4px 12px" }}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Layer Controls */}
          <div style={{ marginBottom: "20px" }}>
            <Typography
              variant="subtitle1"
              style={{
                marginBottom: "12px", color: "rgba(255, 255, 255, 0.9)", fontWeight: "500",
                fontSize: "14px", letterSpacing: "0.3px", textTransform: "uppercase",
                borderLeft: "3px solid rgba(255, 255, 255, 0.3)", paddingLeft: "12px",
              }}
            >
              Layer Order
            </Typography>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
              <TextField
                type="number"
                value={tempZIndex}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 1;
                  setTempZIndex(value);
                  handleZIndexChange(value);
                }}
                size="small"
                sx={{
                  flex: 1,
                  "& .MuiInputBase-root": {
                    color: "#fff", backgroundColor: "rgba(43, 43, 43, 0.8)",
                    border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px",
                  },
                  "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                  "& .MuiInputBase-root:hover": { backgroundColor: "rgba(43, 43, 43, 0.9)", borderColor: "rgba(255, 255, 255, 0.2)" },
                  "& .MuiInputBase-root.Mui-focused": { backgroundColor: "rgba(43, 43, 43, 1)", borderColor: "rgba(255, 255, 255, 0.3)" }
                }}
                inputProps={{ min: 0, max: 9999 }}
              />
              <Button variant="contained" size="small" onClick={handleBringToFront}
                sx={{
                  backgroundColor: "rgba(43, 43, 43, 0.8)", color: "rgba(255, 255, 255, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px",
                  minWidth: "auto", padding: "8px 12px", fontSize: "12px", fontWeight: "500",
                  "&:hover": { backgroundColor: "rgba(43, 43, 43, 0.9)", borderColor: "rgba(255, 255, 255, 0.2)" }
                }}
                title="Bring to Front"
              >
                Front
              </Button>
              <Button variant="contained" size="small" onClick={handleSendToBack}
                sx={{
                  backgroundColor: "rgba(43, 43, 43, 0.8)", color: "rgba(255, 255, 255, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px",
                  minWidth: "auto", padding: "8px 12px", fontSize: "12px", fontWeight: "500",
                  "&:hover": { backgroundColor: "rgba(43, 43, 43, 0.9)", borderColor: "rgba(255, 255, 255, 0.2)" }
                }}
                title="Send to Back"
              >
                Back
              </Button>
            </div>
          </div>

          {/* Actions Section */}
          <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
            <Button
              variant="contained"
              onClick={handleRemoveLinks}
              sx={{
                width: "100%", backgroundColor: "rgba(170, 17, 17, 0.8)", color: "#fff",
                border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px",
                padding: "12px", fontSize: "13px", fontWeight: "500", textTransform: "none",
                "&:hover": { backgroundColor: "rgba(170, 17, 17, 0.9)", borderColor: "rgba(255, 255, 255, 0.2)" }
              }}
            >
              Remove All Links
            </Button>
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255, 255, 255, 0.6)" }}>
          <Typography variant="h6" style={{ color: "rgba(255, 255, 255, 0.8)", marginBottom: "8px", fontSize: "16px", fontWeight: "500" }}>
            No Selection
          </Typography>
          <Typography variant="body2" style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: "13px", lineHeight: "1.5" }}>
            Select one or more nodes to customize their appearance and properties
          </Typography>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
