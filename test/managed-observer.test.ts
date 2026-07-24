import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedObserver } from '../src/content/managed-observer';

function dispatchPageTransition(type: 'pagehide' | 'pageshow', persisted: boolean): void {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

describe('ManagedObserver bfcache lifecycle', () => {
  let managedObserver: ManagedObserver | null = null;

  afterEach(() => {
    managedObserver?.disconnect();
    managedObserver = null;
    document.body.replaceChildren();
  });

  it('pauses on pagehide and resumes observing after a persisted pageshow', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const callback = vi.fn<MutationCallback>();
    managedObserver = new ManagedObserver(target, { childList: true }, callback);
    managedObserver.start();

    target.appendChild(document.createElement('span'));
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    callback.mockClear();

    dispatchPageTransition('pagehide', true);
    expect(managedObserver.isConnected).toBe(false);

    target.appendChild(document.createElement('span'));
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();

    dispatchPageTransition('pageshow', true);
    expect(managedObserver.isConnected).toBe(true);

    target.appendChild(document.createElement('span'));
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  });
});
