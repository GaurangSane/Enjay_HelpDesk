import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import SaveToKBModal from '../components/SaveToKBModal';
import ConfidenceGate from '../components/ConfidenceGate';
import { apiUrl } from '../api';

/* ── Tiny shared helpers ───────────────────────────────────────────────── */

function StatusBadge({ status }) {
  const classMap = {
    open:        'badge-open',
    pending:     'badge-pending',
    hitl:        'badge-hitl',
    ai_resolved: 'badge-ai_resolved',
    resolved:    'badge-resolved',
  };
  return (
    <span className={`badge ${classMap[status] ?? 'badge-resolved'}`}>
      {status === 'ai_resolved' ? 'AI Resolved' : status.toUpperCase()}
    </span>
  );
}

function getReasonLabel(reason) {
  switch (reason) {
    case 'weak_retrieval':              return 'Weak knowledge match';
    case 'low_confidence_or_no_citations': return 'Low confidence';
    case 'hallucinated_citation':       return 'Unverified citation';
    case 'llm_call_failed':             return 'AI unavailable';
    default:                            return reason || 'Needs Review';
  }
}

/* ── Message bubble ──────────────────────────────────────────────────────── */

function MessageBubble({ msg, ticket, onSaveToKB }) {
  const isCustomer = msg.sender === 'customer';
  const isAi       = msg.sender === 'ai';

  const bubbleStyle = {
    padding:      '10px 14px',
    borderRadius: 'var(--radius-md)',
    border:       '1px solid',
    color:        'var(--text)',
    ...(isCustomer
      ? {
          backgroundColor: 'var(--surface-raised)',
          borderColor:     'var(--border)',
        }
      : isAi
      ? {
          backgroundColor: 'rgba(155,126,248,0.12)',
          borderColor:     'rgba(155,126,248,0.35)',
        }
      : {
          backgroundColor: 'rgba(91,156,246,0.12)',
          borderColor:     'rgba(91,156,246,0.35)',
        }),
  };

  return (
    <div
      className="message-bubble-wrap"
      style={{
        alignSelf:     isCustomer ? 'flex-start' : 'flex-end',
        display:       'flex',
        flexDirection: 'column',
        gap:           '4px',
      }}
    >
      {/* Bubble */}
      <div style={bubbleStyle}>
        {isAi && (
          <div style={{
            fontSize:      '10px',
            color:         'var(--accent-secondary)',
            fontWeight:    700,
            marginBottom:  '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            ✦ AI Draft
          </div>
        )}
        <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text)', lineHeight: 1.55 }}>
          {msg.content}
        </p>
      </div>

      {/* Meta row */}
      <div style={{
        display:   'flex',
        alignItems:'center',
        gap:       '8px',
        alignSelf: isCustomer ? 'flex-start' : 'flex-end',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
          {isCustomer ? 'Customer' : isAi ? 'AI Engine' : 'Agent'}
          {' · '}
          {new Date(msg.created_at).toLocaleTimeString(undefined, {
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
        {msg.sender === 'agent' && (
          <button
            type="button"
            onClick={() => onSaveToKB({ title: `Re: ${ticket.subject}`, content: msg.content })}
            title="Save this reply to the Knowledge Base"
            style={{
              padding:         '2px 8px',
              fontSize:        '10px',
              fontWeight:      600,
              border:          '1px solid var(--border)',
              borderRadius:    'var(--radius-sm)',
              backgroundColor: 'transparent',
              color:           'var(--text-muted)',
              cursor:          'pointer',
              whiteSpace:      'nowrap',
              transition:      'border-color 150ms ease, color 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-cleared)';
              e.currentTarget.style.color       = 'var(--accent-cleared)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color       = 'var(--text-muted)';
            }}
          >
            📚 Save to KB
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */

export default function TicketDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [ticket,      setTicket]      = useState(null);
  const [messages,    setMessages]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [replyText,   setReplyText]   = useState('');
  const [sending,     setSending]     = useState(false);
  const [sendError,   setSendError]   = useState(null);
  const [polishing,   setPolishing]   = useState(false);
  const [polishError, setPolishError] = useState(null);
  const [resolving,   setResolving]   = useState(false);
  const [resolveError,setResolveError]= useState(null);

  // Current user role (fetched once on mount)
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    async function fetchUserRole() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .single();
        if (data?.role) setUserRole(data.role);
      } catch (err) {
        console.error('Failed to fetch user role:', err);
      }
    }
    fetchUserRole();
  }, []);

  const [kbDraft, setKbDraft] = useState(null);
  const [kbToast, setKbToast] = useState(null);

  const triggerKbToast = (message, type = 'success') => {
    setKbToast({ message, type });
    setTimeout(() => setKbToast(null), 4000);
  };

  // HITL state
  const [hitlAttempt,  setHitlAttempt]  = useState(null);
  const [loadingHitl,  setLoadingHitl]  = useState(false);

  const fetchHitlAttempt = async () => {
    setLoadingHitl(true);
    try {
      const res = await fetch(apiUrl(`/tickets/${id}/hitl-attempts`));
      if (res.ok) {
        const result = await res.json();
        setHitlAttempt(result.hitl_attempt);
      }
    } catch (err) {
      console.error('Failed to fetch HITL attempt:', err);
    } finally {
      setLoadingHitl(false);
    }
  };

  const fetchTicketDetails = async () => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('tickets')
        .select('*, ticket_messages(*)')
        .eq('id', id)
        .single();
      if (supabaseError) throw supabaseError;

      setTicket(data);
      if (data?.ticket_messages) {
        setMessages(
          [...data.ticket_messages].sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
          )
        );
      }
      if (data?.status === 'hitl') {
        await fetchHitlAttempt();
      } else {
        setHitlAttempt(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch ticket details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTicketDetails(); }, [id]);

  /* ── Handlers ─────────────────────────────────────────────────────── */

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(apiUrl(`/tickets/${id}/reply`), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: replyText, sender: 'agent' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to post reply.');
      }
      setReplyText('');
      await fetchTicketDetails();
    } catch (err) {
      setSendError(err.message || 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  const handlePolishDraft = async () => {
    if (!replyText.trim()) return;
    setPolishing(true);
    setPolishError(null);
    try {
      const res = await fetch(apiUrl('/tickets/polish'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ draft_text: replyText }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to polish draft.');
      }
      const data = await res.json();
      setReplyText(data.polished_text);
    } catch (err) {
      setPolishError(err.message || 'Failed to polish draft.');
    } finally {
      setPolishing(false);
    }
  };

  const handleMarkResolved = async () => {
    setResolving(true);
    setResolveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(apiUrl(`/tickets/${id}/resolve`), {
        method:  'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to mark ticket as resolved.');
      }
      await fetchTicketDetails();
    } catch (err) {
      setResolveError(err.message || 'Failed to mark as resolved.');
    } finally {
      setResolving(false);
    }
  };

  /* ── Loading / error guards ───────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        Loading ticket…
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div style={{ padding: '24px' }}>
        <button
          onClick={() => navigate('/')}
          style={backBtnStyle}
          onMouseEnter={(e) => applyHover(e, true)}
          onMouseLeave={(e) => applyHover(e, false)}
        >
          ← Back to Tickets
        </button>
        <div className="alert alert-danger" style={{ marginTop: '16px' }} role="alert">
          {error || 'Ticket not found.'}
        </div>
      </div>
    );
  }

  /* ── Main render ──────────────────────────────────────────────────── */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)', gap: '16px' }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        display:       'flex',
        justifyContent:'space-between',
        alignItems:    'flex-start',
        borderBottom:  '1px solid var(--border)',
        paddingBottom: '16px',
        gap:           '16px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
          <button
            onClick={() => navigate('/')}
            style={backBtnStyle}
            onMouseEnter={(e) => applyHover(e, true)}
            onMouseLeave={(e) => applyHover(e, false)}
          >
            ← Back
          </button>

          {/* Ticket subject in Fraunces */}
          <h2 className="ticket-subject" style={{ fontSize: 'var(--font-size-xl)', margin: 0 }}>
            {ticket.subject}
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
              {ticket.customer_email}
            </span>
            <span
              className="font-mono"
              style={{ fontSize: '10px', color: 'var(--text-muted)' }}
              title="Ticket ID"
            >
              #{ticket.id?.substring(0, 8)}
            </span>
          </div>
        </div>

        {/* Status badge + Mark Resolved */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <StatusBadge status={ticket.status} />
          {(userRole === 'agent' || userRole === 'admin') && ticket.status !== 'resolved' && (
            <button
              id="mark-resolved-btn"
              type="button"
              onClick={handleMarkResolved}
              disabled={resolving}
              title="Mark this ticket as resolved"
              style={{
                padding:         '5px 14px',
                fontSize:        '12px',
                fontWeight:      600,
                border:          '1px solid var(--accent-cleared)',
                borderRadius:    'var(--radius-md)',
                backgroundColor: resolving ? 'rgba(52,211,153,0.1)' : 'rgba(52,211,153,0.12)',
                color:           'var(--accent-cleared)',
                cursor:          resolving ? 'not-allowed' : 'pointer',
                whiteSpace:      'nowrap',
                transition:      'background-color 150ms ease, border-color 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (!resolving) e.currentTarget.style.backgroundColor = 'rgba(52,211,153,0.22)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(52,211,153,0.12)';
              }}
            >
              {resolving ? 'Resolving…' : '✓ Mark Resolved'}
            </button>
          )}
        </div>
      </div>

      {/* ── Chat Thread ─────────────────────────────────────────────── */}
      <div style={{
        flex:            1,
        overflowY:       'auto',
        padding:         '16px',
        backgroundColor: 'var(--surface)',
        borderRadius:    'var(--radius-md)',
        border:          '1px solid var(--border)',
        boxShadow:       'var(--shadow-card)',
        display:         'flex',
        flexDirection:   'column',
        gap:             '16px',
      }}>
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px', fontSize: 'var(--font-size-sm)' }}>
            No messages in this ticket thread yet.
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              ticket={ticket}
              onSaveToKB={setKbDraft}
            />
          ))
        )}
      </div>

      {/* ── AI Draft (Needs Review) Panel ───────────────────────────── */}
      {ticket.status === 'hitl' && (
        <div style={{
          padding:         '16px',
          backgroundColor: 'rgba(155,126,248,0.05)',
          border:          '1px solid rgba(155,126,248,0.25)',
          borderRadius:    'var(--radius-md)',
          display:         'flex',
          flexDirection:   'column',
          gap:             '12px',
        }}>
          {/* Panel header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <h4 style={{ color: 'var(--accent-secondary)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
              ✦ AI Draft — Needs Review
            </h4>
            {hitlAttempt && (
              <span className="badge badge-hitl" style={{ fontFamily: 'var(--font-ui)' }}>
                {getReasonLabel(hitlAttempt.reason)}
              </span>
            )}
          </div>

          {loadingHitl ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              Loading AI diagnostics…
            </div>
          ) : hitlAttempt ? (
            <>
              {/* Weak retrieval warning */}
              {hitlAttempt.reason === 'weak_retrieval' && (
                <div className="alert alert-warning" role="alert">
                  No relevant knowledge base match found — please answer manually.
                </div>
              )}

              {/* Hallucinated citation warning */}
              {hitlAttempt.reason === 'hallucinated_citation' && (
                <div className="alert alert-danger" role="alert">
                  ⚠ AI cited a source that does not exist in retrieval — treat this answer with extra caution.
                </div>
              )}

              {/* Attempted answer */}
              {hitlAttempt.attempted_answer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{
                    padding:         '12px 16px',
                    backgroundColor: 'var(--surface-raised)',
                    border:          '1px solid var(--border)',
                    borderRadius:    'var(--radius-sm)',
                    color:           'var(--text)',
                    whiteSpace:      'pre-wrap',
                    fontSize:        'var(--font-size-sm)',
                    lineHeight:      1.6,
                  }}>
                    {hitlAttempt.attempted_answer}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    {/* Confidence score with ConfidenceGate */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        AI confidence:
                      </span>
                      <ConfidenceGate score={hitlAttempt.confidence_score} size="md" />
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '11px',
                          color:    hitlAttempt.confidence_score >= 8
                            ? 'var(--accent-cleared)'
                            : 'var(--accent-review)',
                        }}
                      >
                        {hitlAttempt.confidence_score}/10
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setReplyText(hitlAttempt.attempted_answer)}
                      style={{
                        padding:         '6px 14px',
                        backgroundColor: 'var(--accent-secondary)',
                        color:           '#ffffff',
                        border:          'none',
                        borderRadius:    'var(--radius-md)',
                        cursor:          'pointer',
                        fontSize:        'var(--font-size-sm)',
                        fontWeight:      600,
                        transition:      'filter 150ms ease',
                      }}
                    >
                      Use this draft ↓
                    </button>
                  </div>
                </div>
              )}

              {/* Sources */}
              {hitlAttempt.retrieved_chunks?.length > 0 && (
                <div>
                  <details style={{
                    border:          '1px solid var(--border)',
                    borderRadius:    'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    overflow:        'hidden',
                  }}>
                    <summary style={{
                      padding:         '8px 12px',
                      fontSize:        'var(--font-size-sm)',
                      fontWeight:      600,
                      color:           'var(--text)',
                      userSelect:      'none',
                    }}>
                      Sources AI considered ({hitlAttempt.retrieved_chunks.length})
                    </summary>
                    <div style={{
                      padding:       '8px',
                      display:       'flex',
                      flexDirection: 'column',
                      gap:           '8px',
                      borderTop:     '1px solid var(--border)',
                      maxHeight:     '200px',
                      overflowY:     'auto',
                    }}>
                      {hitlAttempt.retrieved_chunks.map((chunk, idx) => (
                        <details
                          key={idx}
                          style={{
                            padding:         '6px',
                            border:          '1px solid var(--border)',
                            borderRadius:    'var(--radius-sm)',
                            backgroundColor: 'var(--surface)',
                          }}
                        >
                          <summary style={{
                            fontSize:      '12px',
                            color:         'var(--text-muted)',
                            display:       'flex',
                            justifyContent:'space-between',
                            alignItems:    'center',
                            listStyle:     'none',
                          }}>
                            <span style={{ display: 'flex', gap: '6px' }}>
                              <strong style={{ color: 'var(--text)' }}>Source #{idx + 1}</strong>
                              <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                                ({chunk.chunk_point_id?.substring(0, 8)}…)
                              </span>
                            </span>
                            <span
                              className="font-mono"
                              style={{
                                color:      chunk.score > 0.8 ? 'var(--accent-cleared)' : 'var(--text-muted)',
                                fontWeight: 600,
                                fontSize:   '11px',
                              }}
                            >
                              {chunk.score?.toFixed(4)}
                            </span>
                          </summary>
                          <div style={{
                            marginTop:       '6px',
                            padding:         '6px',
                            fontSize:        '12px',
                            color:           'var(--text)',
                            whiteSpace:      'pre-wrap',
                            borderTop:       '1px dashed var(--border)',
                            backgroundColor: 'var(--surface-raised)',
                            borderRadius:    '0 0 var(--radius-sm) var(--radius-sm)',
                          }}>
                            {chunk.content}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              No AI diagnostics found for this ticket.
            </div>
          )}
        </div>
      )}

      {/* ── Error banners ────────────────────────────────────────────── */}
      {(sendError || polishError || resolveError) && (
        <div className="alert alert-danger" role="alert">
          {sendError || polishError || resolveError}
        </div>
      )}

      {/* ── Reply Area ───────────────────────────────────────────────── */}
      <form onSubmit={handleSendReply} className="reply-form">
        <textarea
          id="reply-textarea"
          rows={3}
          value={replyText}
          onChange={(e) => { setReplyText(e.target.value); setSendError(null); setPolishError(null); }}
          placeholder="Type your response to the customer…"
          aria-label="Reply message"
          style={{
            flex:            1,
            padding:         '10px 12px',
            borderRadius:    'var(--radius-md)',
            border:          '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            color:           'var(--text)',
            resize:          'none',
            fontSize:        'var(--font-size-sm)',
            lineHeight:      1.5,
            minHeight:       '80px',
          }}
        />
        <div className="reply-form__actions">
          <button
            id="polish-draft-btn"
            type="button"
            onClick={handlePolishDraft}
            disabled={polishing || !replyText.trim()}
            title="Polish grammar, tone, and formatting — no new facts added"
            className="reply-form__btn"
            style={{
              border:          '1px solid var(--accent-secondary)',
              backgroundColor: 'rgba(155,126,248,0.1)',
              color:           'var(--accent-secondary)',
            }}
          >
            {polishing ? '✨ Polishing…' : '✨ Polish Draft'}
          </button>
          <button
            id="send-reply-btn"
            type="submit"
            disabled={sending || !replyText.trim()}
            className="reply-form__btn"
            style={{
              border:          'none',
              backgroundColor: 'var(--accent-primary)',
              color:           '#ffffff',
            }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>

      {/* ── KB Toast ─────────────────────────────────────────────────── */}
      {kbToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position:        'fixed',
            bottom:          '24px',
            right:           '24px',
            padding:         '12px 20px',
            backgroundColor: kbToast.type === 'success' ? 'var(--accent-cleared)' : 'var(--accent-danger)',
            color:           '#fff',
            borderRadius:    'var(--radius-md)',
            boxShadow:       'var(--shadow-raised)',
            zIndex:          1100,
            fontWeight:      600,
            fontSize:        'var(--font-size-sm)',
          }}
        >
          {kbToast.message}
        </div>
      )}

      {/* ── Save-to-KB Modal ──────────────────────────────────────────── */}
      {kbDraft && (
        <SaveToKBModal
          initialTitle={kbDraft.title}
          initialContent={kbDraft.content}
          onClose={() => setKbDraft(null)}
          onSaved={(msg) => { setKbDraft(null); triggerKbToast(msg); }}
        />
      )}
    </div>
  );
}

/* ── Shared button style helpers ─────────────────────────────────────────── */
const backBtnStyle = {
  display:         'inline-flex',
  alignItems:      'center',
  gap:             '4px',
  padding:         '4px 10px',
  cursor:          'pointer',
  backgroundColor: 'transparent',
  color:           'var(--text-muted)',
  border:          '1px solid var(--border)',
  borderRadius:    'var(--radius-sm)',
  fontSize:        'var(--font-size-sm)',
  transition:      'border-color 150ms ease, color 150ms ease',
  width:           'fit-content',
};

function applyHover(e, enter) {
  e.currentTarget.style.borderColor = enter ? 'var(--accent-primary)' : 'var(--border)';
  e.currentTarget.style.color       = enter ? 'var(--text)'           : 'var(--text-muted)';
}
