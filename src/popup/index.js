/* Linux.do 工具箱 — Popup 入口 */
document.addEventListener('DOMContentLoaded', async () => {
  const settingsApi = globalThis.LinuxDoToolkit.settings;
  const infoEl = document.getElementById('info');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const settingInputs = {
    enablePostActions: document.getElementById('enablePostActions'),
    enableBase64Decode: document.getElementById('enableBase64Decode'),
    enableSplitLayout: document.getElementById('enableSplitLayout'),
    includeMetadata: document.getElementById('includeMetadata'),
    replaceUploadUrls: document.getElementById('replaceUploadUrls'),
  };

  async function loadSettings() {
    const settings = await settingsApi.getSettings();
    Object.entries(settingInputs).forEach(([key, input]) => {
      if (input) input.checked = Boolean(settings[key]);
    });
  }

  async function saveSetting(key, checked) {
    await settingsApi.saveSettings({ [key]: checked });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'refreshEnhancements' }, () => {});
    }
  }

  Object.entries(settingInputs).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('change', () => {
      saveSetting(key, input.checked).catch((err) => {
        infoEl.innerHTML = `⚠️ 设置保存失败：${err.message}`;
      });
    });
  });

  await loadSettings();

  if (!tab?.url?.match(/linux\.do\//)) {
    infoEl.innerHTML = '⚠️ 请在 linux.do 的帖子页面使用此插件';
    document.querySelectorAll('.btn').forEach((button) => { button.disabled = true; });
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'getInfo' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      infoEl.innerHTML = '⚠️ 页面未加载完成，请刷新后重试';
      return;
    }
    infoEl.innerHTML = `
      <div class="title">${res.title}</div>
      <div>当前已加载 ${res.postCount} 个楼层</div>
    `;
  });

  document.getElementById('copyTopic').addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: 'copyTopic' }, () => window.close());
  });

  document.getElementById('downloadTopic').addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: 'downloadTopic' }, () => window.close());
  });
});
