'use client';

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import styles from './logistic-spatial.module.css';

export function SpatialFullscreen({ as: Tag = 'div', active, label, controls, children, className, ...attributes }: {
  as?: 'div' | 'section';
  active: boolean;
  label?: string | undefined;
  controls?: ReactNode;
} & Pick<ComponentProps<'section'>, 'children' | 'className' | 'aria-labelledby'>) {
  const target = useRef<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const available = useRef(active);
  const pending = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    available.current = active;
    if (!active && target.current && document.fullscreenElement === target.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [active]);

  useEffect(() => {
    const element = target.current;
    if (!element || !label) return;
    let owned = false;
    const change = () => {
      const previous = owned;
      owned = document.fullscreenElement === element;
      setExpanded(owned);
      if ((owned || (previous && !element.contains(document.fullscreenElement))) && available.current) {
        button.current?.focus({ preventScroll: true });
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (document.fullscreenElement !== element) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void document.exitFullscreen().catch(() => setError('Impossible de quitter le plein écran.'));
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(element.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
      )).filter(item => item.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      const current = document.activeElement;
      if (first && last && (!element.contains(current) || current === (event.shiftKey ? first : last))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const failed = (event: Event) => {
      if (event.target === element) setError('Le plein écran est indisponible.');
    };
    document.addEventListener('fullscreenchange', change);
    document.addEventListener('fullscreenerror', failed);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      document.removeEventListener('fullscreenerror', failed);
      document.removeEventListener('keydown', keyboard);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, [label]);

  async function toggle() {
    const element = target.current;
    if (!element || !available.current || pending.current) return;
    pending.current = true;
    setError('');
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else {
        await element.requestFullscreen();
        if ((!element.isConnected || !available.current) && document.fullscreenElement === element) {
          await document.exitFullscreen();
        }
      }
    } catch {
      if (element.isConnected) setError('Le plein écran est indisponible.');
    } finally {
      pending.current = false;
    }
  }

  return <Tag ref={element => { target.current = element; }}
    className={label ? [className, styles.fullscreenTarget].filter(Boolean).join(' ') : className} {...attributes}>
    {label && <div className={styles.fullscreenToolbar}>
      <button type="button" ref={button} onClick={() => void toggle()} disabled={!active} aria-pressed={expanded}
        aria-label={expanded ? `Quitter le plein écran · ${label}` : `Plein écran · ${label}`}>
        {expanded ? <Minimize size={15} aria-hidden="true" /> : <Maximize size={15} aria-hidden="true" />}
        {expanded ? 'Quitter le plein écran' : 'Plein écran'}{!expanded && <span className="sr-only"> · {label}</span>}
      </button>
      {expanded && controls}
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {children}
  </Tag>;
}
