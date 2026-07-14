import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function DashboardLayout() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Sidebar */}
      <aside style={{
        width: '240px',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        padding: 'var(--space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-lg)'
      }}>
        <h2 style={{ color: 'var(--accent-primary)', fontSize: 'var(--font-size-xl)' }}>Enjay Helpdesk</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <Link to="/" style={{
            color: 'var(--text-primary)',
            textDecoration: 'none',
            padding: 'var(--space-sm)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)'
          }}>Tickets</Link>
          <Link to="/knowledge-base" style={{
            color: 'var(--text-primary)',
            textDecoration: 'none',
            padding: 'var(--space-sm)',
            borderRadius: 'var(--radius-sm)'
          }}>Knowledge Base</Link>
        </nav>
      </aside>

      {/* Main Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Topbar */}
        <header style={{
          height: '60px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 var(--space-lg)'
        }}>
          <div>
            {user ? (
              <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                Active Agent: <strong>{user.email}</strong>
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Retrieving agent info...</span>
            )}
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            Logout
          </button>
        </header>

        {/* Content Area */}
        <main style={{ flex: 1, padding: 'var(--space-lg)', overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
