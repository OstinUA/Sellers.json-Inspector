document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    keyColor: document.getElementById("keyColor"),
    strColor: document.getElementById("strColor"),
    numColor: document.getElementById("numColor"),
    boolColor: document.getElementById("boolColor"),
    showPanel: document.getElementById("showPanel"),
    showDomainList: document.getElementById("showDomainList"),
    showNameList: document.getElementById("showNameList"),
    showTotalSellers: document.getElementById("showTotalSellers"),
    showUniqueSellers: document.getElementById("showUniqueSellers"),
    showInvalidDomains: document.getElementById("showInvalidDomains"),
    showInvalidAds: document.getElementById("showInvalidAds"),
    showInvalidAppAds: document.getElementById("showInvalidAppAds"),
    showTotalInvalid: document.getElementById("showTotalInvalid"),
    showTotalFound: document.getElementById("showTotalFound")
  };

  const defaults = {
    keyColor: '#FF8C00',
    strColor: '#F0FFF0',
    numColor: '#77c78a',
    boolColor: '#7bbf8e',
    showPanel: true,
    showDomainList: true,
    showNameList: true,
    showTotalSellers: true,
    showUniqueSellers: true,
    showInvalidDomains: true,
    showInvalidAds: true,
    showInvalidAppAds: true,
    showTotalInvalid: true,
    showTotalFound: true
  };

  chrome.storage.local.get(defaults, (cfg) => {
    for (const key in elements) {
      if (elements[key].type === 'checkbox') {
        elements[key].checked = cfg[key];
      } else {
        elements[key].value = cfg[key];
      }
    }
  });

  document.getElementById("openSellersBtn").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      try {
        const url = new URL(tabs[0].url);
        const sellersUrl = url.origin + "/sellers.json";
        chrome.tabs.create({ url: sellersUrl });
      } catch (e) {
        // ignore invalid URLs (e.g. chrome:// pages)
      }
    });
  });

  document.getElementById("openBuyersBtn").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      try {
        const url = new URL(tabs[0].url);
        const buyersUrl = url.origin + "/buyers.json";
        chrome.tabs.create({ url: buyersUrl });
      } catch (e) {
        // ignore invalid URLs (e.g. chrome:// pages)
      }
    });
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    const newConfig = {};
    for (const key in elements) {
      newConfig[key] = elements[key].type === 'checkbox' ? elements[key].checked : elements[key].value;
    }
    
    chrome.storage.local.set(newConfig, () => {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.reload(tabs[0].id);
      });
    });
  });
});