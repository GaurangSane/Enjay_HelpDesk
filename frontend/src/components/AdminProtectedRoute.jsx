import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AdminProtectedRoute({ children }) {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setRole(null);
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .single();

        if (error || !data) {
          setRole(null);
        } else {
          setRole(data.role);
        }
      } catch (err) {
        console.error('Error verifying admin role:', err);
        setRole(null);
      } finally {
        setLoading(false);
      }
    }

    checkRole();
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-family)'
      }}>
        Verifying Admin Access...
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-family)',
        textAlign: 'center',
        gap: 'var(--space-md)',
        padding: 'var(--space-lg)'
      }}>
        <h2 style={{ color: 'var(--accent-danger)' }}>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>
          This page is restricted to administrators only. Your current role does not have permission to view this resource.
        </p>
        <button 
          onClick={() => window.location.href = '/'}
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            backgroundColor: 'var(--accent-primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontWeight: 'bold',
            marginTop: 'var(--space-sm)'
          }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return children;
}
