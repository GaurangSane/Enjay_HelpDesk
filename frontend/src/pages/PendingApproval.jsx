import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function PendingApproval() {
  const [email, setEmail] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setEmail(user.email);
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', backgroundColor: 'var(--bg-primary)',
      fontFamily: 'var(--font-family)', color: 'var(--text-primary)',
    }}>
      <div style={{
        width: '100%', maxWidth: '480px', padding: 'var(--space-xl)',
        backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)',
        textAlign: 'center', boxShadow: 'var(--shadow-raised)',
      }}>
        <div style={{ fontSize: '56px', lineHeight: 1 }}>⏳</div>

        <div>
          <h2 style={{ margin: '0 0 var(--space-xs)', color: 'var(--text-primary)' }}>
            Awaiting Admin Approval
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: '1.6' }}>
            Your account <strong style={{ color: 'var(--text-primary)' }}>{email}</strong> has been
            created and is pending approval by an administrator.
          </p>
        </div>

        <div style={{
          padding: 'var(--space-md)',
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)',
        }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--accent-warning)', fontWeight: 'bold' }}>
            What happens next?
          </p>
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            An admin will review your request and approve your account.
            You'll receive an email at <strong>{email}</strong> once you're approved —
            then you can log in normally.
          </p>
        </div>

        <button
          onClick={handleLogout}
          style={{
            padding: 'var(--space-sm) var(--space-md)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
