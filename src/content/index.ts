/* Linux.do 工具箱 — Content Script 入口 */
import { injectButtons } from './buttons';
import { injectBase64Button } from './base64';
import { registerMessageHandlers } from './messages';
import { getCachedSettings, onSettingsChanged } from '../common/settings';
import type { DiscourseSettings } from '../common/settings';
import { RefreshScheduler } from './refresh-state';
import { ManagedObserver } from './managed-observer';

interface Enhancement {
  refresh: (settings: DiscourseSettings) => void | Promise<void>;
  ownedSelectors: readonly string[];
}

const selectionToolsEnhancement: Enhancement = {
  refresh: injectBase64Button,
  ownedSelectors: ['.ldcopy-base64-btn', '.ldcopy-strip-chinese-btn'],
};

const enhancements: readonly Enhancement[] = [
  {
    refresh: injectButtons,
    ownedSelectors: ['.ldtk-shadow-host'],
  },
  selectionToolsEnhancement,
];

const toolkitSelector = [
  '#ldcopy-toast-host',
  ...enhancements.flatMap((enhancement) => enhancement.ownedSelectors),
].join(', ');

async function runEnhancements(items: readonly Enhancement[]): Promise<void> {
  const settings = await getCachedSettings();
  await Promise.allSettled(
    items.map(({ refresh }) => Promise.resolve().then(() => refresh(settings))),
  );
}

const enhancementScheduler = new RefreshScheduler(() => runEnhancements(enhancements), 150);
const selectionToolsScheduler = new RefreshScheduler(
  () => runEnhancements([selectionToolsEnhancement]),
  100,
);

function isToolkitMutation(mutation: MutationRecord): boolean {
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  if (changedNodes.length === 0) return false;

  return changedNodes.every((node) => {
    if (!(node instanceof Element)) return false;
    return node.matches(toolkitSelector) || Boolean(node.closest(toolkitSelector));
  });
}

function bindDynamicPageEvents(): void {
  document.addEventListener('selectionchange', () => {
    selectionToolsScheduler.schedule();
  });

  const target = document.body;
  const managedObserver = new ManagedObserver(
    target,
    {
      childList: true,
      subtree: true,
    },
    (mutations) => {
      if (!mutations.every(isToolkitMutation)) enhancementScheduler.schedule();
    },
  );
  managedObserver.start();

  const handleNavigation = (): void => {
    enhancementScheduler.schedule(0);
  };
  window.addEventListener('discourse-navigate-completed', handleNavigation);
  window.addEventListener('page:change', handleNavigation);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) handleNavigation();
  });
}

function init(): void {
  registerMessageHandlers();
  bindDynamicPageEvents();
  onSettingsChanged(() => {
    void enhancementScheduler.run();
  });
  void enhancementScheduler.run();
}

function waitForDomReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

async function bootstrap(): Promise<void> {
  await Promise.all([getCachedSettings(), waitForDomReady()]);
  init();
}

void bootstrap();
