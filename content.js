class SellersInspector {
  static CONCURRENCY_LIMIT = 10;

  constructor(config) {
    this.config = config;
    this.fileType = this.detectFileType();
    this.isBuyers = this.fileType === 'buyers';
    this.entityName = this.isBuyers ? 'Buyers' : 'Sellers';
    this.entityKey = this.isBuyers ? 'buyers' : 'sellers';

    this.categorized = this.buildCategories();
    this.originalNetworkData = {};
    this.domainCache = new Map();

    this.currentModalJSON = '';
    this.currentModalCategory = '';
    this.currentModalArray = [];
    this.currentListType = '';

    this.virtual = {
      allLines: [],
      highlightedLines: [],
      filteredIndexes: [],
      content: null
    };

    this.init();
  }

  buildCategories() {
    const base = { total: [], unique: [] };
    if (this.isBuyers) {
      return {
        ...base,
        invSellersJson: [],
        invBuyersJson: [],
        validSellersJson: [],
        validBuyersJson: []
      };
    }

    return {
      ...base,
      invalidDomain: [],
      invAds: [],
      invApp: [],
      totInv: [],
      totFnd: [],
      typePublisher: [],
      typeIntermediary: [],
      typeBoth: [],
      confidential: []
    };
  }

  detectFileType() {
    return window.location.href.toLowerCase().includes('buyers.json') ? 'buyers' : 'sellers';
  }

  getSwitchUrl() {
    const source = window.location.href;
    return this.fileType === 'sellers'
      ? source.replace(/sellers\.json/i, 'buyers.json')
      : source.replace(/buyers\.json/i, 'sellers.json');
  }

  applyColors() {
    const root = document.documentElement.style;
    const dark = this.config.darkThemeColors || {};
    const light = this.config.lightThemeColors || {};

    if (dark.keyColor) root.setProperty('--dark-key', dark.keyColor);
    if (dark.strColor) root.setProperty('--dark-str', dark.strColor);
    if (dark.numColor) root.setProperty('--dark-num', dark.numColor);
    if (dark.boolColor) root.setProperty('--dark-bool', dark.boolColor);

    if (light.keyColor) root.setProperty('--light-key', light.keyColor);
    if (light.strColor) root.setProperty('--light-str', light.strColor);
    if (light.numColor) root.setProperty('--light-num', light.numColor);
    if (light.boolColor) root.setProperty('--light-bool', light.boolColor);
  }

  async init() {
    let payload;
    try {
      payload = JSON.parse(document.body.innerText || '');
    } catch {
      return;
    }

    this.originalNetworkData = { ...payload };
    delete this.originalNetworkData[this.entityKey];

    this.applyColors();
    document.body.innerHTML = '';
    document.body.classList.add('sellers-inspector-active');

    this.prepareStaticStats(payload);
    await this.renderJson(payload);

    if (this.config.showPanel) {
      this.buildOverviewPanel(payload);
      this.injectModalAndTooltip();
    }
  }

  prepareStaticStats(data) {
    if (this.isBuyers || !Array.isArray(data.sellers)) return;

    for (const seller of data.sellers) {
      const sellerType = String(seller.seller_type || '').toUpperCase();
      if (sellerType === 'PUBLISHER') this.categorized.typePublisher.push(seller);
      if (sellerType === 'INTERMEDIARY') this.categorized.typeIntermediary.push(seller);
      if (sellerType === 'BOTH') this.categorized.typeBoth.push(seller);
      if (Number(seller.is_confidential) === 1) this.categorized.confidential.push(seller);
    }
  }

  async renderJson(jsonData) {
    const container = document.createElement('div');
    container.className = 'json-container';
    container.innerHTML = `<div id="json-viewport" class="json-virtual-viewport"><div id="jsonVirtualContent"></div></div>`;
    document.body.appendChild(container);

    this.virtual.content = container.querySelector('#jsonVirtualContent');

    const highlighted = await this.highlightInWorker({
      json: jsonData,
      isBuyers: this.isBuyers,
      confidentialSellerIds: (this.categorized.confidential || []).map(seller => String(seller.seller_id || ''))
    });

    this.virtual.allLines = JSON.stringify(jsonData, null, 2).split('\n');
    this.virtual.highlightedLines = highlighted.split('\n');
    this.virtual.filteredIndexes = this.virtual.highlightedLines.map((_, index) => index);

    this.renderFilteredLines();
  }

  highlightInWorker(payload) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'highlight', payload }, response => {
        if (chrome.runtime.lastError || !response || response.error) {
          resolve(this.escapeHtml(JSON.stringify(payload.json, null, 2)));
        } else {
          resolve(response.html || '');
        }
      });
    });
  }

  renderFilteredLines() {
    if (!this.virtual.content) return;

    let html = '';
    for (const i of this.virtual.filteredIndexes) {
      html += `<div class="json-line" data-line="${i}">${this.virtual.highlightedLines[i] || ''}</div>`;
    }

    this.virtual.content.innerHTML = html;
  }

  applyLocalFilter(query) {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) {
      this.virtual.filteredIndexes = this.virtual.highlightedLines.map((_, index) => index);
      this.renderFilteredLines();
      return;
    }

    const matchedIndexes = [];
    for (let index = 0; index < this.virtual.allLines.length; index += 1) {
      const line = this.virtual.allLines[index].toLowerCase();
      if (!line.includes(normalized)) continue;
      if (line.includes('"seller_id"') || line.includes('"domain"') || line.includes('"name"')) {
        matchedIndexes.push(index - 1, index, index + 1);
      }
    }

    const deduplicated = [...new Set(matchedIndexes.filter(index => index >= 0 && index < this.virtual.highlightedLines.length))];
    this.virtual.filteredIndexes = deduplicated.sort((a, b) => a - b);
    this.renderFilteredLines();
  }

  buildOverviewPanel(data) {
    const panel = document.createElement('div');
    panel.id = 'sellers-overview-panel';

    const entities = Array.isArray(data[this.entityKey]) ? data[this.entityKey] : [];
    const uniqueDomains = new Set();
    const entitiesToAnalyze = [];

    for (const entity of entities) {
      this.categorized.total.push(entity);
      const normalizedDomain = SellersInspector.validateDomain(entity.domain);
      if (normalizedDomain) {
        if (!uniqueDomains.has(normalizedDomain)) {
          uniqueDomains.add(normalizedDomain);
          this.categorized.unique.push(entity);
        }
        entitiesToAnalyze.push({ ...entity, _normalizedDomain: normalizedDomain });
      } else if (!this.isBuyers) {
        this.categorized.invalidDomain.push(entity);
      }
    }

    panel.innerHTML = this.renderPanelHtml(uniqueDomains.size);
    document.body.appendChild(panel);

    this.bindPanelEvents(uniqueDomains, entitiesToAnalyze);
  }

  renderPanelHtml(domainCount) {
    const switchLabel = this.fileType === 'sellers' ? 'Buyers.json' : 'Sellers.json';
    const switchUrl = this.escapeHtml(this.getSwitchUrl());

    let html = `
      <button class="switch-file-btn" id="switchFileBtn" data-url="${switchUrl}" title="Navigate to ${switchLabel}">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5zm14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5z"/></svg>
        Switch to ${switchLabel}
      </button>
      <div class="overview-title">${this.entityName}.json Overview</div>
      <input id="overviewSearchInput" class="overview-search" placeholder="Filter seller_id, domain, name" />`;

    if (this.config.showDomainList || this.config.showNameList) {
      html += '<div class="overview-stat" style="justify-content:flex-start;gap:10px;margin-bottom:12px;">';
      if (this.config.showDomainList) html += '<span class="stat-label" data-category="domainList" data-tip="List of all unique domains">Domain</span>';
      if (this.config.showDomainList && this.config.showNameList) html += '<span style="color:var(--muted);font-weight:700;font-size:11px;">|</span>';
      if (this.config.showNameList) html += '<span class="stat-label" data-category="nameList" data-tip="List of all unique names">Name</span>';
      html += '</div>';
    }

    if (this.config.showTotalSellers) html += this.statRow('total', `Total ${this.entityName}:`, this.categorized.total.length, `Total number of ${this.entityName.toLowerCase()} records.`);
    if (this.config.showUniqueSellers) html += this.statRow('unique', `Unique ${this.entityName}:`, this.categorized.unique.length, 'First occurrence of each unique domain.');

    if (!this.isBuyers) {
      if (this.config.showInvalidDomains) html += this.statRow('invalidDomain', 'Invalid domain:', this.categorized.invalidDomain.length, 'Invalid domain formatting.');
      html += this.statRow('typePublisher', 'Seller type PUBLISHER:', this.categorized.typePublisher.length, 'Records with seller_type PUBLISHER.');
      html += this.statRow('typeIntermediary', 'Seller type INTERMEDIARY:', this.categorized.typeIntermediary.length, 'Records with seller_type INTERMEDIARY.');
      html += this.statRow('typeBoth', 'Seller type BOTH:', this.categorized.typeBoth.length, 'Records with seller_type BOTH.');
      html += this.statRow('confidential', 'Confidential (is_confidential=1):', this.categorized.confidential.length, 'Records flagged confidential.');
    }

    html += `
      <button id="runAnalysisBtn" class="vbtn primary">Analyze ${domainCount} Domains</button>
      <div id="verifyProgress">
        <div class="progress-track"><div id="verifyProgressBarInner"></div></div>
        <div class="progress-meta"><span id="progressText">Analyzing...</span><span id="progressCount">0 / ${domainCount}</span></div>
      </div>
      <div id="analysis-stats-container" style="margin-top:15px;">`;

    if (this.isBuyers) {
      html += this.statRow('invSellersJson', 'Invalid sellers.json:', 0, 'Missing sellers.json.', true);
      html += this.statRow('invBuyersJson', 'Invalid buyers.json:', 0, 'Missing buyers.json.', true);
      html += this.statRow('validSellersJson', 'Valid sellers.json:', 0, 'Has sellers.json.', true);
      html += this.statRow('validBuyersJson', 'Valid buyers.json:', 0, 'Has buyers.json.', true);
    } else {
      if (this.config.showInvalidAds) html += this.statRow('invAds', 'Invalid ads.txt line:', 0, 'seller_id not found in ads.txt.', true);
      if (this.config.showInvalidAppAds) html += this.statRow('invApp', 'Invalid app-ads.txt line:', 0, 'seller_id not found in app-ads.txt.', true);
      if (this.config.showTotalInvalid) html += this.statRow('totInv', 'Total invalid Sellers:', 0, 'Not found in both files.', true);
      if (this.config.showTotalFound) html += this.statRow('totFnd', 'Total found Sellers:', 0, 'Found in at least one file.', true);
    }

    html += '</div>';
    return html;
  }

  bindPanelEvents(uniqueDomains, entitiesToAnalyze) {
    document.getElementById('switchFileBtn')?.addEventListener('click', event => {
      const nextUrl = event.currentTarget.getAttribute('data-url');
      if (nextUrl) window.location.href = nextUrl;
    });

    document.getElementById('overviewSearchInput')?.addEventListener('input', event => {
      this.applyLocalFilter(event.target.value || '');
    });

    const runButton = document.getElementById('runAnalysisBtn');
    runButton?.addEventListener('click', async () => {
      runButton.disabled = true;
      runButton.innerText = 'Analysis in progress...';
      document.getElementById('verifyProgress')?.classList.add('visible');

      if (this.isBuyers) {
        await this.startBuyersAnalysis([...uniqueDomains], entitiesToAnalyze);
      } else {
        await this.startSellersAnalysis(entitiesToAnalyze.filter(entity => entity.seller_id));
      }

      runButton.innerText = 'Analysis Complete!';
      const progressText = document.getElementById('progressText');
      if (progressText) progressText.innerText = 'Done!';
    }, { once: true });
  }

  statRow(id, label, value, tip, isHidden = false) {
    return `<div class="overview-stat" id="row-${id}" style="${isHidden ? 'display:none;' : ''}"><span class="stat-label" data-category="${id}" data-tip="${tip.replace(/"/g, '&quot;')}">${label}</span><span class="stat-val" id="val-${id}">${value}</span></div>`;
  }

  updateStatsUI() {
    const updates = this.isBuyers
      ? ['invSellersJson', 'invBuyersJson', 'validSellersJson', 'validBuyersJson']
      : ['invAds', 'invApp', 'totInv', 'totFnd'];

    for (const id of updates) {
      const row = document.getElementById(`row-${id}`);
      const value = document.getElementById(`val-${id}`);
      if (!row || !value) continue;
      row.style.display = 'flex';
      value.innerText = String(this.categorized[id].length);
    }
  }

  static validateDomain(raw) {
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized.length > 253 || !normalized.includes('.')) return null;

    try {
      const url = new URL(`https://${normalized}`);
      if (url.hostname !== normalized) return null;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return null;
      return normalized;
    } catch {
      return null;
    }
  }

  static parseAdsTxt(text) {
    const sellerIds = new Set();
    if (!text) return sellerIds;

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const columns = line.split('#')[0].trim().split(',');
      if (columns.length < 3) continue;
      const accountId = columns[1]?.trim();
      if (accountId) sellerIds.add(accountId);
    }

    return sellerIds;
  }

  fetchFromBackground(url) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'fetchAds', url }, response => {
        resolve(response && response.success ? response.text : null);
      });
    });
  }

  async fetchDomainAdsTxt(domain) {
    if (this.domainCache.has(domain)) return this.domainCache.get(domain);

    const [adsText, appAdsText] = await Promise.all([
      this.fetchFromBackground(`https://${domain}/ads.txt`),
      this.fetchFromBackground(`https://${domain}/app-ads.txt`)
    ]);

    const result = {
      adsIds: SellersInspector.parseAdsTxt(adsText),
      appIds: SellersInspector.parseAdsTxt(appAdsText)
    };

    this.domainCache.set(domain, result);
    return result;
  }

  async startSellersAnalysis(sellers) {
    await this.runWithConcurrency(sellers, async seller => this.checkSeller(seller));
  }

  async startBuyersAnalysis(uniqueDomains, allEntries) {
    const byDomain = new Map();
    for (const entry of allEntries) {
      if (entry._normalizedDomain && !byDomain.has(entry._normalizedDomain)) {
        byDomain.set(entry._normalizedDomain, entry);
      }
    }

    await this.runWithConcurrency(uniqueDomains, async domain => this.checkBuyerDomain(domain, byDomain));
  }

  async runWithConcurrency(items, taskRunner) {
    const total = items.length;
    if (!total) return;

    let active = 0;
    let completed = 0;
    let index = 0;
    const startedAt = Date.now();

    const bar = document.getElementById('verifyProgressBarInner');
    const countEl = document.getElementById('progressCount');
    const textEl = document.getElementById('progressText');

    const updateProgress = () => {
      if (bar) bar.style.width = `${(completed / total) * 100}%`;
      if (countEl) countEl.innerText = `${completed} / ${total}`;
      if (!textEl || completed < 1) return;

      const elapsed = Date.now() - startedAt;
      const estimatedSeconds = Math.round((elapsed / completed) * (total - completed) / 1000);
      textEl.innerText = estimatedSeconds > 0 ? `~${estimatedSeconds}s remaining` : 'Finishing...';
    };

    await new Promise(resolve => {
      const enqueue = () => {
        while (active < SellersInspector.CONCURRENCY_LIMIT && index < total) {
          const item = items[index++];
          active += 1;

          Promise.resolve(taskRunner(item))
            .catch(() => {})
            .finally(() => {
              active -= 1;
              completed += 1;
              updateProgress();

              if (completed >= total) {
                resolve();
              } else {
                enqueue();
              }
            });
        }
      };

      enqueue();
    });
  }

  async checkSeller(seller) {
    const sellerId = String(seller.seller_id || '');
    const safeId = window.CSS?.escape ? CSS.escape(sellerId) : sellerId;
    const badgeContainer = document.querySelector(`.seller-badges[data-seller-id="${safeId}"]`);
    if (badgeContainer) badgeContainer.innerHTML = '<span class="badge badge-wait">Checking...</span>';

    const domain = seller._normalizedDomain || seller.domain;
    const { adsIds, appIds } = await this.fetchDomainAdsTxt(domain);

    const foundInAds = adsIds.has(sellerId);
    const foundInAppAds = appIds.has(sellerId);

    if (!foundInAds) this.categorized.invAds.push(seller);
    if (!foundInAppAds) this.categorized.invApp.push(seller);
    if (!foundInAds && !foundInAppAds) this.categorized.totInv.push(seller);
    if (foundInAds || foundInAppAds) this.categorized.totFnd.push(seller);
    this.updateStatsUI();

    if (!badgeContainer) return;
    badgeContainer.innerHTML =
      (foundInAds ? `<span class="badge badge-ok">Ads: OK</span>${this.buildAdsLink(domain)}` : '<span class="badge badge-err">Ads: NO</span>') +
      (foundInAppAds ? '<span class="badge badge-ok">App: OK</span>' : '<span class="badge badge-err">App: NO</span>');
  }

  async checkBuyerDomain(domain, domainEntryMap) {
    const safeDomain = window.CSS?.escape ? CSS.escape(domain) : domain;
    const badgeContainers = document.querySelectorAll(`.seller-badges[data-domain="${safeDomain}"]`);
    badgeContainers.forEach(node => {
      node.innerHTML = '<span class="badge badge-wait">Checking...</span>';
    });

    const [hasSellersJson, hasBuyersJson] = await Promise.all([
      this.fetchJsonExists(`https://${domain}/sellers.json`),
      this.fetchJsonExists(`https://${domain}/buyers.json`)
    ]);

    const entry = domainEntryMap.get(domain);
    if (entry) {
      (hasSellersJson ? this.categorized.validSellersJson : this.categorized.invSellersJson).push(entry);
      (hasBuyersJson ? this.categorized.validBuyersJson : this.categorized.invBuyersJson).push(entry);
      this.updateStatsUI();
    }

    badgeContainers.forEach(node => {
      node.innerHTML =
        (hasSellersJson ? '<span class="badge badge-ok">Sellers: OK</span>' : '<span class="badge badge-err">Sellers: NO</span>') +
        (hasBuyersJson ? '<span class="badge badge-ok">Buyers: OK</span>' : '<span class="badge badge-err">Buyers: NO</span>');
    });
  }

  async fetchJsonExists(url) {
    const text = await this.fetchFromBackground(url);
    if (!text) return false;

    try {
      const parsed = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null;
    } catch {
      return false;
    }
  }

  buildAdsLink(domain) {
    return `<a class="badge-link" href="https://${domain}/ads.txt" target="_blank" rel="noopener noreferrer" title="Open ads.txt"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 1a.5.5 0 0 0 0 1h2.793L8.146 7.146a.5.5 0 1 0 .708.708L14 2.707V5.5a.5.5 0 0 0 1 0v-4a.5.5 0 0 0-.5-.5h-4z"/><path d="M13 8.5a.5.5 0 0 0-1 0V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4.5a.5.5 0 0 0 0-1H3A2 2 0 0 0 1 5v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5z"/></svg></a>`;
  }

  injectModalAndTooltip() {
    const tooltip = document.createElement('div');
    tooltip.id = 'sellers-tooltip';
    document.body.appendChild(tooltip);

    document.body.insertAdjacentHTML('beforeend', `
      <div id="sellers-modal-overlay">
        <div id="sellers-modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title-text">Filtered ${this.entityName}</span>
            <div class="modal-sort-wrap" id="modalSortWrap" style="display:none;">
              <button class="modal-sort-btn" id="modalSortAscBtn">A-Z</button>
              <button class="modal-sort-btn" id="modalSortDescBtn">Z-A</button>
            </div>
            <span class="modal-close" id="modalCloseBtn">&times;</span>
          </div>
          <div class="modal-body"><pre id="modal-json-content"></pre></div>
          <div class="modal-footer">
            <button class="modal-btn" id="modalCopyBtn">Copy to Clipboard</button>
            <button class="modal-btn" id="modalCsvBtn">Save .csv</button>
            <button class="modal-btn primary" id="modalSaveBtn">Save .json</button>
          </div>
        </div>
      </div>`);

    document.addEventListener('mousemove', event => {
      const label = event.target.closest('.stat-label[data-tip]');
      if (!label) {
        tooltip.classList.remove('visible');
        return;
      }

      tooltip.innerText = label.getAttribute('data-tip');
      tooltip.classList.add('visible');
      tooltip.style.left = `${Math.min(window.innerWidth - 252, event.clientX + 12)}px`;
      tooltip.style.top = `${Math.max(12, event.clientY - 10)}px`;
    });

    document.addEventListener('click', event => {
      const label = event.target.closest('.stat-label[data-category]');
      if (!label) return;
      this.openModal(label.getAttribute('data-category'), label.innerText.replace(':', ''));
    });

    const overlay = document.getElementById('sellers-modal-overlay');
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => overlay.classList.remove('visible'));
    overlay?.addEventListener('click', event => {
      if (event.target === overlay) overlay.classList.remove('visible');
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && overlay.classList.contains('visible')) {
        overlay.classList.remove('visible');
      }
    });

    document.getElementById('modalCopyBtn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.currentModalJSON);
        const button = document.getElementById('modalCopyBtn');
        button.innerText = 'Copied!';
        setTimeout(() => {
          button.innerText = 'Copy to Clipboard';
        }, 1200);
      } catch {
      }
    });

    document.getElementById('modalSaveBtn')?.addEventListener('click', () => this.saveModalPayload());
    document.getElementById('modalCsvBtn')?.addEventListener('click', () => this.saveModalCsv());
    document.getElementById('modalSortAscBtn')?.addEventListener('click', () => this.sortListAndRender('asc'));
    document.getElementById('modalSortDescBtn')?.addEventListener('click', () => this.sortListAndRender('desc'));
  }

  openModal(category, labelName) {
    this.currentModalCategory = category;
    this.currentModalArray = [];
    this.currentListType = '';

    if (category === 'domainList' || category === 'nameList') {
      this.currentListType = category;
      const values = new Set();
      const accessor = category === 'domainList' ? 'domain' : 'name';
      for (const item of this.categorized.total) {
        if (typeof item[accessor] === 'string' && item[accessor].trim()) {
          values.add(item[accessor].trim());
        }
      }
      this.currentModalArray = [...values];
      this.sortListAndRender('asc');
      document.getElementById('modal-title-text').innerText = `${category === 'domainList' ? 'Domains' : 'Names'} (${this.currentModalArray.length})`;
      document.getElementById('modalSortWrap').style.display = 'inline-flex';
      document.getElementById('modalSaveBtn').innerText = 'Save .txt';
      document.getElementById('sellers-modal-overlay').classList.add('visible');
      return;
    }

    const entries = (this.categorized[category] || []).map(item => {
      const cleanItem = { ...item };
      delete cleanItem._normalizedDomain;
      return cleanItem;
    });

    this.currentModalArray = entries;
    this.currentModalJSON = JSON.stringify({ ...this.originalNetworkData, [this.entityKey]: entries }, null, 2);

    document.getElementById('modalSortWrap').style.display = 'none';
    document.getElementById('modalSaveBtn').innerText = 'Save .json';
    document.getElementById('modal-title-text').innerText = `${labelName} (${entries.length} records)`;
    document.getElementById('modal-json-content').innerText = this.currentModalJSON;
    document.getElementById('sellers-modal-overlay').classList.add('visible');
  }

  sortListAndRender(direction) {
    if (!this.currentListType) return;
    this.currentModalArray.sort((left, right) => direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left));
    this.currentModalJSON = this.currentModalArray.join('\n');
    document.getElementById('modal-json-content').innerText = this.currentModalJSON;
  }

  saveModalPayload() {
    const isTextList = this.currentListType === 'domainList' || this.currentListType === 'nameList';
    const blob = new Blob([this.currentModalJSON], { type: isTextList ? 'text/plain' : 'application/json' });
    this.downloadBlob(blob, isTextList
      ? `${this.entityKey}_${this.currentListType === 'domainList' ? 'domains' : 'names'}.txt`
      : `${this.entityKey}_filtered_${this.currentModalCategory}.json`);
  }

  saveModalCsv() {
    const rows = this.currentListType ? this.currentModalArray.map(value => ({ value })) : this.currentModalArray;
    const csv = this.toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    this.downloadBlob(blob, `${this.entityKey}_${this.currentModalCategory || 'export'}.csv`);
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  toCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const keys = [...rows.reduce((set, row) => {
      Object.keys(row || {}).forEach(key => set.add(key));
      return set;
    }, new Set())];

    const escapeValue = value => {
      if (value === null || value === undefined) return '';
      const normalized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
    };

    const csvRows = [keys.join(',')];
    for (const row of rows) {
      csvRows.push(keys.map(key => escapeValue(row[key])).join(','));
    }

    return csvRows.join('\n');
  }

  escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

chrome.storage.local.get(window.SELLERS_INSPECTOR_DEFAULTS || {}, config => {
  new SellersInspector(config);
});