import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/content/layout/split-pane-layout';
import { WRAPPER_CLASS } from '../src/content/layout/dom-queries';
import { bindResizeHandler, unbindResizeHandler } from '../src/content/layout/resize-handler';

function dispatchPageTransition(type: 'pagehide' | 'pageshow', persisted: boolean): void {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

describe('resize handler bfcache lifecycle', () => {
  beforeEach(() => {
    unbindResizeHandler();
    document.body.innerHTML = `<div class="${WRAPPER_CLASS}"></div>`;
    bindResizeHandler();
  });

  afterEach(() => {
    unbindResizeHandler();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('stays paused after pagehide and recalculates height on a persisted pageshow', () => {
    const wrapper = document.querySelector<HTMLElement>(`.${WRAPPER_CLASS}`);
    if (!wrapper) throw new Error('Missing split pane wrapper fixture');

    const rect = { top: 80 };
    vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(
      () => ({ top: rect.top, bottom: rect.top }) as DOMRect,
    );

    window.dispatchEvent(new Event('resize'));
    const initialHeight = wrapper.style.getPropertyValue('--ldtk-split-pane-height');
    expect(initialHeight).toBe(`${Math.max(320, window.innerHeight - 88)}px`);

    dispatchPageTransition('pagehide', true);
    rect.top = 180;
    window.dispatchEvent(new Event('resize'));
    expect(wrapper.style.getPropertyValue('--ldtk-split-pane-height')).toBe(initialHeight);

    dispatchPageTransition('pageshow', true);
    expect(wrapper.style.getPropertyValue('--ldtk-topic-top-offset')).toBe('180px');
    expect(wrapper.style.getPropertyValue('--ldtk-split-pane-height')).toBe(
      `${Math.max(320, window.innerHeight - 188)}px`,
    );
  });
});
