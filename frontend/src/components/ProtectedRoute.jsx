import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

/**
 * ProtectedRoute
 * --------------
 * Guards routes requiring authentication.
 *
 * States:
 *   - Not logged in            → redirect to /login
 *   - Logged in, role=pending  → redirect to /pending-approval
 *   - Logged in, role=agent/admin → render children
 *
 * Role is fetched from the public.user_roles table via the anon client
 * (the existing RLS policy allows a user to read their own row).
 */
export default function ProtectedRoute({ children }) {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);  // null = loading, string = resolved
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isMounted) return;

      setSession(session);

      if (session?.user) {
        try {
          const { data, error } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', session.user.id)
            .single();

          if (!error && data) {
            if (isMounted) setRole(data.role);
          } else {
            // No row in user_roles yet (trigger may be delayed) — treat as pending
            if (isMounted) setRole('pending_approval');
          }
        } catch {
          if (isMounted) setRole('pending_approval');
        }
      }

      if (isMounted) setLoading(false);
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setSession(session);
      if (!session) {
        setRole(null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)',
        fontFamily: 'var(--font-family)',
      }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (role === 'pending_approval') {
    return <Navigate to="/pending-approval" replace />;
  }

  return children;
}
