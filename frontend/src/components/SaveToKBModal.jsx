import React, { useState } from 'react';
import { apiUrl } from '../api';

/**
 * SaveToKBModal
 * -------------
 * Self-contained KB article creation flow encapsulating:
 *   1. A title + content form
 *   2. POST /kb-articles/preflight-check on submit
 *   3. Dedup modal (shown only when duplicate_found=true) with
 *      "Create New Anyway" and "Update Existing" actions
 *   4. Success / error toast
 *
 * Props:
 *   initialTitle   {string}  - Pre-filled title (agent can edit before confirming)
 *   initialContent {string}  - Pre-filled content (agent can edit before confirming)
 *   onClose        {fn}      - Called when modal is dismissed without saving
 *   onSaved        {fn}      - Called after a successful save/update with a message string
 */
export default function SaveToKBModal({ initialTitle = '', initialContent = '', onClose, onSaved }) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Dedup sub-modal state
  const [showDedupModal, setShowDedupModal] = useState(false);
  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');

  const placeholderText = `Issue:\n[Describe the customer issue]\n\nRoot Cause:\n[Explain the underlying technical reason]\n\nResolution:\n[Step-by-step resolution]`;

  // ── Shared helpers ────────────────────────────────────────────────────────

  const saveNewArticle = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/kb-articles/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to save article.');
      }

      onSaved('Knowledge base article created and queued for sync!');
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
      const response = await fetch(
        apiUrl(`/kb-articles/${selectedMatchId}/update-version`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to update article version.');
      }

      const resData = await response.json();
      onSaved(
        `Existing article updated! New version: ${resData.new_kb_article_id?.substring(0, 8)}...`
      );
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
      const preflightResponse = await fetch(apiUrl('/kb-articles/preflight-check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!preflightResponse.ok) {
        const errData = await preflightResponse.json();
        throw new Error(errData.detail || 'Preflight check failed.');
      }

      const preflightResult = await preflightResponse.json();

      if (preflightResult.duplicate_found) {
        setMatches(preflightResult.matches);
        setSelectedMatchId(preflightResult.matches?.[0]?.kb_article_id || '');
        setShowDedupModal(true);
      } else {
        await saveNewArticle();
      }
    } catch (err) {
      setError(err.message || 'An error occurred during submission.');
    } finally {
      setChecking(false);
    }
  };

  // ── Outer modal wrapper ───────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(10, 14, 23, 0.85)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 900,
        padding: 'var(--space-md)',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          width: '100%',
          maxWidth: '680px',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          boxShadow: 'var(--shadow-raised)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>
            📚 Save to Knowledge Base
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '20px',
              lineHeight: 1,
              padding: '2px 6px',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          Review and edit the draft below before adding it to the knowledge base.
          The content will be checked against existing articles for duplicates.
        </p>

        {/* Error Banner */}
        {error && (
          <div
            style={{
              padding: 'var(--space-sm)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--accent-danger)',
              color: 'var(--accent-danger)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <label
              htmlFor="kb-modal-title"
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'bold', color: 'var(--text-secondary)' }}
            >
              Article Title
            </label>
            <input
              id="kb-modal-title"
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
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <label
              htmlFor="kb-modal-content"
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'bold', color: 'var(--text-secondary)' }}
            >
              Troubleshooting Content
            </label>
            <textarea
              id="kb-modal-content"
              rows={10}
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
                resize: 'vertical',
              }}
            />
          </div>

          <div className="modal-btn-row">
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: 'var(--space-sm) var(--space-md)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Cancel
            </button>
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
                opacity: content.trim() ? 1 : 0.6,
              }}
            >
              {checking ? 'Checking duplicates...' : saving ? 'Saving...' : 'Add to Knowledge Base'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Dedup sub-modal (rendered above the form modal) ─────────────────── */}
      {showDedupModal && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(10, 14, 23, 0.6)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: 'var(--space-md)',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              width: '100%',
              maxWidth: '650px',
              padding: 'var(--space-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-md)',
              boxShadow: 'var(--shadow-raised)',
            }}
          >
            <div>
              <h3 style={{ color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', margin: 0 }}>
                ⚠ A similar solution already exists
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-xs)' }}>
                We found articles that closely match your draft. Review them to avoid redundancy.
              </p>
            </div>

            {/* Match list */}
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
                maxHeight: '300px', overflowY: 'auto', paddingRight: 'var(--space-xs)',
              }}
            >
              {matches.map((match, idx) => (
                <div
                  key={match.kb_article_id}
                  style={{
                    padding: 'var(--space-sm)',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${selectedMatchId === match.kb_article_id ? 'var(--accent-secondary)' : 'var(--border-color)'}`,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedMatchId(match.kb_article_id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
                    <span style={{ fontWeight: 'bold', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                      Match #{idx + 1}
                    </span>
                    <span style={{
                      fontSize: '12px', fontWeight: 'bold',
                      color: match.similarity_score > 0.95 ? 'var(--accent-danger)' : 'var(--accent-warning)',
                    }}>
                      Similarity: {(match.similarity_score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{
                    fontSize: '12px', color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap', maxHeight: '75px', overflow: 'hidden',
                  }}>
                    {match.content_preview}
                  </div>
                </div>
              ))}
            </div>

            {/* Dropdown for multiple matches */}
            {matches.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                <label htmlFor="kb-modal-update-select" style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                  Select existing article to overwrite:
                </label>
                <select
                  id="kb-modal-update-select"
                  value={selectedMatchId}
                  onChange={(e) => setSelectedMatchId(e.target.value)}
                  style={{
                    padding: 'var(--space-sm)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
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

            {/* Dedup action buttons */}
            <div className="modal-btn-row" style={{ marginTop: 'var(--space-xs)' }}>
              <button
                onClick={() => setShowDedupModal(false)}
                style={{
                  padding: 'var(--space-sm) var(--space-md)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 'bold',
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
                  fontWeight: 'bold',
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
                  fontWeight: 'bold',
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
