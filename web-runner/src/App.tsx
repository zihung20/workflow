import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ThemeProvider } from './context/ThemeContext';

const HomePage     = lazy(() => import('./pages/HomePage'));
const ExamplesPage = lazy(() => import('./pages/ExamplesPage'));
const DesignerPage = lazy(() => import('./pages/DesignerPage'));

function Spinner() {
  return (
    <div className="h-screen flex items-center justify-center bg-white dark:bg-slate-900">
      <div className="w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/examples" element={<Navigate to="/examples/purchase-order" replace />} />
            <Route path="/examples/:id" element={<ExamplesPage />} />
            <Route path="/designer" element={<DesignerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </ThemeProvider>
  );
}
