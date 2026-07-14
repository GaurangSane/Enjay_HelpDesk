import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function KnowledgeBase() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Modal / Duplicate state
  const [showModal, setShowModal] = useState(false);
  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');

  const placeholderText = `Issue:
[Describe the customer issue, e.g., "User sees error SNG-4021 when importing leads"]

Root Cause:
[Explain the underlying technical reason, e.g., "The CSV header fields do not match the CRM API names"]

Resolution:
[Provide the step-by-step resolution, e.g., "1. Go to Customization Settings. 2. Verify all API field names match CSV columns."]`;

  const triggerToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const saveNewArticle = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:8000/kb-articles/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, content }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to save article.');
      }

      triggerToast('Knowledge base article created and queued for sync!');
      // Reset form
      setTitle('');
      setContent('');
      setShowModal(false);
    } catch (err) {
      setError(err.message || 'Failed to create article.');
    } finally {
      setSaving(false);
    }
  };

  const updateExistingArticle = async () => {
    if (!selectedMatchId) {
      setError('Please select an article to update.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`http://localhost:8000/kb-articles/${selectedMatchId}/update-version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, content }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to update article version.');
      }

      const resData = await response.json();
      triggerToast(`Existing article updated! New version created: ${resData.new_kb_article_id.substring(0, 8)}...`);
      
      // Reset form
      setTitle('');
      setContent('');
      setShowModal(false);
    } catch (err) {
      setError(err.message || 'Failed to update article.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;

    setChecking(true);
    setError(null);

    try {
      // 1. Preflight check for duplicates
      const preflightResponse = await fetch('http://localhost:8000/kb-articles/preflight-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!preflightResponse.ok) {
        const errData = await preflightResponse.json();
        throw new Error(errData.detail || 'Preflight check failed.');
      }

      const preflightResult = await preflightResponse.json();

      if (preflightResult.duplicate_found) {
        setMatches(preflightResult.matches);
        if (preflightResult.matches && preflightResult.matches.length > 0) {
          // Select first match by default
          setSelectedMatchId(preflightResult.matches[0].kb_article_id);
        }
        setShowModal(true);
      } else {
        // Safe to save immediately
        await saveNewArticle();
      }
    } catch (err) {
      setError(err.message || 'An error occurred during submission.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <h2 style={{ marginBottom: 'var(--space-md)' }}>Knowledge Base</h2>

      {/* Toast Alert */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 'var(--space-lg)',
          right: 'var(--space-lg)',
          padding: 'var(--space-md) var(--space-lg)',
          backgroundColor: toast.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)',
          color: '#ffffff',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          zIndex: 1100,
          fontWeight: 'bold',
          transition: 'all 0.3s ease'
        }}>
          {toast.message}
        </div>
      )}

      {/* Main Form container */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: 'var(--space-lg)',
        maxWidth: '800px'
      }}>
        <h3 style={{ marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>Add New Article</h3>

        {error && (
          <div style={{
            padding: 'var(--space-sm)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--accent-danger)',
            color: 'var(--accent-danger)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-md)',
            fontSize: 'var(--font-size-sm)'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <label htmlFor="article-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
              Article Title
            </label>
            <input
              id="article-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sangam CRM: Resolving SNG-4021 Import Failures"
              style={{
                padding: 'var(--space-sm)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <label htmlFor="article-content" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
              Troubleshooting Content
            </label>
            <textarea
              id="article-content"
              rows="12"
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={placeholderText}
              style={{
                padding: 'var(--space-sm)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                outline: 'none',
                lineHeight: '1.6',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={checking || saving || !content.trim()}
            style={{
              padding: 'var(--space-sm) var(--space-lg)',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'var(--accent-primary)',
              color: '#ffffff',
              fontWeight: 'bold',
              cursor: content.trim() ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-start',
              opacity: content.trim() ? 1 : 0.6
            }}
          >
            {checking ? 'Checking duplicates...' : saving ? 'Saving...' : 'Add to Knowledge Base'}
          </button>
        </form>
      </div>

      {/* Duplicate Verification Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 14, 23, 0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: 'var(--space-md)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: '650px',
            padding: 'var(--space-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-md)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div>
              <h3 style={{ color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', margin: 0 }}>
                ⚠ A similar solution already exists
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-xs)' }}>
                We found articles in the database that closely match your troubleshooting draft. Review the matches below to avoid redundancy.
              </p>
            </div>

            {/* List of matched items */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-sm)',
              maxHeight: '300px',
              overflowY: 'auto',
              paddingRight: 'var(--space-xs)'
            }}>
              {matches.map((match, idx) => (
                <div 
                  key={match.kb_article_id}
                  style={{
                    padding: 'var(--space-sm)',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${selectedMatchId === match.kb_article_id ? 'var(--accent-secondary)' : 'var(--border-color)'}`,
                    cursor: 'pointer'
                  }}
                  onClick={() => setSelectedMatchId(match.kb_article_id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
                    <span style={{ fontWeight: 'bold', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                      Match #{idx + 1}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: match.similarity_score > 0.95 ? 'var(--accent-danger)' : 'var(--accent-warning)'
                    }}>
                      Similarity: {(match.similarity_score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '75px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {match.content_preview}
                  </div>
                </div>
              ))}
            </div>

            {/* Dropdown to pick which one to update if multiple */}
            {matches.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                <label htmlFor="update-select" style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                  Select existing article to overwrite:
                </label>
                <select
                  id="update-select"
                  value={selectedMatchId}
                  onChange={(e) => setSelectedMatchId(e.target.value)}
                  style={{
                    padding: 'var(--space-sm)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                >
                  {matches.map((match, idx) => (
                    <option key={match.kb_article_id} value={match.kb_article_id}>
                      Match #{idx + 1} (Similarity: {(match.similarity_score * 100).toFixed(1)}%)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Cancel
              </button>

              <button
                onClick={saveNewArticle}
                disabled={saving}
                style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Create New Anyway
              </button>

              <button
                onClick={updateExistingArticle}
                disabled={saving || !selectedMatchId}
                style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: 'var(--accent-success)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Update Existing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
