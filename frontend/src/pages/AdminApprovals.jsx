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
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-md)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-md)',
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
        <div style={{ color: 'var(--text-secondary)', padding: 'var(--space-xl)', textAlign: 'center' }}>
          Loading pending users…
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
                    padding: 'var(--space-sm) var(--space-md)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: approving[user.user_id] ? 'rgba(16,185,129,0.4)' : 'var(--accent-success)',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    cursor: approving[user.user_id] ? 'not-allowed' : 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    whiteSpace: 'nowrap',
                    transition: 'opacity 0.15s',
                  }}
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
