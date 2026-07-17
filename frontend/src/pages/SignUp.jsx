import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function SignUp() {
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error,           setError]           = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [submitted,       setSubmitted]       = useState(false);
  const navigate                              = useNavigate();

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (password.length < 8)          { setError('Password must be at least 8 characters.'); return; }

    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) throw authError;
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <h1 className="page-title" style={{ fontSize: 'var(--font-size-xl)', marginBottom: '8px' }}>
            Request Submitted
          </h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Your account has been created for <strong style={{ color: 'var(--text)' }}>{email}</strong>.
            An administrator will review and approve your request. You'll receive an email once approved.
          </p>
          <Link
            to="/login"
            style={{ color: 'var(--accent-primary)', fontSize: 'var(--font-size-sm)', textDecoration: 'none' }}
          >
            ← Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="page-title" style={{ fontSize: 'var(--font-size-xl)', marginBottom: '4px' }}>
          Create an Account
        </h1>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '24px' }}>
          Enjay Helpdesk · Agent Sign-Up
        </p>

        {error && (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="signup-email" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              Email Address
            </label>
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@company.com"
              className="auth-input"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="signup-password" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="auth-input"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="signup-confirm" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              Confirm Password
            </label>
            <input
              id="signup-confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="auth-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="auth-submit-btn"
            style={{ marginTop: '4px' }}
          >
            {loading ? 'Creating account…' : 'Request Access'}
          </button>
        </form>

        <p style={{ marginTop: '20px', textAlign: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
