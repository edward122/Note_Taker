// src/components/AuthForm.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
} from 'firebase/auth';
import {
  Tabs,
  Tab,
  Box,
  TextField,
  Button,
  Typography,
  Container,
  Paper,
  InputAdornment,
  IconButton,
  Fade
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import GoogleIcon from '@mui/icons-material/Google';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import "./new.css";

const AuthForm = () => {
  const [tab, setTab] = useState(0); // 0 for Login, 1 for Signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        navigate('/dashboard');
      }
    });

    return () => unsubscribeAuth();
  }, [navigate]);

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
    setError('');
  };

  const handleClickShowPassword = () => setShowPassword((show) => !show);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      if (tab === 0) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box
      sx={{
        backgroundColor: '#0a0a0a',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(30,41,59,0.5) 0%, rgba(10,10,10,1) 70%)',
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        px: 2
      }}
    >
      <Fade in timeout={800}>
        <Container maxWidth="sm" disableGutters>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
             <Box 
                sx={{ 
                  display: 'inline-flex',
                  p: 1.5, 
                  borderRadius: '16px', 
                  background: 'rgba(59, 130, 246, 0.1)', 
                  color: '#60a5fa',
                  mb: 2,
                  boxShadow: '0 0 20px rgba(59, 130, 246, 0.2)'
                }}
              >
                <AccountTreeOutlinedIcon sx={{ fontSize: 40 }} />
              </Box>
              <Typography variant="h3" sx={{ 
                fontWeight: 800, 
                letterSpacing: '-0.02em', 
                background: 'linear-gradient(to right, #60a5fa, #c084fc)', 
                WebkitBackgroundClip: 'text', 
                WebkitTextFillColor: 'transparent',
                mb: 1
              }}>
                Note Taker
              </Typography>
              <Typography variant="body1" sx={{ color: '#94a3b8' }}>
                Visualize your ideas like never before.
              </Typography>
          </Box>
          <Paper
            elevation={24}
            sx={{
              backgroundColor: 'rgba(30, 41, 59, 0.6)',
              backdropFilter: 'blur(16px)',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.08)',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <Tabs
              value={tab}
              onChange={handleTabChange}
              variant="fullWidth"
              sx={{
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                '& .MuiTab-root': {
                  color: '#94a3b8',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '1rem',
                  py: 2.5,
                  transition: 'all 0.2s ease',
                  '&.Mui-selected': {
                    color: '#fff',
                  }
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: '#8b5cf6',
                  height: 3,
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                }
              }}
            >
              <Tab label="Welcome Back" />
              <Tab label="Create Account" />
            </Tabs>

            <Box sx={{ p: { xs: 3, sm: 5 } }}>
              <form onSubmit={handleSubmit}>
                <TextField
                  fullWidth
                  placeholder="Email Address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  variant="outlined"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <EmailOutlinedIcon sx={{ color: '#64748b' }} />
                      </InputAdornment>
                    ),
                    sx: { 
                      color: '#fff', 
                      backgroundColor: 'rgba(15, 23, 42, 0.4)',
                      borderRadius: '12px',
                      '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, 
                      '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2) !important' },
                      '&.Mui-focused fieldset': { borderColor: '#8b5cf6 !important' }
                    }
                  }}
                  sx={{ mb: 3 }}
                />
                <TextField
                  fullWidth
                  placeholder="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  variant="outlined"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockOutlinedIcon sx={{ color: '#64748b' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={handleClickShowPassword}
                          edge="end"
                          sx={{ color: '#64748b', '&:hover': { color: '#94a3b8' } }}
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                    sx: { 
                      color: '#fff',
                      backgroundColor: 'rgba(15, 23, 42, 0.4)',
                      borderRadius: '12px',
                      '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, 
                      '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2) !important' },
                      '&.Mui-focused fieldset': { borderColor: '#8b5cf6 !important' }
                    }
                  }}
                />
                
                {error && (
                  <Fade in={!!error}>
                    <Box sx={{ mt: 2, p: 1.5, borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                      <Typography color="#fca5a5" variant="body2" sx={{ textAlign: 'center', fontWeight: 500 }}>
                        {error}
                      </Typography>
                    </Box>
                  </Fade>
                )}

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{ 
                    mt: 4, 
                    mb: 3,
                    py: 1.5,
                    background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                    boxShadow: '0 4px 14px 0 rgba(139, 92, 246, 0.39)',
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '1.05rem',
                    '&:hover': {
                      boxShadow: '0 6px 20px rgba(139, 92, 246, 0.5)',
                      transform: 'translateY(-1px)'
                    },
                    transition: 'all 0.2s ease-in-out'
                  }}
                >
                  {tab === 0 ? 'Sign In' : 'Create Account'}
                </Button>
              </form>

              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <Box sx={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }} />
                <Typography variant="body2" sx={{ color: '#64748b', px: 2, fontWeight: 500 }}>
                  OR
                </Typography>
                <Box sx={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }} />
              </Box>

              <Button 
                fullWidth
                variant="outlined" 
                onClick={handleGoogleSignIn} 
                startIcon={<GoogleIcon sx={{ color: '#fff' }} />}
                sx={{ 
                  py: 1.2,
                  color: '#fff', 
                  borderColor: 'rgba(255,255,255,0.2)',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '1rem',
                  '&:hover': {
                    borderColor: 'rgba(255,255,255,0.4)',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    transform: 'translateY(-1px)'
                  },
                  transition: 'all 0.2s ease'
                }}
              >
                Continue with Google
              </Button>
            </Box>
          </Paper>
        </Container>
      </Fade>
    </Box>
  );
};

export default AuthForm;
