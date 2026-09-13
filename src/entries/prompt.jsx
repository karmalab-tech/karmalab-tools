import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ChatBoxStudio from '../apps/ChatBoxStudio.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ChatBoxStudio />
  </StrictMode>
);
