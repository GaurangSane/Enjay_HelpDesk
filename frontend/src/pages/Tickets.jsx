import React, { useState, useEffect } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import ConfidenceGate from '../components/ConfidenceGate';

const TABS = [
  { label: 'Open',        value: 'open' },
  { label: 'Pending',     value: 'pending' },
  { label: 'HITL',        value: 'hitl' },
  { label: 'AI Resolved', value: 'ai_resolved' },
  { label: 'Resolved',    value: 'resolved' },
];

function statusClass(status) {
  const map = {
    open:        'badge-open',
    pending:     'badge-pending',
    hitl:        'badge-hitl',
    ai_resolved: 'badge-ai_resolved',
    resolved:    'badge-resolved',
  };
  return map[status] ?? 'badge-resolved';
}

function StatusBadge({ status }) {
  return (
    <span className={`badge ${statusClass(status)}`}>
      {status === 'ai_resolved' ? 'AI Resolved' : status.toUpperCase()}
    </span>
  );
}

function TabBar({ status }) {
  return (
    <div className="tab-bar" role="tablist" aria-label="Ticket status filter">
      {TABS.map((tab) => {
        const isActive = status === tab.value;
        return (
          <NavLink
            key={tab.value}
            to={`/tickets/${tab.value}`}
            role="tab"
            aria-selected={isActive}
            style={{
              padding:         '8px 14px',
              color:           isActive ? 'var(--text)' : 'var(--text-muted)',
              textDecoration:  'none',
              fontWeight:      isActive ? 600 : 400,
              fontSize:        'var(--font-size-sm)',
              borderBottom:    isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
              marginBottom:    '-1px',
              borderRadius:    'var(--radius-sm) var(--radius-sm) 0 0',
              backgroundColor: isActive ? 'rgba(91,156,246,0.06)' : 'transparent',
              transition:      'color 150ms ease, background-color 150ms ease',
              whiteSpace:      'nowrap',
              flexShrink:      0,
            }}
          >
            {tab.label}
          </NavLink>
        );
      })}
    </div>
  );
}

export default function Tickets({ status }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const navigate              = useNavigate();

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const res = await fetch(`http://localhost:8000/tickets/?status=${status}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) throw new Error(`Error: ${res.status} ${res.statusText}`);
        setTickets(await res.json());
      } catch (err) {
        setError(err.message || 'Failed to fetch tickets.');
      } finally {
        setLoading(false);
      }
    };
    fetchTickets();
  }, [status]);

  const goToTicket = (id) => navigate(`/tickets/${id}`);

  // ── Shared empty / loading / error states ───────────────────────────
  const emptyState = (
    <div style={{
      padding:         '48px 24px',
      textAlign:       'center',
      backgroundColor: 'var(--surface)',
      borderRadius:    'var(--radius-md)',
      border:          '1px dashed var(--border)',
      color:           'var(--text-muted)',
      fontSize:        'var(--font-size-sm)',
    }}>
      No <strong>{status.replace('_', ' ')}</strong> tickets at this time.
    </div>
  );

  if (loading) {
    return (
      <div>
        <h1 className="page-title" style={{ marginBottom: '20px' }}>Support Tickets</h1>
        <TabBar status={status} />
        <div style={{
          padding: '48px 24px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)',
          backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          Loading tickets…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="page-title" style={{ marginBottom: '20px' }}>Support Tickets</h1>
        <TabBar status={status} />
        <div className="alert alert-danger" role="alert">
          <span className="font-mono">[ERR]</span> {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: '20px' }}>Support Tickets</h1>
      <TabBar status={status} />

      {tickets.length === 0 ? emptyState : (
        <div className="ticket-table-wrap">

          {/* ── Desktop: native <table> (hidden on mobile via CSS) ─── */}
          <table className="ticket-table">
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-raised)' }}>
                <th style={{ paddingLeft: '16px' }}>Subject</th>
                <th>Customer</th>
                <th>Status</th>
                <th>AI Confidence</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => goToTicket(ticket.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ticket: ${ticket.subject}`}
                  style={{ cursor: 'pointer' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') goToTicket(ticket.id);
                  }}
                >
                  <td style={{ paddingLeft: '16px', maxWidth: '300px' }}>
                    <span className="ticket-subject" style={{ fontSize: 'var(--font-size-sm)' }}>
                      {ticket.subject}
                    </span>
                    <div className="font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      #{ticket.id?.substring(0, 8)}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
                    {ticket.customer_email}
                  </td>
                  <td><StatusBadge status={ticket.status} /></td>
                  <td>
                    {ticket.ai_confidence != null ? (
                      <ConfidenceGate score={ticket.ai_confidence} size="sm" />
                    ) : (
                      <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(ticket.created_at).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Mobile: stacked card list (hidden on desktop via CSS) ─ */}
          <ul className="ticket-card-list" role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <div
                  className="ticket-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ticket: ${ticket.subject}`}
                  onClick={() => goToTicket(ticket.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') goToTicket(ticket.id);
                  }}
                >
                  {/* Subject */}
                  <div className="ticket-card__subject">{ticket.subject}</div>

                  {/* Email + status + confidence */}
                  <div className="ticket-card__meta">
                    <span className="ticket-card__email">{ticket.customer_email}</span>
                    <StatusBadge status={ticket.status} />
                    {ticket.ai_confidence != null && (
                      <ConfidenceGate score={ticket.ai_confidence} size="sm" showLabel={false} />
                    )}
                  </div>

                  {/* Footer: ID + timestamp */}
                  <div className="ticket-card__footer">
                    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      #{ticket.id?.substring(0, 8)}
                    </span>
                    <span className="ticket-card__time">
                      {new Date(ticket.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

        </div>
      )}
    </div>
  );
}
