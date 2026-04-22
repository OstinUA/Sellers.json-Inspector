document.addEventListener('DOMContentLoaded', () => {
  const defaults = window.SELLERS_INSPECTOR_DEFAULTS || {};
  const colorKeys = ['keyColor', 'strColor', 'numColor', 'boolColor'];

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

  const getThemeColorSet = (cfg, theme) => {
    const themeKey = theme === 'light' ? 'lightThemeColors' : 'darkThemeColors';
    const defaultSet = defaults[themeKey] || {};
    const storedSet = cfg[themeKey] || {};

    return colorKeys.reduce((acc, key) => {
      acc[key] = storedSet[key] || cfg[key] || defaultSet[key] || '';
      return acc;
    }, {});
  };

  const normalizeThemeColors = cfg => ({
    darkThemeColors: getThemeColorSet(cfg, 'dark'),
    lightThemeColors: getThemeColorSet(cfg, 'light')
  });

  let currentTheme = 'dark';
  let themeColors = {
    darkThemeColors: { ...(defaults.darkThemeColors || {}) },
    lightThemeColors: { ...(defaults.lightThemeColors || {}) }
  };

  const getCurrentThemeKey = () => (currentTheme === 'light' ? 'lightThemeColors' : 'darkThemeColors');

  const renderColorInputs = () => {
    const activeColors = themeColors[getCurrentThemeKey()] || {};
    for (const key of colorKeys) {
      if (elements[key]) elements[key].value = activeColors[key] || '';
    }
  };

  for (const key of colorKeys) {
    elements[key]?.addEventListener('input', event => {
      const activeKey = getCurrentThemeKey();
      themeColors[activeKey] = themeColors[activeKey] || {};
      themeColors[activeKey][key] = event.target.value;
    });
  }

  elements.themeToggle?.addEventListener('change', () => {
    currentTheme = elements.themeToggle.checked ? 'light' : 'dark';
    renderColorInputs();
  });

  chrome.storage.local.get(defaults, cfg => {
    themeColors = normalizeThemeColors(cfg);
    currentTheme = cfg.theme === 'light' ? 'light' : 'dark';

    for (const [key, element] of Object.entries(elements)) {
      if (!element) continue;
      if (key === 'themeToggle') {
        element.checked = currentTheme === 'light';
      } else if (!colorKeys.includes(key) && element.type === 'checkbox') {
        element.checked = Boolean(cfg[key]);
      }
    }

    renderColorInputs();
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
    const newConfig = {
      darkThemeColors: { ...(themeColors.darkThemeColors || {}) },
      lightThemeColors: { ...(themeColors.lightThemeColors || {}) }
    };

    for (const [key, element] of Object.entries(elements)) {
      if (!element || colorKeys.includes(key)) continue;
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
