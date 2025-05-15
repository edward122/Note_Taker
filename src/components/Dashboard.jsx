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
  setDoc,
  updateDoc,
  arrayUnion,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase/firebase';
import { useNavigate } from 'react-router-dom';
import {
  Grid,
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  useTheme,
  useMediaQuery
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ShareIcon from '@mui/icons-material/Share';

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

const Dashboard = () => {
  const [mindMaps, setMindMaps] = useState([]);
  const [deleteId, setDeleteId] = useState(null);
  const [openFirstDialog, setOpenFirstDialog] = useState(false);
  const [openSecondDialog, setOpenSecondDialog] = useState(false);
  const [openNewMapDialog, setOpenNewMapDialog] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank');
  // State for share functionality:
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareMindMapId, setShareMindMapId] = useState(null);
  const [shareEmail, setShareEmail] = useState('');
  const navigate = useNavigate();

  // Ref for import file input
  const fileInputRef = useRef(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    // Wait for the current user
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (!user) {
        navigate('/');
        return;
      }

      // Query for maps the user owns
      const ownedQuery = query(
        collection(db, 'mindMaps'),
        where('userId', '==', user.uid)
      );

      // Query for maps shared with the user (collaborators array contains user's email)
      const sharedQuery = query(
        collection(db, 'mindMaps'),
        where('collaborators', 'array-contains', user.email)
      );

      // Subscribe to owned maps
      const unsubscribeOwned = onSnapshot(ownedQuery, (snapshot) => {
        const ownedMaps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMindMaps(prev => {
          // Remove duplicates if any exist (in case a map appears in both queries)
          const combined = [...ownedMaps, ...prev.filter(map => map.userId !== user.uid)];
          return combined;
        });
      });

      // Subscribe to shared maps
      const unsubscribeShared = onSnapshot(sharedQuery, (snapshot) => {
        const sharedMaps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMindMaps(prev => {
          // Combine and remove duplicates (by id)
          const combined = [...prev, ...sharedMaps];
          const unique = combined.filter((map, index, self) =>
            index === self.findIndex(m => m.id === map.id)
          );
          return unique;
        });
      });

      return () => {
        unsubscribeOwned();
        unsubscribeShared();
      };
    });

    return () => unsubscribeAuth();
  }, [navigate]);

  const handleOpenNewMapDialog = () => {
    setOpenNewMapDialog(true);
  };

  const handleCreateNewMindMap = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'mindMaps'), {
        title: newMapName || 'Untitled Mind Map',
        userId: user.uid,
        createdAt: serverTimestamp()
      });
      // Pre-populate nodes if a template is chosen
      const templateNodes = templates[selectedTemplate];
      for (const node of templateNodes) {
        await addDoc(collection(db, 'mindMaps', docRef.id, 'nodes'), node);
      }
      setOpenNewMapDialog(false);
      setNewMapName('');
      setSelectedTemplate('blank');
      navigate(`/editor/${docRef.id}`);
    } catch (error) {
      console.error("Error creating mind map:", error);
    }
  };

  const handleDeleteClick = (id) => {
    setDeleteId(id);
    setOpenFirstDialog(true);
  };

  const handleFirstConfirm = () => {
    setOpenFirstDialog(false);
    setOpenSecondDialog(true);
  };

  const handleSecondConfirm = async () => {
    try {
      // 1. Delete all node documents in the "nodes" subcollection
      const nodesSnapshot = await getDocs(
        collection(db, 'mindMaps', deleteId, 'nodes')
      );
      const nodesBatch = writeBatch(db);
      nodesSnapshot.forEach((docSnapshot) => {
        nodesBatch.delete(docSnapshot.ref);
      });
      await nodesBatch.commit();
  
      // 2. Delete all link documents in the "links" subcollection
      const linksSnapshot = await getDocs(
        collection(db, 'mindMaps', deleteId, 'links')
      );
      const linksBatch = writeBatch(db);
      linksSnapshot.forEach((docSnapshot) => {
        linksBatch.delete(docSnapshot.ref);
      });
      await linksBatch.commit();
  
      // 3. Delete the main mind map document
      await deleteDoc(doc(db, 'mindMaps', deleteId));
  
      setOpenSecondDialog(false);
      setDeleteId(null);
    } catch (error) {
      console.error("Error deleting mind map:", error);
    }
  };

  const handleCancelDelete = () => {
    setOpenFirstDialog(false);
    setOpenSecondDialog(false);
    setDeleteId(null);
  };

  // Share functionality: open share dialog for the given mind map
  const handleShareClick = (id) => {
    setShareMindMapId(id);
    setShareDialogOpen(true);
  };

  const handleShareMindMap = async () => {
    if (!shareEmail.trim() || !shareMindMapId) return;
    try {
      const mindMapRef = doc(db, 'mindMaps', shareMindMapId);
      await updateDoc(mindMapRef, {
        collaborators: arrayUnion(shareEmail.trim())
      });
      setShareEmail('');
      setShareDialogOpen(false);
      setShareMindMapId(null);
    } catch (error) {
      console.error("Error sharing mind map:", error);
    }
  };

  const handleCardClick = (id) => {
    navigate(`/editor/${id}`);
  };

  // Import functionality: trigger file input
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleImportChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.nodes || !data.links) {
        throw new Error("Invalid file format");
      }
      const user = auth.currentUser;
      // Create the new mind map document.
      const mindMapRef = await addDoc(collection(db, "mindMaps"), {
        title: file.name,
        userId: user.uid,
        createdAt: serverTimestamp()
      });

      // Prepare a mapping from old node IDs to new node IDs.
      const nodeIdMapping = {};

      // Batch write for nodes.
      const batchNodes = writeBatch(db);
      data.nodes.forEach((node) => {
        const oldId = node.id; // Preserve the original ID for mapping.
        // Create a new document reference which generates a new ID.
        const newNodeRef = doc(collection(db, "mindMaps", mindMapRef.id, "nodes"));
        const newNodeData = { ...node, id: newNodeRef.id }; // Override id with new ID.
        batchNodes.set(newNodeRef, newNodeData);
        nodeIdMapping[oldId] = newNodeRef.id;
      });
      await batchNodes.commit();

      // Batch write for links.
      const batchLinks = writeBatch(db);
      data.links.forEach((link) => {
        const newSource = nodeIdMapping[link.source];
        const newTarget = nodeIdMapping[link.target];
        if (!newSource || !newTarget) {
          console.error("Skipping link: missing mapping for source or target");
          return;
        }
        const { id, ...linkData } = link;
        const newLinkRef = doc(collection(db, "mindMaps", mindMapRef.id, "links"));
        batchLinks.set(newLinkRef, {
          ...linkData,
          source: newSource,
          target: newTarget
        });
      });
      await batchLinks.commit();

      navigate(`/editor/${mindMapRef.id}`);
    } catch (error) {
      console.error("Error importing mind map:", error);
    }
  };


  return (
    <Box sx={{
      p: isMobile ? 1 : 3,
      background: 'radial-gradient(circle at center, #1D2022 0%, #0f1011 100%)',
      minHeight: '100vh',
      color: '#fff',
      border: isMobile ? 'none' : '5px solid #262626',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
    }}>
      <Box sx={{
        mb: isMobile ? 1 : 3,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        width: isMobile ? '100%' : 'auto',
      }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleOpenNewMapDialog}
          sx={{
            mr: isMobile ? 0 : 2,
            mb: isMobile ? 1 : 0,
            width: isMobile ? '100%' : 'auto',
            background: "radial-gradient(circle at center,rgba(29, 32, 34, .5) 0%,rgba(56, 60, 63, 0.73) 130%)"
          }}
        >
          New Mind Map
        </Button>
        <Button
          variant="contained"
          onClick={handleImportClick}
          sx={{
            mr: isMobile ? 0 : 1,
            mb: isMobile ? 1 : 0,
            width: isMobile ? '100%' : 'auto',
            background: "radial-gradient(circle at center,rgba(29, 32, 34, .5) 0%,rgba(56, 60, 63, 0.73) 130%)"
          }}
        >
          Import Mind Map
        </Button>
      </Box>
      <Grid
        container
        spacing={isMobile ? 1 : 2}
        sx={{
          mt: isMobile ? 1 : 2,
          mb: isMobile ? 1 : 3,
          width: '100%',
        }}
        justifyContent={isMobile ? 'center' : 'flex-start'}
      >
        {mindMaps.map((mindMap) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={mindMap.id} sx={{ display: 'flex', justifyContent: isMobile ? 'center' : 'flex-start' }}>
            <Card
              sx={{
                background: 'linear-gradient(135deg, #23272f 60%, #23272f 100%)',
                color: '#fff',
                p: isMobile ? 1 : 2,
                borderRadius: '14px',
                border: 'none',
                boxShadow: isMobile ? '0 1px 4px 1px rgba(0,0,0,0.3)' : '0 2px 8px 2px rgba(0,0,0,0.5)',
                transition: 'transform 0.3s, box-shadow 0.2s, border 0.3s',
                height: isMobile ? 'auto' : '120px',
                width: isMobile ? '100%' : '260px',
                maxWidth: '100%',
                minWidth: isMobile ? '0' : '200px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                '&:hover': {
                  border: '2px solid #007bff',
                  transform: isMobile ? 'none' : 'translateY(-4px) scale(1.02)',
                  boxShadow: isMobile ? '0 2px 8px 2px rgba(0,0,0,0.4)' : '0 4px 16px 4px rgba(0,0,0,0.7)',
                },
              }}
            >
              <CardContent
                onClick={() => handleCardClick(mindMap.id)}
                sx={{
                  cursor: 'pointer',
                  p: isMobile ? 1 : 2,
                  pb: '8px !important',
                  textAlign: isMobile ? 'center' : 'left',
                  display: 'flex',
                  alignItems: 'flex-start',
                  minHeight: isMobile ? 'auto' : '50px',
                }}
              >
                <Typography
                  variant={isMobile ? 'h6' : 'h6'}
                  sx={{
                    fontWeight: 900,
                    fontSize: isMobile ? '1.1rem' : '1.2rem',
                    wordBreak: 'break-word',
                    letterSpacing: '-0.5px',
                    lineHeight: 1.2,
                    textShadow: '0 2px 8px #000a',
                  }}
                >
                  {mindMap.title}
                </Typography>
              </CardContent>
              <CardActions
                sx={{
                  border: '0px solid white',
                  color: '#fff',
                  borderRadius: '10%',
                  justifyContent: isMobile ? 'center' : 'flex-end',
                  p: isMobile ? 0.5 : 1,
                  pt: 0,
                  gap: isMobile ? 1 : 2,
                }}
              >
                <IconButton onClick={() => handleShareClick(mindMap.id)} color="primary" size={isMobile ? 'small' : 'medium'} sx={{ mx: 0.5 }}>
                  <ShareIcon fontSize={isMobile ? 'small' : 'medium'} />
                </IconButton>
                <IconButton onClick={() => handleDeleteClick(mindMap.id)} color="error" size={isMobile ? 'small' : 'medium'} sx={{ mx: 0.5 }}>
                  <DeleteIcon fontSize={isMobile ? 'small' : 'medium'} />
                </IconButton>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Hidden file input for import */}
      <input
        type="file"
        accept="application/json"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleImportChange}
      />

      {/* New Mind Map Dialog */}
      <Dialog
        open={openNewMapDialog}
        onClose={() => setOpenNewMapDialog(false)}
        fullWidth
        maxWidth={isMobile ? 'xs' : 'sm'}
        PaperProps={{ sx: { backgroundColor: '#424242', color: '#fff', borderRadius: isMobile ? 2 : 3, p: isMobile ? 1 : 2 } }}
      >
        <DialogTitle sx={{ fontSize: isMobile ? '1.1rem' : '1.3rem' }}>Create New Mind Map</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Mind Map Name"
            type="text"
            fullWidth
            value={newMapName}
            onChange={(e) => setNewMapName(e.target.value)}
            variant="filled"
            InputLabelProps={{ style: { color: '#fff' } }}
            sx={{ backgroundColor: '#555', fontSize: isMobile ? '1rem' : '1.1rem' }}
          />
          <FormControl fullWidth margin="dense" variant="filled">
            <InputLabel id="template-select-label" sx={{ color: '#fff' }}>Template</InputLabel>
            <Select
              labelId="template-select-label"
              value={selectedTemplate}
              label="Template"
              onChange={(e) => setSelectedTemplate(e.target.value)}
              sx={{ backgroundColor: '#555', color: '#fff' }}
            >
              <MenuItem value="blank">Blank</MenuItem>
              <MenuItem value="brainstorm">Brainstorm</MenuItem>
              <MenuItem value="project">Project</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 1 : 0 }}>
          <Button onClick={() => setOpenNewMapDialog(false)} sx={{ color: '#fff', width: isMobile ? '100%' : 'auto' }}>
            Cancel
          </Button>
          <Button onClick={handleCreateNewMindMap} variant="contained" sx={{ width: isMobile ? '100%' : 'auto' }}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialogs */}
      <Dialog
        open={openFirstDialog}
        onClose={handleCancelDelete}
        fullWidth
        maxWidth={isMobile ? 'xs' : 'sm'}
        PaperProps={{ sx: { backgroundColor: '#424242', color: '#fff', borderRadius: isMobile ? 2 : 3, p: isMobile ? 1 : 2 } }}
      >
        <DialogTitle sx={{ fontSize: isMobile ? '1.1rem' : '1.3rem' }}>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: isMobile ? '1rem' : '1.1rem' }}>Are you sure you want to delete this mind map?</Typography>
        </DialogContent>
        <DialogActions sx={{ flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 1 : 0 }}>
          <Button onClick={handleCancelDelete} sx={{ color: '#fff', width: isMobile ? '100%' : 'auto' }}>Cancel</Button>
          <Button onClick={handleFirstConfirm} color="primary" sx={{ width: isMobile ? '100%' : 'auto' }}>Yes</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={openSecondDialog}
        onClose={handleCancelDelete}
        fullWidth
        maxWidth={isMobile ? 'xs' : 'sm'}
        PaperProps={{ sx: { backgroundColor: '#424242', color: '#fff', borderRadius: isMobile ? 2 : 3, p: isMobile ? 1 : 2 } }}
      >
        <DialogTitle sx={{ fontSize: isMobile ? '1.1rem' : '1.3rem' }}>Confirm Delete Again</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: isMobile ? '1rem' : '1.1rem' }}>This action cannot be undone. Are you really sure?</Typography>
        </DialogContent>
        <DialogActions sx={{ flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 1 : 0 }}>
          <Button onClick={handleCancelDelete} sx={{ color: '#fff', width: isMobile ? '100%' : 'auto' }}>Cancel</Button>
          <Button onClick={handleSecondConfirm} color="error" sx={{ width: isMobile ? '100%' : 'auto' }}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Share Dialog */}
      <Dialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        fullWidth
        maxWidth={isMobile ? 'xs' : 'sm'}
        PaperProps={{ sx: { backgroundColor: '#424242', color: '#fff', borderRadius: isMobile ? 2 : 3, p: isMobile ? 1 : 2 } }}
      >
        <DialogTitle sx={{ fontSize: isMobile ? '1.1rem' : '1.3rem' }}>Share Mind Map</DialogTitle>
        <DialogContent>
          <TextField
            label="Collaborator Email"
            fullWidth
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            variant="filled"
            InputLabelProps={{ style: { color: '#fff' } }}
            sx={{ backgroundColor: '#555', fontSize: isMobile ? '1rem' : '1.1rem' }}
          />
        </DialogContent>
        <DialogActions sx={{ flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 1 : 0 }}>
          <Button onClick={() => setShareDialogOpen(false)} sx={{ color: '#fff', width: isMobile ? '100%' : 'auto' }}>
            Cancel
          </Button>
          <Button onClick={handleShareMindMap} variant="contained" sx={{ width: isMobile ? '100%' : 'auto' }}>
            Share
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Dashboard;
