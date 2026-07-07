import React from 'react';
import { supabase } from '../supabaseClient';

export default function Dashboard() {
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={{ padding: 'var(--space-xl)', backgroundColor: 'var(--bg-primary)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      <header style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: 'var(--space-xl)', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--space-md)' }}>
        <h1 style={{ color: 'var(--accent-primary)' }}>Enjay Helpdesk Dashboard</h1>
        <button
          onClick={handleLogout}
          style={{
            padding: 'var(--space-sm) var(--space-md)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            cursor: 'pointer'
          }}
        >
          Sign Out
        </button>
      </header>
      
      <main>
        <p style={{ color: 'var(--text-secondary)' }}>Welcome to the agent support ticket interface. This is a protected route.</p>
      </main>
    </div>
  );
}
