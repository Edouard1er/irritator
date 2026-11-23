'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize, Minimize, Pause, Play } from 'lucide-react';

type Props = {
  children: ReactNode;
  active: boolean;
  playing: boolean;
  canTogglePlayback: boolean;
  onTogglePlayback: () => void;
};

/** The native fullscreen element is the existing panel, including its live canvas. */
export function LakePanel({ children, active, playing, canTogglePlayback, onTogglePlayback }: Props) {
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const available = useRef(active); available.current = active;
  const wasFullscreen = useRef(false);
  const pending = useRef(false);
  const exitPending = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  const leave = useCallback(async (element: HTMLElement | null = panel.current) => {
    if (!element || document.fullscreenElement !== element || exitPending.current) return;
    exitPending.current = true;
    try { await document.exitFullscreen(); }
    catch { if (mounted.current) setError('Impossible de quitter le plein écran. Utilisez la touche Échap.'); }
    finally { exitPending.current = false; }
  }, []);

  useEffect(() => {
    const element = panel.current;
    mounted.current = true;
    const changed = () => {
      const ownFullscreen = document.fullscreenElement === element;
      const returned = wasFullscreen.current && !ownFullscreen;
      wasFullscreen.current = ownFullscreen;
      setFullscreen(ownFullscreen);
      if (ownFullscreen) setError('');
      if (returned && available.current) trigger.current?.focus({ preventScroll: true });
    };
    const failed = (event: Event) => {
      if (event.target === element || (pending.current && event.target === document)) {
        setError('Le plein écran du lac est indisponible. Réessayez avec le bouton Plein écran.');
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (document.fullscreenElement !== element) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void leave();
      } else if (event.key === 'Tab') {
        // Native fullscreen hides the dashboard visually, but leaves its tab order.
        const buttons = Array.from(element?.querySelectorAll<HTMLButtonElement>('.lake-fullscreen-controls button:not(:disabled)') ?? []);
        if (!buttons.length) return;
        const index = buttons.findIndex(button => button === document.activeElement);
        const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
        event.preventDefault();
        buttons[next]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('fullscreenerror', failed);
    document.addEventListener('keydown', keyboard);
    return () => {
      mounted.current = false;
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('fullscreenerror', failed);
      document.removeEventListener('keydown', keyboard);
      if (element && document.fullscreenElement === element) void leave(element);
    };
  }, [leave]);

  useEffect(() => { if (!active) void leave(); }, [active, leave]);
  useEffect(() => { if (fullscreen) exitButton.current?.focus({ preventScroll: true }); }, [fullscreen]);
  useEffect(() => {
    if (error && !fullscreen && !requesting && active) trigger.current?.focus({ preventScroll: true });
  }, [error, fullscreen, requesting, active]);

  const enter = async () => {
    const element = panel.current;
    if (!element || !available.current || pending.current) return;
    pending.current = true; setRequesting(true); setError('');
    try {
      if (!element.requestFullscreen) throw new Error('Fullscreen API unavailable');
      await element.requestFullscreen();
      // A hidden or removed workspace must not retain a late fullscreen request.
      if ((!mounted.current || !available.current) && document.fullscreenElement === element) {
        await leave(element);
      }
    } catch {
      if (mounted.current) {
        setError('Le plein écran du lac est indisponible. Réessayez avec le bouton Plein écran.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setRequesting(false);
    }
  };

  return <article ref={panel} className="workshop-card lake-card">
    <div className="lake-card-heading">
      <h2>Le lac</h2>
      <button ref={trigger} type="button" className="lake-fullscreen-trigger" disabled={!active || requesting} aria-pressed={fullscreen} onClick={() => void enter()}><Maximize size={14}/>Plein écran</button>
    </div>
    {children}
    {fullscreen && <div className="lake-fullscreen-controls" role="group" aria-label="Commandes du lac en plein écran">
      <button type="button" disabled={!canTogglePlayback} onClick={onTogglePlayback}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause' : 'Reprendre'}</button>
      <button ref={exitButton} type="button" onClick={() => void leave()}><Minimize size={15}/>Quitter le plein écran</button>
    </div>}
    {error && <p className="lake-fullscreen-error" role="alert">{error}</p>}
  </article>;
}
