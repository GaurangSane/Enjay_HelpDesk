import React from 'react';

/**
 * ConfidenceGate
 * A thin horizontal track with a circular marker positioned at `score` (0–100).
 * Marker color: --accent-cleared (green) if score >= 80, --accent-review (amber) otherwise.
 *
 * Props:
 *   score      {number}  0–100 confidence value (C_min threshold = 80 ≡ 8/10)
 *   showLabel  {boolean} whether to show the numeric value beside the track (default true)
 *   size       {'sm'|'md'} controls track width — 'sm' for table rows, 'md' for detail panels
 */
export default function ConfidenceGate({ score, showLabel = true, size = 'sm' }) {
  // Normalise: score may arrive as 0-10 (from LLM) or 0-100
  const normalised = score != null
    ? (score <= 10 ? score * 10 : Math.min(score, 100))
    : null;

  const isCleared  = normalised != null && normalised >= 80;
  const markerColor = isCleared ? 'var(--accent-cleared)' : 'var(--accent-review)';

  const trackWidth = size === 'md' ? 160 : 96;  // px
  const markerSize = size === 'md' ? 12 : 9;     // px

  const styles = {
    wrapper: {
      display:     'inline-flex',
      alignItems:  'center',
      gap:         '8px',
      userSelect:  'none',
    },
    trackOuter: {
      position:        'relative',
      width:           `${trackWidth}px`,
      height:          '4px',
      backgroundColor: 'var(--border)',
      borderRadius:    '9999px',
      flexShrink:      0,
    },
    trackFill: {
      position:        'absolute',
      left:            0,
      top:             0,
      height:          '100%',
      width:           normalised != null ? `${normalised}%` : '0%',
      backgroundColor: markerColor,
      borderRadius:    '9999px',
      opacity:         0.35,
      transition:      'width 150ms ease, background-color 150ms ease',
    },
    marker: {
      position:        'absolute',
      top:             '50%',
      left:            normalised != null ? `clamp(0%, ${normalised}%, calc(100% - ${markerSize}px))` : '0%',
      transform:       'translateY(-50%)',
      width:           `${markerSize}px`,
      height:          `${markerSize}px`,
      borderRadius:    '50%',
      backgroundColor: markerColor,
      boxShadow:       `0 0 0 2px var(--surface), 0 0 0 3px ${markerColor}55`,
      transition:      'left 150ms ease, background-color 150ms ease',
      flexShrink:      0,
    },
    label: {
      fontFamily:  'var(--font-mono)',
      fontSize:    size === 'md' ? '0.8125rem' : '0.6875rem',
      color:       markerColor,
      fontWeight:  500,
      minWidth:    '3ch',
      textAlign:   'right',
      transition:  'color 150ms ease',
    },
    unknown: {
      fontFamily: 'var(--font-mono)',
      fontSize:   '0.6875rem',
      color:      'var(--text-muted)',
    },
  };

  if (normalised == null) {
    return (
      <span style={styles.unknown} title="No confidence score available">
        — / 10
      </span>
    );
  }

  const displayScore = score != null && score <= 10
    ? `${score}/10`
    : `${Math.round(normalised)}%`;

  return (
    <span
      style={styles.wrapper}
      title={`AI confidence: ${displayScore}${isCleared ? ' — auto-resolve threshold met' : ' — routed for review'}`}
      role="meter"
      aria-valuenow={normalised}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Confidence ${displayScore}`}
    >
      <span style={styles.trackOuter} aria-hidden="true">
        <span style={styles.trackFill} />
        <span style={styles.marker} />
      </span>
      {showLabel && (
        <span style={styles.label}>{displayScore}</span>
      )}
    </span>
  );
}
