chrome.storage.local.get({
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
}, config => {
  initInspector(config);
});

let categorizedSellers = {
  total: [],
  unique: [],
  invalidDomain: [],
  invAds: [],
  invApp: [],
  totInv: [],
  totFnd: []
};

let originalNetworkData = {};
let currentModalJSON = "";
let currentModalCategory = "";

function initInspector(config) {
  const rawText = document.body.innerText;
  let jsonData;
  
  try { jsonData = JSON.parse(rawText); } 
  catch (e) { return; }

  originalNetworkData = { ...jsonData };
  delete originalNetworkData.sellers;

  document.documentElement.style.setProperty('--json-key', config.keyColor);
  document.documentElement.style.setProperty('--json-str', config.strColor);
  document.documentElement.style.setProperty('--json-num', config.numColor);
  document.documentElement.style.setProperty('--json-bool', config.boolColor);

  document.body.innerHTML = ''; 
  document.body.classList.add('sellers-inspector-active');

  const container = document.createElement('div');
  container.className = 'json-container';
  container.innerHTML = syntaxHighlight(jsonData);
  document.body.appendChild(container);

  if (config.showPanel) {
    buildOverviewPanel(jsonData, config);
    injectModalAndTooltip();
  }
}

function syntaxHighlight(json) {
  let str = JSON.stringify(json, undefined, 2);
  str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  str = str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) cls = 'json-key';
      else {
        cls = 'json-string';
        const rawStr = match.replace(/"/g, '');
        const isDomainOrUrl = rawStr.startsWith('http') || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(rawStr);
        if (isDomainOrUrl) {
          let url = rawStr.startsWith('http') ? rawStr : 'https://' + rawStr;
          return `<a href="${url}" target="_blank" style="color:#4fc3f7; text-decoration:none;">${match}</a>`;
        }
      }
    } else if (/true|false|null/.test(match)) {
      cls = 'json-boolean';
    }
    return `<span class="${cls}">${match}</span>`;
  });

  return str.replace(/(<span class="json-key">"seller_id":<\/span>\s*<span class="json-string">)"(.*?)"(<\/span>)/g, (fullMatch, p1, id, p2) => {
    return `${fullMatch} <span class="seller-badges" data-seller-id="${id}"></span>`;
  });
}

function buildOverviewPanel(data, config) {
  const panel = document.createElement('div');
  panel.id = 'sellers-overview-panel';

  let seenDomains = new Set();
  const sellersToAnalyze = [];

  if (data.sellers && Array.isArray(data.sellers)) {
    data.sellers.forEach(s => {
      categorizedSellers.total.push(s); 
      
      if (s.domain) {
        const rawDomain = s.domain.trim();
        if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(rawDomain)) {
          if (!seenDomains.has(rawDomain.toLowerCase())) {
            seenDomains.add(rawDomain.toLowerCase());
            categorizedSellers.unique.push(s); 
          }
          if (s.seller_id) sellersToAnalyze.push(s); 
        } else {
          categorizedSellers.invalidDomain.push(s); 
        }
      } else {
        categorizedSellers.invalidDomain.push(s); 
      }
    });
  }

  let html = `<div class="overview-title">Sellers.json Overview</div>`;
  
  if (config.showTotalSellers) html += createStatRow('total', 'Total Sellers:', categorizedSellers.total.length, 'Total number of seller records in the file.');
  if (config.showUniqueSellers) html += createStatRow('unique', 'Unique Sellers:', categorizedSellers.unique.length, 'First occurrence of each unique domain.');
  if (config.showInvalidDomains) html += createStatRow('invalidDomain', 'Invalid domain:', categorizedSellers.invalidDomain.length, 'Sellers with missing or incorrectly formatted domains.');
  
  html += `<button id="runAnalysisBtn" class="vbtn primary">Analyze ${sellersToAnalyze.length} Domains</button>
  
  <div id="verifyProgress">
    <div class="progress-track"><div id="verifyProgressBarInner"></div></div>
    <div class="progress-meta">
      <span id="progressText">Analyzing...</span>
      <span id="progressCount">0 / ${sellersToAnalyze.length}</span>
    </div>
  </div>
  <div id="analysis-stats-container" style="margin-top: 15px;">`;

  if (config.showInvalidAds) html += createStatRow('invAds', 'Invalid ads.txt line:', 0, 'Sellers whose ID was not found in their ads.txt file.', true);
  if (config.showInvalidAppAds) html += createStatRow('invApp', 'Invalid app-ads.txt line:', 0, 'Sellers whose ID was not found in their app-ads.txt file.', true);
  if (config.showTotalInvalid) html += createStatRow('totInv', 'Total invalid Sellers:', 0, 'Sellers whose ID was missing from BOTH ads.txt and app-ads.txt.', true);
  if (config.showTotalFound) html += createStatRow('totFnd', 'Total found Sellers:', 0, 'Sellers whose ID was successfully found in AT LEAST ONE of the files.', true);

  html += `</div>`;
  
  panel.innerHTML = html;
  document.body.appendChild(panel);

  document.getElementById('runAnalysisBtn').addEventListener('click', function() {
    this.disabled = true;
    this.innerText = 'Analysis in progress...';
    document.getElementById('verifyProgress').classList.add('visible');
    
    startAnalysisQueue(sellersToAnalyze, () => {
      this.innerText = 'Analysis Complete!';
      document.getElementById('progressText').innerText = 'Done!';
    });
  });
}

function createStatRow(id, label, val, tip, isHidden = false) {
  const display = isHidden ? 'display:none;' : '';
  return `
    <div class="overview-stat" id="row-${id}" style="${display}">
      <span class="stat-label" data-category="${id}" data-tip="${tip}">${label}</span>
      <span class="stat-val" id="val-${id}">${val}</span>
    </div>
  `;
}

function updateAnalysisStatsUI() {
  const updates = [
    { id: 'invAds', val: categorizedSellers.invAds.length },
    { id: 'invApp', val: categorizedSellers.invApp.length },
    { id: 'totInv', val: categorizedSellers.totInv.length },
    { id: 'totFnd', val: categorizedSellers.totFnd.length }
  ];

  updates.forEach(item => {
    const row = document.getElementById(`row-${item.id}`);
    const valSpan = document.getElementById(`val-${item.id}`);
    if (row && valSpan) {
      row.style.display = 'flex';
      valSpan.innerText = item.val;
    }
  });
}

async function startAnalysisQueue(sellersObjects, onComplete) {
  const CONCURRENCY_LIMIT = 10; 
  let currentIndex = 0;
  let completed = 0;
  let activeWorkers = 0;
  const total = sellersObjects.length;

  const progressBar = document.getElementById('verifyProgressBarInner');
  const progressCount = document.getElementById('progressCount');

  return new Promise(resolve => {
    function runNext() {
      if (completed >= total) {
        onComplete();
        resolve();
        return;
      }
      while (activeWorkers < CONCURRENCY_LIMIT && currentIndex < total) {
        const sellerObj = sellersObjects[currentIndex++];
        activeWorkers++;
        
        checkDomain(sellerObj).then(() => {
          completed++;
          activeWorkers--;
          progressBar.style.width = `${(completed / total) * 100}%`;
          progressCount.innerText = `${completed} / ${total}`;
          runNext();
        });
      }
    }
    runNext();
  });
}

async function checkDomain(sellerObj) {
  const safeId = CSS.escape(sellerObj.seller_id);
  const badgeContainer = document.querySelector(`.seller-badges[data-seller-id="${safeId}"]`);
  
  if (badgeContainer) badgeContainer.innerHTML = `<span class="badge badge-wait">Checking...</span>`;

  const [adsText, appAdsText] = await Promise.all([
    fetchFromBackground(`https://${sellerObj.domain}/ads.txt`),
    fetchFromBackground(`https://${sellerObj.domain}/app-ads.txt`)
  ]);

  const hasAds = adsText && adsText.includes(sellerObj.seller_id);
  const hasAppAds = appAdsText && appAdsText.includes(sellerObj.seller_id);

  if (!hasAds) categorizedSellers.invAds.push(sellerObj);
  if (!hasAppAds) categorizedSellers.invApp.push(sellerObj);
  if (!hasAds && !hasAppAds) categorizedSellers.totInv.push(sellerObj);
  if (hasAds || hasAppAds) categorizedSellers.totFnd.push(sellerObj);

  updateAnalysisStatsUI();

  if (badgeContainer) {
    let html = '';
    html += hasAds ? `<span class="badge badge-ok">Ads: OK</span>` : `<span class="badge badge-err">Ads: NO</span>`;
    html += hasAppAds ? `<span class="badge badge-ok">App: OK</span>` : `<span class="badge badge-err">App: NO</span>`;
    badgeContainer.innerHTML = html;
  }
}

function fetchFromBackground(url) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "fetchAds", url: url }, response => {
      resolve(response && response.success ? response.text : null);
    });
  });
}

function injectModalAndTooltip() {
  const tooltip = document.createElement('div');
  tooltip.id = 'sellers-tooltip';
  document.body.appendChild(tooltip);

  const modalHTML = `
    <div id="sellers-modal-overlay">
      <div id="sellers-modal">
        <div class="modal-header">
          <span class="modal-title" id="modal-title-text">Filtered Sellers</span>
          <span class="modal-close" id="modalCloseBtn">&times;</span>
        </div>
        <div class="modal-body">
          <pre id="modal-json-content"></pre>
        </div>
        <div class="modal-footer">
          <button class="modal-btn" id="modalCopyBtn">Copy to Clipboard</button>
          <button class="modal-btn primary" id="modalSaveBtn">Save .json</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.addEventListener('mousemove', e => {
    if (e.target.matches('.stat-label[data-tip]')) {
      tooltip.innerText = e.target.getAttribute('data-tip');
      tooltip.classList.add('visible');
      tooltip.style.left = (e.clientX - 260) + 'px'; 
      tooltip.style.top = (e.clientY - 10) + 'px';
    } else {
      tooltip.classList.remove('visible');
    }
  });

  document.addEventListener('click', e => {
    if (e.target.matches('.stat-label[data-category]')) {
      const category = e.target.getAttribute('data-category');
      const labelName = e.target.innerText.replace(':', '');
      openModal(category, labelName);
    }
  });

  document.getElementById('modalCloseBtn').addEventListener('click', () => {
    document.getElementById('sellers-modal-overlay').classList.remove('visible');
  });

  document.getElementById('sellers-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sellers-modal-overlay') {
      e.target.classList.remove('visible');
    }
  });

  document.getElementById('modalCopyBtn').addEventListener('click', function() {
    navigator.clipboard.writeText(currentModalJSON).then(() => {
      this.innerText = 'Copied!';
      setTimeout(() => this.innerText = 'Copy to Clipboard', 1500);
    });
  });

  document.getElementById('modalSaveBtn').addEventListener('click', () => {
    const blob = new Blob([currentModalJSON], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sellers_filtered_${currentModalCategory}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function openModal(category, labelName) {
  currentModalCategory = category;
  
  const exportData = {
    ...originalNetworkData,
    sellers: categorizedSellers[category] || []
  };

  currentModalJSON = JSON.stringify(exportData, null, 2);
  
  document.getElementById('modal-title-text').innerText = `${labelName} (${exportData.sellers.length} records)`;
  document.getElementById('modal-json-content').innerText = currentModalJSON;
  document.getElementById('sellers-modal-overlay').classList.add('visible');
}