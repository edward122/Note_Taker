// Search bar overlay component
import React from "react";
import { TextField, Button } from "@mui/material";

const SearchBar = ({
  showSearch,
  searchQuery,
  setSearchQuery,
  performSearch,
  searchResults,
  currentSearchIndex,
  navigateSearch,
  setShowSearch,
  setSearchResults,
}) => {
  if (!showSearch) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '70px',
        left: '20px',
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: '300px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <TextField
          placeholder="Search nodes... (Ctrl+F)"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            performSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              navigateSearch('next');
            }
            if (e.key === 'Escape') {
              setShowSearch(false);
              setSearchQuery('');
              setSearchResults([]);
            }
          }}
          size="small"
          autoFocus
          sx={{
            flex: 1,
            '& .MuiInputBase-root': {
              color: '#fff',
              backgroundColor: '#333',
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: '#555',
            },
            '& .MuiInputLabel-root': {
              color: '#ccc',
            },
          }}
        />
        <Button
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowSearch(false);
            setSearchQuery('');
            setSearchResults([]);
          }}
          size="small"
          style={{ color: '#fff', minWidth: 'auto' }}
        >
          ✕
        </Button>
      </div>
      
      {searchResults.length > 0 && (
        <div style={{ color: '#ccc', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {currentSearchIndex + 1} of {searchResults.length} results
          </span>
          <div style={{ display: 'flex', gap: '5px' }}>
            <Button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateSearch('prev');
              }}
              size="small"
              disabled={searchResults.length === 0}
              style={{ color: '#fff', minWidth: 'auto', padding: '2px 8px' }}
            >
              ↑
            </Button>
            <Button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateSearch('next');
              }}
              size="small"
              disabled={searchResults.length === 0}
              style={{ color: '#fff', minWidth: 'auto', padding: '2px 8px' }}
            >
              ↓
            </Button>
          </div>
        </div>
      )}
      
      {searchQuery && searchResults.length === 0 && (
        <div style={{ color: '#999', fontSize: '12px' }}>
          No results found
        </div>
      )}
    </div>
  );
};

export default SearchBar;
