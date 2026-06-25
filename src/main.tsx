import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/atoms/Toast';
import './styles/global.css';

// Apply the saved view mode before first paint to avoid a frame flash.
if (localStorage.getItem('sc_view_mode') === 'frame') {
  document.documentElement.classList.add('framed');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

// Register the app-shell service worker (PWA install + offline). Push uses a
// separate FCM worker, registered on demand from requestPushToken().
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
