// src/components/Dashboard.jsx
import React, { useEffect, useState, useRef } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
  arrayUnion,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebase';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { getAllThumbnails, deleteThumbnail } from '../utils/thumbnailStore';

const templates = {
  blank: [],
  brainstorm: [
    { text: 'Idea 1', x: 150, y: 150 },
    { text: 'Idea 2', x: 300, y: 150 },
    { text: 'Idea 3', x: 150, y: 300 }
  ],
  project: [
    { text: 'Goal', x: 150, y: 100 },
    { text: 'Task 1', x: 100, y: 200 },
    { text: 'Task 2', x: 200, y: 200 }
  ]
};

const ACCENT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#14b8a6', '#f59e0b', '#3b82f6', '#10b981',
];
const getAccent = (i) => ACCENT_COLORS[i % ACCENT_COLORS.length];

const formatDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ── SVG Icons ──────────────────────────────────────────────
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
);
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
);
const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
);
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
);
const MapIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><line x1="6.7" y1="7.3" x2="9.8" y2="10.2"/><line x1="14.2" y1="10.2" x2="17.3" y2="7.3"/><line x1="6.7" y1="16.7" x2="9.8" y2="13.8"/><line x1="14.2" y1="13.8" x2="17.3" y2="16.7"/></svg>
);
const LogOutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
);
const StarIcon = ({ filled }) => (
  <svg width="18" height="18" viewBox="0 0 24 24"
    fill={filled ? '#f59e0b' : 'none'}
    stroke={filled ? '#f59e0b' : 'currentColor'}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

// ══════════════════════════════════════════════════════════════
const Dashboard = () => {
  const [mindMaps, setMindMaps] = useState([]);
  const [deleteId, setDeleteId] = useState(null);
  const [openFirstDialog, setOpenFirstDialog] = useState(false);
  const [openSecondDialog, setOpenSecondDialog] = useState(false);
  const [openNewMapDialog, setOpenNewMapDialog] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareMindMapId, setShareMindMapId] = useState(null);
  const [shareEmail, setShareEmail] = useState('');
  const [user, setUser] = useState(null);
  const [thumbnails, setThumbnails] = useState(new Map());
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Load thumbnails from IndexedDB on mount
  useEffect(() => {
    getAllThumbnails().then(setThumbnails);
  }, []);

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged((u) => {
      if (!u) { navigate('/'); return; }
      setUser(u);
      const ownedQuery = query(collection(db, 'mindMaps'), where('userId', '==', u.uid));
      const sharedQuery = query(collection(db, 'mindMaps'), where('collaborators', 'array-contains', u.email));

      const unsubscribeOwned = onSnapshot(ownedQuery, (snapshot) => {
        const ownedMaps = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setMindMaps(prev => {
          const combined = [...ownedMaps, ...prev.filter(m => m.userId !== u.uid)];
          return combined;
        });
      });
      const unsubscribeShared = onSnapshot(sharedQuery, (snapshot) => {
        const sharedMaps = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setMindMaps(prev => {
          const combined = [...prev, ...sharedMaps];
          return combined.filter((m, i, self) => i === self.findIndex(x => x.id === m.id));
        });
      });
      return () => { unsubscribeOwned(); unsubscribeShared(); };
    });
    return () => unsubscribeAuth();
  }, [navigate]);

  // ── Handlers ──────────────────────────────────────────────
  const handleCreateNewMindMap = async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      const docRef = await addDoc(collection(db, 'mindMaps'), {
        title: newMapName || 'Untitled Mind Map',
        userId: u.uid,
        createdAt: serverTimestamp(),
      });
      for (const node of templates[selectedTemplate]) {
        await addDoc(collection(db, 'mindMaps', docRef.id, 'nodes'), node);
      }
      setOpenNewMapDialog(false);
      setNewMapName('');
      setSelectedTemplate('blank');
      navigate(`/editor/${docRef.id}`);
    } catch (err) { console.error('Error creating mind map:', err); }
  };

  const handleDeleteClick = (id) => { setDeleteId(id); setOpenFirstDialog(true); };
  const handleFirstConfirm = () => { setOpenFirstDialog(false); setOpenSecondDialog(true); };
  const handleSecondConfirm = async () => {
    try {
      const nodesSnap = await getDocs(collection(db, 'mindMaps', deleteId, 'nodes'));
      const nb = writeBatch(db); nodesSnap.forEach(d => nb.delete(d.ref)); await nb.commit();
      const linksSnap = await getDocs(collection(db, 'mindMaps', deleteId, 'links'));
      const lb = writeBatch(db); linksSnap.forEach(d => lb.delete(d.ref)); await lb.commit();
      await deleteDoc(doc(db, 'mindMaps', deleteId));
      // Also remove thumbnail
      deleteThumbnail(deleteId);
      setOpenSecondDialog(false); setDeleteId(null);
    } catch (err) { console.error('Error deleting mind map:', err); }
  };
  const handleCancelDelete = () => { setOpenFirstDialog(false); setOpenSecondDialog(false); setDeleteId(null); };

  const handleShareClick = (id) => { setShareMindMapId(id); setShareDialogOpen(true); };
  const handleShareMindMap = async () => {
    if (!shareEmail.trim() || !shareMindMapId) return;
    try {
      await updateDoc(doc(db, 'mindMaps', shareMindMapId), { collaborators: arrayUnion(shareEmail.trim()) });
      setShareEmail(''); setShareDialogOpen(false); setShareMindMapId(null);
    } catch (err) { console.error('Error sharing mind map:', err); }
  };

  const handleImportClick = () => { fileInputRef.current?.click(); };
  const handleImportChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.nodes || !data.links) throw new Error('Invalid file format');
      const u = auth.currentUser;
      const mindMapRef = await addDoc(collection(db, 'mindMaps'), { title: file.name, userId: u.uid, createdAt: serverTimestamp() });
      const nodeIdMapping = {};
      const batchN = writeBatch(db);
      data.nodes.forEach((node) => {
        const newRef = doc(collection(db, 'mindMaps', mindMapRef.id, 'nodes'));
        batchN.set(newRef, { ...node, id: newRef.id });
        nodeIdMapping[node.id] = newRef.id;
      });
      await batchN.commit();
      const batchL = writeBatch(db);
      data.links.forEach((link) => {
        const ns = nodeIdMapping[link.source], nt = nodeIdMapping[link.target];
        if (!ns || !nt) return;
        const { id, ...ld } = link;
        batchL.set(doc(collection(db, 'mindMaps', mindMapRef.id, 'links')), { ...ld, source: ns, target: nt });
      });
      await batchL.commit();
      navigate(`/editor/${mindMapRef.id}`);
    } catch (err) { console.error('Error importing mind map:', err); }
  };

  const handleSignOut = () => auth.signOut().then(() => navigate('/'));
  const isShared = (m) => m.userId !== user?.uid;

  const handleToggleFavorite = async (e, mapId, currentVal) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, 'mindMaps', mapId), { favorite: !currentVal });
    } catch (err) { console.error('Error toggling favorite:', err); }
  };

  // Sort: favorites first, then by most recently edited
  const sortedMaps = [...mindMaps].sort((a, b) => {
    const fa = a.favorite ? 1 : 0;
    const fb = b.favorite ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const ta = (a.updatedAt || a.createdAt);
    const tb = (b.updatedAt || b.createdAt);
    const da = ta?.toDate?.() || new Date(0);
    const db_ = tb?.toDate?.() || new Date(0);
    return db_ - da;
  });

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="dashboard-page">
      <div className="dashboard-content">
        {/* Header */}
        <header className="dashboard-header">
          <div className="dashboard-header-left">
            <div className="dashboard-logo-icon">N</div>
            <span className="dashboard-logo-text">Note Taker</span>
          </div>
          <div className="dashboard-header-right">
            {user && <span className="dashboard-user-email">{user.email}</span>}
            <button className="dashboard-signout-btn" onClick={handleSignOut}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <LogOutIcon /> Sign Out
              </span>
            </button>
          </div>
        </header>

        {/* Toolbar */}
        <div className="dashboard-toolbar">
          <button className="dashboard-primary-btn" onClick={() => setOpenNewMapDialog(true)}>
            <PlusIcon /> New Mind Map
          </button>
          <button className="dashboard-secondary-btn" onClick={handleImportClick}>
            <UploadIcon /> Import
          </button>
          {sortedMaps.length > 0 && (
            <span className="dashboard-map-count">{sortedMaps.length} mind map{sortedMaps.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Cards Grid */}
        {sortedMaps.length === 0 ? (
          <div className="dashboard-empty">
            <div className="dashboard-empty-icon"><MapIcon /></div>
            <div className="dashboard-empty-title">No mind maps yet</div>
            <div className="dashboard-empty-desc">Create your first mind map to start organizing your thoughts visually.</div>
          </div>
        ) : (
          <div className="dashboard-grid">
            {sortedMaps.map((m, idx) => {
              const accent = getAccent(idx);
              const thumb = thumbnails.get(m.id);
              const isFav = !!m.favorite;
              return (
                <div
                  key={m.id}
                  className={`dashboard-card${isFav ? ' dashboard-card-favorite' : ''}`}
                  style={{ animationDelay: `${idx * 0.04}s` }}
                  onClick={() => navigate(`/editor/${m.id}`)}
                >
                  <div className="dashboard-card-accent" style={{ background: `linear-gradient(180deg, ${accent} 0%, transparent 100%)` }} />
                  {/* Favorite star */}
                  <button
                    className={`dashboard-star-btn${isFav ? ' dashboard-star-btn-active' : ''}`}
                    title={isFav ? 'Unfavorite' : 'Favorite'}
                    onClick={e => handleToggleFavorite(e, m.id, isFav)}
                  >
                    <StarIcon filled={isFav} />
                  </button>
                  {/* Thumbnail preview */}
                  {thumb ? (
                    <div className="dashboard-card-thumbnail">
                      <img src={thumb} alt="" loading="lazy" />
                    </div>
                  ) : (
                    <div className="dashboard-card-thumbnail dashboard-card-thumbnail-empty">
                      <MapIcon />
                    </div>
                  )}
                  <div className="dashboard-card-body">
                    <div className="dashboard-card-title">
                      {m.title}
                      {isShared(m) && <span className="dashboard-shared-badge">Shared</span>}
                    </div>
                    <div className="dashboard-card-date">{formatDate(m.updatedAt || m.createdAt)}</div>
                  </div>
                  <div className="dashboard-card-actions">
                    <button
                      className="dashboard-icon-btn dashboard-icon-btn-share"
                      title="Share"
                      onClick={e => { e.stopPropagation(); handleShareClick(m.id); }}
                    >
                      <ShareIcon />
                    </button>
                    <button
                      className="dashboard-icon-btn dashboard-icon-btn-delete"
                      title="Delete"
                      onClick={e => { e.stopPropagation(); handleDeleteClick(m.id); }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input type="file" accept="application/json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImportChange} />

      {/* Dialogs */}
      <Dialog open={openNewMapDialog} onClose={() => setOpenNewMapDialog(false)} fullWidth maxWidth="sm"
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Create New Mind Map</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <TextField autoFocus margin="dense" label="Mind Map Name" type="text" fullWidth
            value={newMapName} onChange={e => setNewMapName(e.target.value)}
            variant="filled" sx={textFieldSx} />
          <FormControl fullWidth margin="dense" variant="filled">
            <InputLabel sx={{ color: 'rgba(255,255,255,.4)' }}>Template</InputLabel>
            <Select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} sx={selectFieldSx}>
              <MenuItem value="blank">Blank</MenuItem>
              <MenuItem value="brainstorm">Brainstorm</MenuItem>
              <MenuItem value="project">Project</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <button className="dashboard-dialog-cancel" onClick={() => setOpenNewMapDialog(false)}>Cancel</button>
          <button className="dashboard-dialog-confirm" onClick={handleCreateNewMindMap}>Create</button>
        </DialogActions>
      </Dialog>

      <Dialog open={openFirstDialog} onClose={handleCancelDelete} fullWidth maxWidth="sm"
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Confirm Delete</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,.6)', lineHeight: 1.6, margin: 0 }}>
            Are you sure you want to delete this mind map?
          </p>
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <button className="dashboard-dialog-cancel" onClick={handleCancelDelete}>Cancel</button>
          <button className="dashboard-dialog-confirm" onClick={handleFirstConfirm}>Yes, Delete</button>
        </DialogActions>
      </Dialog>

      <Dialog open={openSecondDialog} onClose={handleCancelDelete} fullWidth maxWidth="sm"
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Confirm Delete Again</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,.6)', lineHeight: 1.6, margin: 0 }}>
            This action cannot be undone. Are you really sure?
          </p>
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <button className="dashboard-dialog-cancel" onClick={handleCancelDelete}>Cancel</button>
          <button className="dashboard-dialog-confirm dashboard-dialog-confirm-danger" onClick={handleSecondConfirm}>Delete Forever</button>
        </DialogActions>
      </Dialog>

      <Dialog open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} fullWidth maxWidth="sm"
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Share Mind Map</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <TextField label="Collaborator Email" fullWidth value={shareEmail}
            onChange={e => setShareEmail(e.target.value)} variant="filled" sx={textFieldSx} />
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <button className="dashboard-dialog-cancel" onClick={() => setShareDialogOpen(false)}>Cancel</button>
          <button className="dashboard-dialog-confirm" onClick={handleShareMindMap}>Share</button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

// ── MUI sx props (static, defined once) ─────────────────────
const dialogPaperSx = {
  backgroundColor: '#1a1b1f',
  color: '#e4e4e7',
  borderRadius: '16px',
  border: '1px solid rgba(255,255,255,.08)',
  boxShadow: '0 24px 64px rgba(0,0,0,.5)',
};
const dialogTitleSx = { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.3px', padding: '24px 24px 8px' };
const dialogContentSx = { padding: '16px 24px' };
const dialogActionsSx = { padding: '12px 24px 20px', gap: '8px' };
const textFieldSx = {
  '& .MuiFilledInput-root': {
    backgroundColor: 'rgba(255,255,255,.05)', borderRadius: '10px', color: '#e4e4e7',
    '&:hover': { backgroundColor: 'rgba(255,255,255,.07)' },
    '&.Mui-focused': { backgroundColor: 'rgba(255,255,255,.07)' },
  },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,.4)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#818cf8' },
  '& .MuiFilledInput-underline:before': { borderBottom: 'none' },
  '& .MuiFilledInput-underline:after': { borderBottomColor: '#6366f1' },
};
const selectFieldSx = {
  backgroundColor: 'rgba(255,255,255,.05)', borderRadius: '10px', color: '#e4e4e7',
  '& .MuiSelect-icon': { color: 'rgba(255,255,255,.4)' },
  '&:before': { borderBottom: 'none' },
  '&:after': { borderBottomColor: '#6366f1' },
};

export default Dashboard;
