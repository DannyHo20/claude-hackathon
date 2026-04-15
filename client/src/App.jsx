import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './routes/Home.jsx';
import Join from './routes/Join.jsx';
import Lobby from './routes/Lobby.jsx';
import Answer from './routes/Answer.jsx';
import Group from './routes/Group.jsx';
import Projector from './routes/Projector.jsx';
import Professor from './routes/Professor.jsx';
import Topics from './routes/Topics.jsx';
import Wall from './routes/Wall.jsx';
import Admin from './routes/Admin.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join" element={<Join />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/lobby/:code" element={<Lobby />} />
        <Route path="/answer/:code" element={<Answer />} />
        <Route path="/group/:code" element={<Group />} />
        <Route path="/group" element={<Group />} />
        <Route path="/projector/:code" element={<Projector />} />
        <Route path="/professor/:code" element={<Professor />} />
        <Route path="/topics" element={<Topics />} />
        <Route path="/wall" element={<Wall />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
