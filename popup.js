document.addEventListener('DOMContentLoaded', () => {
  const defaults = window.SELLERS_INSPECTOR_DEFAULTS || {};

  const elements = {
    keyColor: document.getElementById('keyColor'),
    strColor: document.getElementById('strColor'),
    numColor: document.getElementById('numColor'),
    boolColor: document.getElementById('boolColor'),
    showPanel: document.getElementById('showPanel'),
    showDomainList: document.getElementById('showDomainList'),
    showNameList: document.getElementById('showNameList'),
    showTotalSellers: document.getElementById('showTotalSellers'),
    showUniqueSellers: document.getElementById('showUniqueSellers'),
    showInvalidDomains: document.getElementById('showInvalidDomains'),
    showInvalidAds: document.getElementById('showInvalidAds'),
    showInvalidAppAds: document.getElementById('showInvalidAppAds'),
    showTotalInvalid: document.getElementById('showTotalInvalid'),
    showTotalFound: document.getElementById('showTotalFound'),
    themeToggle: document.getElementById('themeToggle')
  };

  chrome.storage.local.get(defaults, cfg => {
    for (const [key, element] of Object.entries(elements)) {
      if (!element) continue;
      if (key === 'themeToggle') {
        element.checked = cfg.theme === 'light';
      } else if (element.type === 'checkbox') {
        element.checked = Boolean(cfg[key]);
      } else {
        element.value = cfg[key] || '';
      }
    }
  });

  const openFileOnCurrentOrigin = fileName => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const activeTab = tabs && tabs[0];
      if (!activeTab || !activeTab.url) return;

      try {
        const url = new URL(activeTab.url);
        chrome.tabs.create({ url: `${url.origin}/${fileName}` });
      } catch {
      }
    });
  };

  document.getElementById('openSellersBtn')?.addEventListener('click', () => openFileOnCurrentOrigin('sellers.json'));
  document.getElementById('openBuyersBtn')?.addEventListener('click', () => openFileOnCurrentOrigin('buyers.json'));

  document.getElementById('saveBtn')?.addEventListener('click', () => {
    const newConfig = {};

    for (const [key, element] of Object.entries(elements)) {
      if (!element) continue;
      if (key === 'themeToggle') {
        newConfig.theme = element.checked ? 'light' : 'dark';
      } else {
        newConfig[key] = element.type === 'checkbox' ? element.checked : element.value;
      }
    }

    chrome.storage.local.set(newConfig, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const activeTab = tabs && tabs[0];
        if (activeTab && activeTab.id) chrome.tabs.reload(activeTab.id);
      });
    });
  });
});
