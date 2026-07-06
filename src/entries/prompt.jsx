import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PromptBox from '../apps/PromptBox.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PromptBox />
  </StrictMode>
);
