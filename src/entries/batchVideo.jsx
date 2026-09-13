import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import BatchVideoStudio from '../apps/BatchVideoStudio.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BatchVideoStudio />
  </StrictMode>
);
