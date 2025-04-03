// App.jsx
import { Routes, Route } from 'react-router-dom';
import AuthForm from './components/AuthForm';
import Dashboard from './components/Dashboard';
import MindMapEditor from './components/MindMapEditor';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthForm />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/editor/:id" element={<MindMapEditor />} />
    </Routes>
  );
}

export default App;
