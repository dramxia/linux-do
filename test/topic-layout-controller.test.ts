import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DiscourseSettings } from '../src/common/settings';
import { TopicLayoutController } from '../src/content/topic-layout-controller';
import type { TopicLayoutRuntimeState } from '../src/content/topic-layout';
import type { TopicPost, TopicResponse } from '../src/content/topic-api';
import { TOPIC_EVENT_NAME } from '../src/content/topic-events';

const enabledSettings: DiscourseSettings = {
  ...DEFAULT_SETTINGS,
  enableSplitReading: true,
};

class RuntimeDriver {
  state: TopicLayoutRuntimeState = 'disabled';
  activate = vi.fn(async () => {
    this.state = 'active';
  });
  disable = vi.fn(() => {
    this.state = 'disabled';
  });
  invalidate = vi.fn();
  updateGeometry = vi.fn();
  getState = vi.fn(() => this.state);
}

function dispatchPageTransition(type: 'pageshow', persisted: boolean): void {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

function post(id: number, postNumber: number): TopicPost {
  return {
    id,
    topic_id: 123,
    post_number: postNumber,
    username: `user-${postNumber}`,
    created_at: '2026-08-22T00:00:00.000Z',
    cooked: `<p>content-${postNumber}</p>`,
  };
}

function topic(): TopicResponse {
  return {
    id: 123,
    title: 'Test topic',
    posts_count: 3,
    post_stream: {
      posts: [post(1, 1), post(2, 2), post(3, 3)],
      stream: [1, 2, 3],
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TopicLayoutController', () => {
  let driver: RuntimeDriver;
  let controller: TopicLayoutController;

  beforeEach(() => {
    document.body.innerHTML = '<main id="main-outlet"></main>';
    window.history.replaceState({}, '', '/t/topic/123');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    driver = new RuntimeDriver();
    controller = new TopicLayoutController(driver);
  });

  afterEach(() => {
    controller.stop();
    vi.restoreAllMocks();
  });

  it('starts the runtime once and ignores ordinary DOM mutations', async () => {
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(1));

    document.getElementById('main-outlet')?.appendChild(document.createElement('article'));
    await Promise.resolve();

    expect(driver.activate).toHaveBeenCalledTimes(1);
    expect(driver.invalidate).not.toHaveBeenCalled();
  });

  it('deduplicates repeated route events for the same page context', async () => {
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('page:change'));
    window.dispatchEvent(new Event('discourse-navigate-completed'));
    dispatchPageTransition('pageshow', true);

    expect(driver.activate).toHaveBeenCalledTimes(1);
    expect(driver.invalidate).not.toHaveBeenCalled();
    expect(driver.updateGeometry).toHaveBeenCalledTimes(3);
  });

  it('invalidates data and activates once when the topic context changes', async () => {
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(1));

    window.history.replaceState({}, '', '/t/another-topic/456');
    window.dispatchEvent(new Event('page:change'));
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(2));

    expect(driver.invalidate).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed state stable until a new layout intent arrives', async () => {
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(1));
    driver.state = 'failed';

    window.dispatchEvent(new Event('page:change'));
    controller.updateSettings({ ...enabledSettings, enableBase64Decode: false });
    expect(driver.activate).toHaveBeenCalledTimes(1);

    controller.updateSettings({ ...enabledSettings, enableSplitReading: false });
    controller.updateSettings(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(2));
  });

  it('handles repeated spaced toggles without accumulating lifecycle work', async () => {
    controller.start({ ...enabledSettings, enableSplitReading: false });
    await Promise.resolve();

    for (let cycle = 0; cycle < 6; cycle += 1) {
      controller.updateSettings(enabledSettings);
      await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(cycle + 1));
      controller.updateSettings({ ...enabledSettings, enableSplitReading: false });
      expect(driver.disable).toHaveBeenCalledTimes(cycle + 2);
    }

    expect(driver.invalidate).not.toHaveBeenCalled();
  });

  it('invalidates cached data for topic events without starting a load', async () => {
    controller.start({ ...enabledSettings, enableSplitReading: false });
    await Promise.resolve();
    driver.invalidate.mockClear();
    driver.activate.mockClear();

    document.dispatchEvent(
      new CustomEvent(TOPIC_EVENT_NAME, {
        detail: { topicId: 123, type: 'created', postId: 4 },
      }),
    );

    expect(driver.invalidate).toHaveBeenCalledTimes(1);
    expect(driver.activate).not.toHaveBeenCalled();
  });

  it('restarts an in-flight load when a topic event would make its snapshot stale', async () => {
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(1));
    driver.state = 'loading';

    document.dispatchEvent(
      new CustomEvent(TOPIC_EVENT_NAME, {
        detail: { topicId: 123, type: 'created', postId: 4 },
      }),
    );
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(2));

    expect(driver.invalidate).toHaveBeenCalledTimes(1);
  });

  it('only reapplies layout when resize crosses the desktop breakpoint', async () => {
    let runFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      runFrame = callback;
      return 1;
    });
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('resize'));
    runFrame?.(0);
    expect(driver.activate).toHaveBeenCalledTimes(1);
    expect(driver.updateGeometry).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    window.dispatchEvent(new Event('resize'));
    runFrame?.(0);
    await vi.waitFor(() => expect(driver.activate).toHaveBeenCalledTimes(2));
  });
});

describe('TopicLayoutController integration', () => {
  let controller: TopicLayoutController;

  beforeEach(() => {
    document.documentElement.innerHTML =
      '<head></head><body><div class="d-header-wrap"><header class="d-header"></header></div><main id="main-outlet"><article class="topic-post" data-post-number="1"></article></main></body>';
    window.history.replaceState({}, '', '/t/topic/123');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    sessionStorage.clear();
    controller = new TopicLayoutController();
  });

  afterEach(() => {
    controller.stop();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps one data source across repeated spaced toggles and unrelated DOM changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(topic()));
    vi.stubGlobal('fetch', fetchMock);
    controller.start(enabledSettings);
    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    });

    for (let cycle = 0; cycle < 6; cycle += 1) {
      controller.updateSettings({ ...enabledSettings, enableSplitReading: false });
      expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
      await new Promise((resolve) => window.setTimeout(resolve, 5));

      document.getElementById('main-outlet')?.appendChild(document.createElement('article'));
      controller.updateSettings(enabledSettings);
      await vi.waitFor(() => {
        expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.ldtk-topic-reading-root')).toHaveLength(1);
  });

  it('does not retry a failed load until the user creates a new enable intent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'failed' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    controller.start(enabledSettings);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    document.getElementById('main-outlet')?.appendChild(document.createElement('article'));
    window.dispatchEvent(new Event('page:change'));
    window.dispatchEvent(new Event('discourse-navigate-completed'));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(topic()));
    controller.updateSettings({ ...enabledSettings, enableSplitReading: false });
    controller.updateSettings(enabledSettings);
    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cleans up after an early navigation event once the home URL settles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(topic())));
    controller.start(enabledSettings);
    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-topic-reading-root')).not.toBeNull();
    });

    window.dispatchEvent(new Event('page:change'));
    window.history.replaceState({}, '', '/latest');

    await vi.waitFor(() => {
      expect(document.querySelector('.ldtk-topic-reading-root')).toBeNull();
    });
    expect(document.documentElement.classList.contains('ldtk-split-reading-active')).toBe(false);
  });
});
