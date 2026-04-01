document.addEventListener("DOMContentLoaded", () => {
  const keyColorIn = document.getElementById("keyColor");
  const strColorIn = document.getElementById("strColor");
  const numColorIn = document.getElementById("numColor");
  const showPanelIn = document.getElementById("showPanel");
  const saveBtn = document.getElementById("saveBtn");

  // Загружаем текущие
  chrome.storage.local.get({
    keyColor: '#9cdcfe',
    strColor: '#ce9178',
    numColor: '#b5cea8',
    showPanel: true
  }, (cfg) => {
    keyColorIn.value = cfg.keyColor;
    strColorIn.value = cfg.strColor;
    numColorIn.value = cfg.numColor;
    showPanelIn.checked = cfg.showPanel;
  });

  saveBtn.addEventListener("click", () => {
    chrome.storage.local.set({
      keyColor: keyColorIn.value,
      strColor: strColorIn.value,
      numColor: numColorIn.value,
      showPanel: showPanelIn.checked
    }, () => {
      // Обновляем текущую вкладку
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.reload(tabs[0].id);
      });
    });
  });
});