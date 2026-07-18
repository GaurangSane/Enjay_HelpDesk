import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function DashboardLayout() {
  const [user,        setUser]        = useState(null);
  const [isAdmin,     setIsAdmin]     = useState(false);
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const navigate                      = useNavigate();
  const location                      = useLocation();
  const drawerRef                     = useRef(null);

  // Close drawer on route change (user tapped a nav link on mobile)
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Close drawer on click-outside
  const handleBackdropClick = useCallback(() => setDrawerOpen(false), []);

  // Trap Escape key to close drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  useEffect(() => {
    async function fetchUserAndRole() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        try {
          const { data, error } = await supabase
            .from('user_roles').select('role').eq('user_id', user.id).single();
          if (!error && data?.role === 'admin') setIsAdmin(true);
        } catch (err) {
          console.error('Error fetching role in layout:', err);
        }
      }
    }
    fetchUserAndRole();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const navLinkStyle = ({ isActive }) => ({
    display:         'flex',
    alignItems:      'center',
    gap:             '8px',
    color:           isActive ? 'var(--text)' : 'var(--text-muted)',
    textDecoration:  'none',
    padding:         '8px 12px',
    borderRadius:    'var(--radius-md)',
    fontSize:        'var(--font-size-sm)',
    fontWeight:      isActive ? 600 : 400,
    backgroundColor: isActive ? 'rgba(37,99,235,0.08)' : 'transparent',
    borderLeft:      isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
    transition:      'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
  });

  // Sidebar nav content — same markup used in both desktop sidebar and mobile drawer
  const SidebarContent = () => (
    <>
      {/* Brand + close button row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{
            fontFamily:    'var(--font-display)',
            fontSize:      'var(--font-size-xl)',
            fontWeight:    600,
            color:         'var(--accent-primary)',
            letterSpacing: '-0.02em',
            display:       'block',
            lineHeight:    1.2,
          }}>
            Enjay
          </span>
          <span style={{
            fontFamily:    'var(--font-ui)',
            fontSize:      'var(--font-size-xs)',
            color:         'var(--text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight:    500,
          }}>
            Helpdesk
          </span>
        </div>
        {/* Close button — only visible on mobile via CSS */}
        <button
          className="drawer-close-btn"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation menu"
        >
          ✕
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <p style={{
          fontSize:      'var(--font-size-xs)',
          color:         'var(--text-muted)',
          fontWeight:    600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding:       '0 12px',
          marginBottom:  '4px',
        }}>
          Tickets
        </p>

        {[
          { to: '/tickets/open',        label: 'Open' },
          { to: '/tickets/pending',     label: 'Pending' },
          { to: '/tickets/hitl',        label: 'Needs Review' },
          { to: '/tickets/ai_resolved', label: 'AI Resolved' },
          { to: '/tickets/resolved',    label: 'Resolved' },
        ].map(({ to, label }) => (
          <NavLink key={to} to={to} style={navLinkStyle}>{label}</NavLink>
        ))}

        <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '8px 0' }} />

        <NavLink to="/knowledge-base" style={navLinkStyle}>Knowledge Base</NavLink>

        {isAdmin && (
          <>
            <NavLink to="/analytics"      style={navLinkStyle}>Analytics</NavLink>
            <NavLink to="/admin/approvals" style={navLinkStyle}>Approvals</NavLink>
          </>
        )}
      </nav>
    </>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)', color: 'var(--text)' }}>

      {/* ── Backdrop (mobile only) ──────────────────────────────────── */}
      <div
        className={`drawer-backdrop${drawerOpen ? ' is-open' : ''}`}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* ── Sidebar / Drawer ────────────────────────────────────────── */}
      <aside
        ref={drawerRef}
        className={`sidebar${drawerOpen ? ' is-open' : ''}`}
        aria-label="Site navigation"
        aria-hidden={!drawerOpen ? undefined : undefined}
        id="main-nav"
      >
        <SidebarContent />
      </aside>

      {/* ── Main panel ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Topbar */}
        <header className="topbar">
          {/* Left: hamburger (mobile) + agent info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <button
              className="hamburger-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              aria-controls="main-nav"
            >
              {/* Three-line icon */}
              <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
                <rect x="0" y="0"  width="18" height="2" rx="1" fill="currentColor"/>
                <rect x="0" y="6"  width="18" height="2" rx="1" fill="currentColor"/>
                <rect x="0" y="12" width="18" height="2" rx="1" fill="currentColor"/>
              </svg>
            </button>

            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', minWidth: 0 }} className="truncate">
              {user ? (
                <>Active Agent: <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{user.email}</strong></>
              ) : (
                <span style={{ opacity: 0.6 }}>Retrieving agent info…</span>
              )}
            </div>
          </div>

          {/* Right: logout */}
          <button
            onClick={handleLogout}
            style={{
              padding:         '6px 16px',
              borderRadius:    'var(--radius-md)',
              border:          '1px solid var(--border)',
              backgroundColor: 'transparent',
              color:           'var(--text-muted)',
              fontSize:        'var(--font-size-sm)',
              fontWeight:      500,
              cursor:          'pointer',
              flexShrink:      0,
              transition:      'border-color 150ms ease, color 150ms ease, background-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor     = 'var(--accent-danger)';
              e.currentTarget.style.color           = 'var(--accent-danger)';
              e.currentTarget.style.backgroundColor = 'rgba(239,107,107,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor     = 'var(--border)';
              e.currentTarget.style.color           = 'var(--text-muted)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Sign out
          </button>
        </header>

        {/* Content */}
        <main className="main-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
