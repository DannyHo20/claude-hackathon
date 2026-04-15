import React, { useEffect, useState } from 'react';
import TopicsScreen from './screens/TopicsScreen.jsx';
import GroupScreen from './screens/GroupScreen.jsx';
import WallScreen from './screens/WallScreen.jsx';
import AdminScreen from './screens/AdminScreen.jsx';

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export default function App() {
  const path = useRoute();
  const [tab, setTab] = useState('topics');

  if (path.startsWith('/admin')) return <AdminScreen />;

  return (
    <div className="app">
      {tab === 'topics' && <TopicsScreen />}
      {tab === 'group' && <GroupScreen />}
      {tab === 'wall' && <WallScreen />}
      <nav className="tabs">
        <button className={`tab ${tab === 'topics' ? 'active' : ''}`} onClick={() => setTab('topics')}>
          <span className="tab-icon">●</span>Topics
        </button>
        <button className={`tab ${tab === 'group' ? 'active' : ''}`} onClick={() => setTab('group')}>
          <span className="tab-icon">◆</span>My Group
        </button>
        <button className={`tab ${tab === 'wall' ? 'active' : ''}`} onClick={() => setTab('wall')}>
          <span className="tab-icon">◼</span>Wall
        </button>
      </nav>
    </div>
  );
}
