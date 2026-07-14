import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: 'development',
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={
      <div style={{
        padding: 'var(--space-2xl)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-family)',
        textAlign: 'center',
        gap: 'var(--space-md)'
      }}>
        <h2 style={{ color: 'var(--accent-danger)' }}>An unexpected error occurred</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '500px' }}>
          The application encountered an unhandled error. The engineering team has been notified. Please refresh the page or contact support if the issue persists.
        </p>
        <button 
          onClick={() => window.location.reload()}
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            backgroundColor: 'var(--accent-primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Refresh Page
        </button>
      </div>
    }>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
