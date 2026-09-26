import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { UserChat } from './user/UserChat.js';
import './index.css';

const isAdminRoute = window.location.pathname === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? <App /> : <UserChat />}
  </StrictMode>,
);
