import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LakePanel } from '@/components/simulation/lake-panel';

let fullscreenElement: Element | null;
const enter = vi.fn();
const exit = vi.fn();
function fullscreen(element: Element | null) {
  fullscreenElement = element;
  document.dispatchEvent(new Event('fullscreenchange'));
}
beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: enter });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  enter.mockReset().mockImplementation(async function (this: HTMLElement) { fullscreen(this); });
  exit.mockReset().mockImplementation(async () => { fullscreen(null); });
});
afterEach(() => {
  fullscreenElement = null;
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document, 'exitFullscreen');
  vi.restoreAllMocks();
});
function setup(patch: Partial<React.ComponentProps<typeof LakePanel>> = {}) {
  const props = { active: true, playing: false, canTogglePlayback: true, onTogglePlayback: vi.fn(), children: <input aria-label="État du lac" defaultValue="12,5"/>, ...patch };
  return { ...render(<LakePanel {...props}/>), props };
}
async function open() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Plein écran' })); });
}

describe('Lake fullscreen shares the existing panel and playback controls', () => {
  it('enters and leaves native fullscreen without remounting its child or invoking playback', async () => {
    const { container, props } = setup();
    const child = screen.getByLabelText('État du lac');
    fireEvent.change(child, { target: { value: '12,5 · poissons en place' } });
    const trigger = screen.getByRole('button', { name: 'Plein écran' });
    trigger.focus();
    await open();
    expect(enter).toHaveBeenCalledOnce();
    expect(fullscreenElement).toBe(container.querySelector('.lake-card'));
    expect(screen.getByLabelText('État du lac')).toBe(child);
    expect(child).toHaveValue('12,5 · poissons en place');
    expect(screen.getByRole('button', { name: 'Quitter le plein écran' })).toHaveFocus();
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Quitter le plein écran' })); });
    expect(exit).toHaveBeenCalledOnce();
    expect(fullscreenElement).toBeNull();
    expect(screen.queryByRole('group', { name: 'Commandes du lac en plein écran' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText('État du lac')).toBe(child);
  });

  it('uses the shared Pause/Reprendre callback, stays mounted, and disables resume when unavailable', async () => {
    const { props, rerender } = setup({ playing: true });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onTogglePlayback).toHaveBeenCalledOnce();
    rerender(<LakePanel {...props} playing={false}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    expect(props.onTogglePlayback).toHaveBeenCalledTimes(2);
    rerender(<LakePanel {...props} playing={false} canTogglePlayback={false}/>);
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeDisabled();
    expect(enter).toHaveBeenCalledOnce();
  });

  it('synchronizes browser exit and Escape, including repeated entries', async () => {
    const { props } = setup();
    await open();
    act(() => fullscreen(null));
    expect(screen.queryByRole('button', { name: 'Quitter le plein écran' })).not.toBeInTheDocument();
    await open();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(exit).toHaveBeenCalledOnce();
    await open();
    expect(enter).toHaveBeenCalledTimes(3);
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
  });

  it('reports an unavailable or rejected API and permits a retry without changing the lake', async () => {
    const { props } = setup();
    const child = screen.getByLabelText('État du lac');
    enter.mockRejectedValueOnce(new Error('Permission denied'));
    await open();
    expect(screen.getByRole('alert')).toHaveTextContent('Le plein écran du lac est indisponible');
    expect(screen.getByRole('button', { name: 'Plein écran' })).toHaveFocus();
    expect(screen.getByLabelText('État du lac')).toBe(child);
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
    await open();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitter le plein écran' })).toBeInTheDocument();
  });

  it('reports fullscreenerror scoped to this panel and ignores unrelated fullscreen events', async () => {
    const { container } = setup();
    act(() => { container.querySelector('.lake-card')!.dispatchEvent(new Event('fullscreenerror', { bubbles: true })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Le plein écran du lac est indisponible');
    await open();
    const other = document.createElement('div'); document.body.appendChild(other);
    act(() => { other.dispatchEvent(new Event('fullscreenerror', { bubbles: true })); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => fullscreen(other));
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(exit).not.toHaveBeenCalled();
    other.remove();
  });

  it('leaves its own fullscreen when hidden or unmounted without touching another fullscreen element', async () => {
    const view = setup();
    await open();
    await act(async () => { view.rerender(<LakePanel {...view.props} active={false}/>); });
    expect(exit).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Plein écran' })).toBeDisabled();
    view.rerender(<LakePanel {...view.props}/>);
    await open();
    await act(async () => { view.unmount(); });
    expect(exit).toHaveBeenCalledTimes(2);
    const other = document.createElement('div');
    fullscreenElement = other;
    const next = setup(); next.unmount();
    expect(exit).toHaveBeenCalledTimes(2);
  });

  it('exits a pending request if the workspace disappears before the browser grants it', async () => {
    const view = setup();
    let grant!: () => void;
    enter.mockImplementationOnce(function (this: HTMLElement) {
      const element = this;
      return new Promise<void>(resolve => { grant = () => { fullscreen(element); resolve(); }; });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plein écran' }));
    expect(screen.getByRole('button', { name: 'Plein écran' })).toBeDisabled();
    view.rerender(<LakePanel {...view.props} active={false}/>);
    await act(async () => { grant(); });
    expect(exit).toHaveBeenCalledOnce();
    expect(fullscreenElement).toBeNull();
  });

  it('keeps exit available after an exit failure', async () => {
    setup(); await open();
    exit.mockRejectedValueOnce(new Error('Failed to exit'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Quitter le plein écran' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Utilisez la touche Échap');
    expect(screen.getByRole('button', { name: 'Quitter le plein écran' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Quitter le plein écran' })); });
    expect(fullscreenElement).toBeNull();
  });

  it('coalesces repeated exit controls and Escape while a native exit is pending', async () => {
    const view = setup(); await open();
    const parent = document.createElement('section');
    let finish!: () => void;
    exit.mockImplementationOnce(() => new Promise<void>(resolve => {
      finish = () => { fullscreen(parent); resolve(); };
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitter le plein écran' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitter le plein écran' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { view.rerender(<LakePanel {...view.props} active={false}/>); });
    expect(exit).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(fullscreenElement).toBe(parent);
    expect(exit).toHaveBeenCalledOnce();
  });

  it('contains Tab and Shift+Tab in fullscreen controls and skips disabled playback', async () => {
    const view = setup(); await open();
    const resume = screen.getByRole('button', { name: 'Reprendre' });
    const quit = screen.getByRole('button', { name: 'Quitter le plein écran' });
    expect(quit).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' }); expect(resume).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' }); expect(quit).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(resume).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(quit).toHaveFocus();
    expect(view.props.onTogglePlayback).not.toHaveBeenCalled();
    view.rerender(<LakePanel {...view.props} canTogglePlayback={false}/>);
    fireEvent.keyDown(document, { key: 'Tab' }); expect(quit).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(quit).toHaveFocus();
    await act(async () => { fireEvent.click(quit); });
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
});
