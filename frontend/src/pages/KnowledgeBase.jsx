import React, { useState } from 'react';
import SaveToKBModal from '../components/SaveToKBModal';

export default function KnowledgeBase() {
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState(null);

  const triggerToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSaved = (message) => {
    setShowModal(false);
    triggerToast(message);
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
          boxShadow: 'var(--shadow-raised)',
          zIndex: 1100,
          fontWeight: 'bold',
          transition: 'all 0.3s ease'
        }}>
          {toast.message}
        </div>
      )}

      {/* Trigger button */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: 'var(--space-lg)',
        maxWidth: '800px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)'
      }}>
        <div>
          <h3 style={{ marginBottom: 'var(--space-xs)', color: 'var(--text-primary)' }}>Add New Article</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
            Contribute a troubleshooting solution to the knowledge base. We'll check for duplicates automatically.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'var(--accent-primary)',
            color: '#ffffff',
            fontWeight: 'bold',
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          + Add Article
        </button>
      </div>

      {/* The shared modal — opened with blank state */}
      {showModal && (
        <SaveToKBModal
          initialTitle=""
          initialContent=""
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
