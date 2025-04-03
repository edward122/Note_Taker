// src/components/AuthForm.jsx
import React, { useState } from 'react';
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
  Container
} from '@mui/material';
import "./new.css";
const AuthForm = () => {
  const [tab, setTab] = useState(0); // 0 for Login, 1 for Signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
    setError('');
  };

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
    <Container 
      maxWidth="sm"
      sx={{
        // Dark background for the entire container
        backgroundColor: '#121212',
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Box
        sx={{
          mt: 8,
          p: 4,
          backgroundColor: '#424242',
          borderRadius: 2,
          boxShadow: 3,
          color: '#fff',
        }}
      >
        <Tabs
          value={tab}
          onChange={handleTabChange}
          variant="fullWidth"
          textColor="inherit"
          indicatorColor="primary"
        >
          <Tab label="Login" />
          <Tab label="Signup" />
        </Tabs>
        <form onSubmit={handleSubmit}>
          <TextField
            margin="normal"
            fullWidth
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            variant="filled"
            InputLabelProps={{ style: { color: '#fff' } }}
            InputProps={{
              style: { backgroundColor: '#333', color: '#fff' },
            }}
          />
          <TextField
            margin="normal"
            fullWidth
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            variant="filled"
            InputLabelProps={{ style: { color: '#fff' } }}
            InputProps={{
              style: { backgroundColor: '#333', color: '#fff' },
            }}
          />
          {error && (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          )}
          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 2, backgroundColor: '#1976d2' }}
          >
            {tab === 0 ? 'Login' : 'Signup'}
          </Button>
        </form>
        <Box textAlign="center" sx={{ mt: 2 }}>
          <Typography variant="body1">or</Typography>
          <Button variant="outlined" onClick={handleGoogleSignIn} sx={{ mt: 1, color: '#fff', borderColor: '#fff' }}>
            Sign in with Google
          </Button>
        </Box>
      </Box>
    </Container>
  );
};

export default AuthForm;
