document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    keyColor: document.getElementById("keyColor"),
    strColor: document.getElementById("strColor"),
    numColor: document.getElementById("numColor"),
    boolColor: document.getElementById("boolColor"),
    showPanel: document.getElementById("showPanel"),
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
    strColor: '#7bbf8e',
    numColor: '#F0FFF0',
    boolColor: '#F0FFF0',
    showPanel: true,
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