import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import VideoEffects from '../apps/VideoEffects.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VideoEffects />
  </StrictMode>
);
