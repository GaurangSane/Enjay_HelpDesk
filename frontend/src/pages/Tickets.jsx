import React, { useState, useEffect } from 'react';

export default function Tickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const response = await fetch('http://localhost:8000/tickets/');
        if (!response.ok) {
          throw new Error(`Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        setTickets(data);
      } catch (err) {
        setError(err.message || 'Failed to fetch tickets.');
      } finally {
        setLoading(false);
      }
    };

    fetchTickets();
  }, []);

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading tickets...</div>;
  }

  if (error) {
    return (
      <div style={{
        padding: 'var(--space-md)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid var(--accent-danger)',
        color: 'var(--accent-danger)',
        borderRadius: 'var(--radius-sm)'
      }}>
        {error}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: 'var(--space-md)' }}>Support Tickets</h2>
      
      {tickets.length === 0 ? (
        <div style={{
          padding: 'var(--space-2xl)',
          textAlign: 'center',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--border-color)',
          color: 'var(--text-secondary)'
        }}>
          No tickets yet
        </div>
      ) : (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
                <th style={{ padding: 'var(--space-sm) var(--space-md)' }}>Subject</th>
                <th style={{ padding: 'var(--space-sm) var(--space-md)' }}>Customer</th>
                <th style={{ padding: 'var(--space-sm) var(--space-md)' }}>Status</th>
                <th style={{ padding: 'var(--space-sm) var(--space-md)' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>{ticket.subject}</td>
                  <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>{ticket.customer_email}</td>
                  <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-size-sm)',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--accent-primary)',
                      border: '1px solid var(--border-color)'
                    }}>
                      {ticket.status}
                    </span>
                  </td>
                  <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                    {new Date(ticket.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
