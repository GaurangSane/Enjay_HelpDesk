import React, { useRef, useEffect, useState } from 'react';

/**
 * ConfidenceGate
 * A thin horizontal track with a circular marker positioned at `score` (0–100).
 * Marker color: --accent-cleared (green) if score >= 80, --accent-review (amber) otherwise.
 *
 * Visual centerpiece — marker glows/pulses when score freshly updates.
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

  const isCleared   = normalised != null && normalised >= 80;
  const markerColor = isCleared ? 'var(--accent-cleared)' : 'var(--accent-review)';

  const trackWidth = size === 'md' ? 180 : 100;  // px — slightly wider
  const markerSize = size === 'md' ? 14 : 10;    // px — slightly larger

  // Pulse animation when score changes
  const markerRef        = useRef(null);
  const prevNormalised   = useRef(null);
  const [pulseKey, setPulseKey] = useState(0);   // bump to re-trigger animation

  useEffect(() => {
    if (normalised == null) return;
    if (prevNormalised.current !== null && prevNormalised.current !== normalised) {
      // Score changed — trigger pulse by bumping key (removes + re-adds class)
      setPulseKey(k => k + 1);
    }
    prevNormalised.current = normalised;
  }, [normalised]);

  // Apply + clean up CSS animation class
  useEffect(() => {
    if (!markerRef.current || pulseKey === 0) return;
    const cls = isCleared
      ? 'confidence-marker--pulse-green'
      : 'confidence-marker--pulse-amber';
    const el = markerRef.current;
    el.classList.remove('confidence-marker--pulse-green', 'confidence-marker--pulse-amber');
    // Force reflow so animation restarts
    void el.offsetWidth;
    el.classList.add(cls);

    // Remove after animation completes (1.6s × 3 iterations = 4.8s)
    const timer = setTimeout(() => el.classList.remove(cls), 4900);
    return () => clearTimeout(timer);
  }, [pulseKey, isCleared]);

  const styles = {
    wrapper: {
      display:    'inline-flex',
      alignItems: 'center',
      gap:        '10px',
      userSelect: 'none',
    },
    trackOuter: {
      position:        'relative',
      width:           `${trackWidth}px`,
      height:          size === 'md' ? '5px' : '4px',
      backgroundColor: 'var(--surface-raised)',
      borderRadius:    '9999px',
      flexShrink:      0,
      overflow:        'visible',  /* let marker overflow the track height */
      boxShadow:       'inset 0 1px 2px rgba(15,23,42,0.08)',
    },
    trackFill: {
      position:        'absolute',
      left:            0,
      top:             0,
      height:          '100%',
      width:           normalised != null ? `${normalised}%` : '0%',
      backgroundColor: markerColor,
      borderRadius:    '9999px',
      opacity:         0.45,
      transition:      'width 300ms cubic-bezier(0.4,0,0.2,1), background-color 200ms ease',
    },
    marker: {
      position:        'absolute',
      top:             '50%',
      left:            normalised != null
        ? `clamp(0%, ${normalised}%, calc(100% - ${markerSize}px))`
        : '0%',
      transform:       'translateY(-50%)',
      width:           `${markerSize}px`,
      height:          `${markerSize}px`,
      borderRadius:    '50%',
      backgroundColor: markerColor,
      /* Default ring — animation class overrides this */
      boxShadow:       `0 0 0 2px var(--surface), 0 0 0 3px ${markerColor}55`,
      transition:      'left 300ms cubic-bezier(0.4,0,0.2,1), background-color 200ms ease, box-shadow 200ms ease',
      flexShrink:      0,
    },
    label: {
      fontFamily:  'var(--font-mono)',
      fontSize:    size === 'md' ? '0.8125rem' : '0.6875rem',
      color:       markerColor,
      fontWeight:  600,
      minWidth:    '3ch',
      textAlign:   'right',
      transition:  'color 200ms ease',
      letterSpacing: '0.02em',
    },
    unknown: {
      fontFamily:    'var(--font-mono)',
      fontSize:      '0.6875rem',
      color:         'var(--text-muted)',
      letterSpacing: '0.02em',
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
        <span ref={markerRef} style={styles.marker} />
      </span>
      {showLabel && (
        <span style={styles.label}>{displayScore}</span>
      )}
    </span>
  );
}
