import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import BatchImageStudio from '../apps/BatchImageStudio.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BatchImageStudio />
  </StrictMode>
);
