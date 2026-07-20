import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { apiUrl } from '../api';

export default function AdminApprovals() {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [approving, setApproving] = useState({}); // { [user_id]: bool }
  const [toast, setToast] = useState(null);

  const triggerToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchPendingUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session.');

      const response = await fetch(apiUrl('/admin/approvals'), {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to load pending users.');
      }

      const data = await response.json();
      setPendingUsers(data.pending_users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (userId, email) => {
    setApproving(prev => ({ ...prev, [userId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(apiUrl(`/admin/approvals/${userId}/approve`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to approve user.');
      }

      const result = await response.json();
      triggerToast(
        `✓ Approved ${email}${result.email_sent ? ' — approval email sent.' : ' (approval email failed to send).'}`
      );
      // Remove from list immediately
      setPendingUsers(prev => prev.filter(u => u.user_id !== userId));
    } catch (err) {
      triggerToast(err.message || 'Failed to approve user.', 'error');
    } finally {
      setApproving(prev => ({ ...prev, [userId]: false }));
    }
  };

  useEffect(() => {
    fetchPendingUsers();
  }, []);

  const cardStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',   /* elevated card feel */
    padding: 'var(--space-4) var(--space-5)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-md)',
    boxShadow: 'var(--shadow-card)',
    transition: 'box-shadow var(--transition-normal), border-color var(--transition-normal)',
  };

  return (
    <div style={{ fontFamily: 'var(--font-family)', color: 'var(--text-primary)' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 'var(--space-lg)', right: 'var(--space-lg)',
          padding: 'var(--space-md) var(--space-lg)',
          backgroundColor: toast.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)',
          color: '#ffffff', borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-raised)', zIndex: 1100, fontWeight: 'bold',
        }}>
          {toast.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Pending Approvals</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            New accounts waiting for admin approval before they can access the dashboard.
          </p>
        </div>
        <button
          onClick={fetchPendingUsers}
          disabled={loading}
          style={{
            padding: 'var(--space-sm) var(--space-md)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: 'var(--space-md)',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--accent-danger)',
          color: 'var(--accent-danger)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-sm)',
          marginBottom: 'var(--space-md)',
        }}>
          {error}
        </div>
      )}

      {loading ? (
        /* Skeleton loading placeholders for pending users */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{
              ...cardStyle,
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                <span className="skeleton skeleton-text" style={{ width: `${55 - i * 5}%`, height: '15px' }} />
                <span className="skeleton skeleton-text-sm" style={{ width: '150px' }} />
                <span className="skeleton skeleton-text-sm" style={{ width: '200px' }} />
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                <span className="skeleton skeleton-badge" style={{ width: '110px' }} />
                <span className="skeleton" style={{ width: '90px', height: '34px', borderRadius: 'var(--radius-md)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : pendingUsers.length === 0 ? (
        <div style={{
          ...cardStyle,
          justifyContent: 'center',
          padding: 'var(--space-xl)',
          color: 'var(--text-muted)',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
        }}>
          <span style={{ fontSize: '32px' }}>✓</span>
          <span>No pending approvals — all caught up!</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {pendingUsers.map((user) => (
            <div key={user.user_id} style={cardStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>
                  {user.email || 'Email not found'}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Requested: {new Date(user.created_at).toLocaleString()}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {user.user_id}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span style={{
                  padding: '2px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: 'var(--accent-warning)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  whiteSpace: 'nowrap',
                }}>
                  Pending Approval
                </span>
                <button
                  onClick={() => handleApprove(user.user_id, user.email)}
                  disabled={approving[user.user_id]}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    backgroundColor: approving[user.user_id] ? 'rgba(22,163,74,0.45)' : 'var(--accent-success)',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: approving[user.user_id] ? 'not-allowed' : 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    whiteSpace: 'nowrap',
                    boxShadow: approving[user.user_id] ? 'none' : '0 1px 3px rgba(22,163,74,0.30)',
                    transition: 'filter 150ms ease, box-shadow 150ms ease, transform 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!approving[user.user_id]) {
                      e.currentTarget.style.filter = 'brightness(1.08)';
                      e.currentTarget.style.boxShadow = '0 4px 10px rgba(22,163,74,0.35)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.filter = 'brightness(1)';
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(22,163,74,0.30)';
                  }}
                  onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.967)'; }}
                  onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  {approving[user.user_id] ? 'Approving…' : '✓ Approve'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
