import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider, showGlobalToast } from '@/components/atoms/Toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import './styles/global.css';
import { registerAppServiceWorker } from '@/lib/serviceWorker';

// Apply the saved view mode before first paint to avoid a frame flash.
if (localStorage.getItem('sc_view_mode') === 'frame') {
  document.documentElement.classList.add('framed');
}

const queryClient = new QueryClient({
  // Surface failed background queries to the user instead of leaving screens
  // stuck on empty states or spinners. 401s are intentionally skipped — the
  // AuthContext 401 handler signs the user out and routes them to login.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) return;
      showGlobalToast(error instanceof Error ? error.message : 'Something went wrong');
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </ErrorBoundary>
);

// App-shell service worker (PWA install + offline). Push uses a separate FCM
// worker, registered on demand from requestPushToken().
registerAppServiceWorker();
