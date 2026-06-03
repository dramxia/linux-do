// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const infoEl = document.getElementById('info');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.match(/linux\.do\//)) {
    infoEl.innerHTML = '⚠️ 请在 linux.do 的帖子页面使用此插件';
    document.querySelectorAll('.btn').forEach(b => b.disabled = true);
    return;
  }

  try {
    chrome.tabs.sendMessage(tab.id, { action: 'getInfo' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        infoEl.innerHTML = '⚠️ 页面未加载完成，请刷新后重试';
        return;
      }
      infoEl.innerHTML = `
        <div class="title">${res.title}</div>
        <div>共 ${res.postCount} 个楼层</div>
      `;
    });
  } catch {
    infoEl.innerHTML = '⚠️ 无法连接到页面';
  }

  document.getElementById('copyTopic').addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: 'copyTopic' }, () => window.close());
  });

  document.getElementById('downloadTopic').addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: 'downloadTopic' }, () => window.close());
  });
});
