import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ImageChainStudio from '../apps/ImageChainStudio.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ImageChainStudio />
  </StrictMode>
);
