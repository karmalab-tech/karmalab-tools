import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ContinuousVideoStudio from '../apps/ContinuousVideoStudio.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ContinuousVideoStudio />
  </StrictMode>
);
