import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  
  // HITL state
  const [hitlAttempt, setHitlAttempt] = useState(null);
  const [loadingHitl, setLoadingHitl] = useState(false);

  const fetchHitlAttempt = async () => {
    setLoadingHitl(true);
    try {
      const response = await fetch(`http://localhost:8000/tickets/${id}/hitl-attempts`);
      if (response.ok) {
        const result = await response.json();
        setHitlAttempt(result.hitl_attempt);
      }
    } catch (err) {
      console.error("Failed to fetch HITL attempt:", err);
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
      
      // Sort messages chronologically (oldest first)
      if (data && data.ticket_messages) {
        const sorted = [...data.ticket_messages].sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        );
        setMessages(sorted);
      }

      // Fetch HITL attempt if status is hitl
      if (data && data.status === 'hitl') {
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

  useEffect(() => {
    fetchTicketDetails();
  }, [id]);

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;

    setSending(true);
    setSendError(null);

    try {
      const response = await fetch(`http://localhost:8000/tickets/${id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: replyText,
          sender: 'agent',
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to post reply.');
      }

      setReplyText('');
      await fetchTicketDetails();
    } catch (err) {
      setSendError(err.message || 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  const getReasonLabel = (reason) => {
    switch (reason) {
      case 'weak_retrieval': return 'Weak knowledge match';
      case 'low_confidence_or_no_citations': return 'Low confidence';
      case 'hallucinated_citation': return 'Unverified citation';
      case 'llm_call_failed': return 'AI unavailable';
      default: return reason || 'Needs Review';
    }
  };

  if (loading) {
    return <div style={{ padding: 'var(--space-xl)', color: 'var(--text-secondary)' }}>Loading ticket details...</div>;
  }

  if (error || !ticket) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <button 
          onClick={() => navigate('/')}
          style={{
            marginBottom: 'var(--space-md)',
            padding: 'var(--space-sm) var(--space-md)',
            cursor: 'pointer',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          &larr; Back to Tickets
        </button>
        <div style={{
          padding: 'var(--space-md)',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--accent-danger)',
          color: 'var(--accent-danger)',
          borderRadius: 'var(--radius-sm)'
        }}>
          {error || 'Ticket not found.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)', gap: 'var(--space-md)' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--space-md)' }}>
        <div>
          <button 
            onClick={() => navigate('/')}
            style={{
              marginBottom: 'var(--space-sm)',
              padding: 'var(--space-xs) var(--space-sm)',
              cursor: 'pointer',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            &larr; Back
          </button>
          <h2 style={{ color: 'var(--text-primary)' }}>{ticket.subject}</h2>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Customer: {ticket.customer_email}
          </p>
        </div>

        {/* Status Badge */}
        <span style={{
          padding: 'var(--space-xs) var(--space-sm)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'bold',
          border: '1px solid var(--border-color)',
          backgroundColor: 
            ticket.status === 'open' ? 'rgba(59, 130, 246, 0.2)' :
            ticket.status === 'pending' ? 'rgba(245, 158, 11, 0.2)' :
            ticket.status === 'hitl' ? 'rgba(239, 68, 68, 0.2)' :
            'rgba(16, 185, 129, 0.2)',
          color:
            ticket.status === 'open' ? 'var(--accent-primary)' :
            ticket.status === 'pending' ? 'var(--accent-warning)' :
            ticket.status === 'hitl' ? 'var(--accent-danger)' :
            'var(--accent-success)'
        }}>
          {ticket.status.toUpperCase()}
        </span>
      </div>

      {/* Chat Thread */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-md)',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)'
      }}>
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-xl)' }}>
            No messages in this ticket thread yet.
          </div>
        ) : (
          messages.map((msg) => {
            const isCustomer = msg.sender === 'customer';
            const isAi = msg.sender === 'ai';

            return (
              <div 
                key={msg.id} 
                style={{
                  alignSelf: isCustomer ? 'flex-start' : 'flex-end',
                  maxWidth: '70%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                {/* Message Bubble */}
                <div style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 
                    isCustomer ? 'var(--bg-tertiary)' : 
                    isAi ? 'rgba(139, 92, 246, 0.2)' : // Distinct purple theme for AI
                    'rgba(59, 130, 246, 0.2)', // Blue theme for Agent
                  border: `1px solid ${
                    isCustomer ? 'var(--border-color)' :
                    isAi ? 'var(--accent-secondary)' :
                    'var(--accent-primary)'
                  }`,
                  color: 'var(--text-primary)'
                }}>
                  {/* AI Draft Badge */}
                  {isAi && (
                    <div style={{
                      fontSize: '10px',
                      color: 'var(--accent-secondary)',
                      fontWeight: 'bold',
                      marginBottom: '4px',
                      textTransform: 'uppercase'
                    }}>
                      ✦ AI Draft
                    </div>
                  )}
                  <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>
                </div>
                
                {/* Meta details below bubble */}
                <span style={{ 
                  fontSize: '10px', 
                  color: 'var(--text-muted)', 
                  alignSelf: isCustomer ? 'flex-start' : 'flex-end' 
                }}>
                  {isCustomer ? 'Customer' : isAi ? 'AI Engine' : 'Agent'} &bull; {new Date(msg.created_at).toLocaleTimeString()}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* AI Draft (Needs Review) Panel */}
      {ticket.status === 'hitl' && (
        <div style={{
          padding: 'var(--space-md)',
          backgroundColor: 'rgba(139, 92, 246, 0.05)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ color: 'var(--accent-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', margin: 0 }}>
              ✦ AI Draft (Needs Review)
            </h4>
            {hitlAttempt && (
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'bold',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--accent-danger)',
                border: '1px solid var(--accent-danger)'
              }}>
                {getReasonLabel(hitlAttempt.reason)}
              </span>
            )}
          </div>

          {loadingHitl ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>Loading AI diagnostics...</div>
          ) : hitlAttempt ? (
            <>
              {/* Weak Retrieval Warning */}
              {hitlAttempt.reason === 'weak_retrieval' && (
                <div style={{
                  padding: 'var(--space-sm)',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid var(--accent-warning)',
                  color: 'var(--accent-warning)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--font-size-sm)'
                }}>
                  No relevant knowledge base match found — please answer manually
                </div>
              )}

              {/* Hallucinated Citation Warning */}
              {hitlAttempt.reason === 'hallucinated_citation' && (
                <div style={{
                  padding: 'var(--space-sm)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--accent-danger)',
                  color: 'var(--accent-danger)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'bold'
                }}>
                  ⚠ AI cited a source that does not exist in retrieval — treat this answer with extra caution
                </div>
              )}

              {/* Attempted Answer Box */}
              {hitlAttempt.attempted_answer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                  <div style={{
                    padding: 'var(--space-md)',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                    fontSize: 'var(--font-size-sm)',
                    lineHeight: '1.5'
                  }}>
                    {hitlAttempt.attempted_answer}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      This answer was NOT sent — AI confidence: {hitlAttempt.confidence_score}/10
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyText(hitlAttempt.attempted_answer)}
                      style={{
                        padding: 'var(--space-xs) var(--space-sm)',
                        backgroundColor: 'var(--accent-secondary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'bold'
                      }}
                    >
                      Use this draft
                    </button>
                  </div>
                </div>
              )}

              {/* Sources Section */}
              {hitlAttempt.retrieved_chunks && hitlAttempt.retrieved_chunks.length > 0 && (
                <div style={{ marginTop: 'var(--space-xs)' }}>
                  <details style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-tertiary)',
                    overflow: 'hidden'
                  }}>
                    <summary style={{
                      padding: 'var(--space-sm)',
                      cursor: 'pointer',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'bold',
                      color: 'var(--text-primary)',
                      userSelect: 'none',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)'
                    }}>
                      Sources AI considered ({hitlAttempt.retrieved_chunks.length})
                    </summary>
                    <div style={{
                      padding: 'var(--space-sm)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-sm)',
                      borderTop: '1px solid var(--border-color)',
                      maxHeight: '200px',
                      overflowY: 'auto'
                    }}>
                      {hitlAttempt.retrieved_chunks.map((chunk, idx) => (
                        <details 
                          key={idx}
                          style={{
                            padding: 'var(--space-xs)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--bg-secondary)'
                          }}
                        >
                          <summary style={{
                            cursor: 'pointer',
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            listStyle: 'none'
                          }}>
                            <span style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                              <strong>Source #{idx + 1}</strong>
                              <span style={{ color: 'var(--text-muted)' }}>
                                ({chunk.chunk_point_id?.substring(0, 8)}...)
                              </span>
                            </span>
                            <span style={{ 
                              color: chunk.score > 0.8 ? 'var(--accent-success)' : 'var(--text-muted)',
                              fontWeight: 'bold'
                            }}>
                              Score: {chunk.score?.toFixed(4)}
                            </span>
                          </summary>
                          <div style={{
                            marginTop: 'var(--space-xs)',
                            padding: 'var(--space-xs)',
                            fontSize: '12px',
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap',
                            borderTop: '1px dashed var(--border-color)',
                            backgroundColor: 'var(--bg-tertiary)'
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
            <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>No AI diagnostics found for this ticket.</div>
          )}
        </div>
      )}

      {/* Reply Area */}
      {sendError && (
        <div style={{
          padding: 'var(--space-sm)',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--accent-danger)',
          color: 'var(--accent-danger)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-sm)'
        }}>
          {sendError}
        </div>
      )}

      <form onSubmit={handleSendReply} style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <textarea
          rows="3"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Type your response to the customer..."
          style={{
            flex: 1,
            padding: 'var(--space-sm)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            outline: 'none',
            resize: 'none'
          }}
        />
        <button
          type="submit"
          disabled={sending || !replyText.trim()}
          style={{
            padding: '0 var(--space-lg)',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'var(--accent-primary)',
            color: '#ffffff',
            fontWeight: 'bold',
            cursor: replyText.trim() ? 'pointer' : 'not-allowed',
            opacity: replyText.trim() ? 1 : 0.6
          }}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
