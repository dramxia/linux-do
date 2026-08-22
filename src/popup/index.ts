/* Linux.do 工具箱 — Popup 入口 */
import { getSettings, saveSettings, SETTING_KEYS } from '../common/settings';
import type { SettingKey } from '../common/settings';
import type { ContentMessage, PageInfoResponse } from '../content/messages';
import { isSupportedPageUrl, renderPageInfo } from './security';

document.addEventListener('DOMContentLoaded', async () => {
  const infoEl = document.getElementById('info') as HTMLElement | null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  type BooleanSettingKey = Exclude<SettingKey, 'commentsPerPage'>;
  const booleanSettingKeys = SETTING_KEYS.filter(
    (key): key is BooleanSettingKey => key !== 'commentsPerPage',
  );
  const settingInputs = new Map<BooleanSettingKey, HTMLInputElement | null>(
    booleanSettingKeys.map((key) => [key, document.getElementById(key) as HTMLInputElement | null]),
  );
  const commentsPerPage = document.getElementById('commentsPerPage') as HTMLSelectElement | null;

  async function loadSettings(): Promise<void> {
    const settings = await getSettings();
    settingInputs.forEach((input, key) => {
      if (input) input.checked = settings[key];
    });
    if (commentsPerPage) commentsPerPage.value = String(settings.commentsPerPage);
  }

  settingInputs.forEach((input, key) => {
    if (!input) return;
    input.addEventListener('change', async () => {
      try {
        await saveSettings({ [key]: input.checked });
        if (key === 'enableSplitReading' && tabId !== undefined) {
          await chrome.tabs.reload(tabId);
          window.close();
        }
      } catch (err) {
        if (infoEl) infoEl.textContent = `⚠️ 设置保存失败：${(err as Error).message}`;
      }
    });
  });

  commentsPerPage?.addEventListener('change', () => {
    const value = commentsPerPage.value === '20' ? 20 : 10;
    saveSettings({ commentsPerPage: value }).catch((err: Error) => {
      if (infoEl) infoEl.textContent = `⚠️ 设置保存失败：${err.message}`;
    });
  });

  await loadSettings();

  if (!isSupportedPageUrl(tab?.url)) {
    if (infoEl) infoEl.textContent = '⚠️ 请在 linux.do 的帖子页面使用此插件';
    document.querySelectorAll<HTMLButtonElement>('.btn').forEach((button) => {
      button.disabled = true;
    });
    return;
  }

  if (tabId === undefined) {
    if (infoEl) infoEl.textContent = '⚠️ 页面未加载完成，请刷新后重试';
    return;
  }

  chrome.tabs.sendMessage(
    tabId,
    { action: 'getInfo' } satisfies ContentMessage,
    {},
    (res: PageInfoResponse | undefined) => {
      if (chrome.runtime.lastError || !res) {
        if (infoEl) infoEl.textContent = '⚠️ 页面未加载完成，请刷新后重试';
        return;
      }
      if (infoEl) {
        renderPageInfo(infoEl, res.title, res.postCount);
      }
    },
  );

  const topicActions = ['copyTopic', 'downloadTopic'] as const;
  topicActions.forEach((action) => {
    document.getElementById(action)?.addEventListener('click', () => {
      chrome.tabs.sendMessage(tabId, { action } satisfies ContentMessage, {}, () => window.close());
    });
  });
});
