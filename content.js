/**
 * Sellers.json Inspector — Content Script
 *
 * Supports both sellers.json and buyers.json files.
 * - sellers.json: validates seller_id against ads.txt / app-ads.txt
 * - buyers.json: checks domain for existence of sellers.json / buyers.json
 *
 * Features:
 * - Class-based architecture (SellersInspector)
 * - Domain-level fetch caching
 * - IAB-spec ads.txt line parsing
 * - XSS protection: URL scheme validation
 * - Smarter tooltip positioning
 * - Domain validation via URL API
 * - Keyboard-accessible modal (Escape to close)
 * - Estimated time remaining in progress bar
 * - buyers.json / sellers.json switch navigation
 */

class SellersInspector {
  constructor(config) {
    this.config = config;

    // Detect file type from current URL
    this.fileType = this.detectFileType();
    this.isBuyers = this.fileType === 'buyers';
    this.entityName = this.isBuyers ? 'Buyers' : 'Sellers';
    this.entityKey = this.isBuyers ? 'buyers' : 'sellers';

    this.categorized = {
      total: [],
      unique: []
    };

    if (this.isBuyers) {
      this.categorized.invSellersJson = [];
      this.categorized.invBuyersJson = [];
      this.categorized.validSellersJson = [];
      this.categorized.validBuyersJson = [];
    } else {
      this.categorized.invalidDomain = [];
      this.categorized.invAds = [];
      this.categorized.invApp = [];
      this.categorized.totInv = [];
      this.categorized.totFnd = [];
    }

    this.originalNetworkData = {};
    this.currentModalJSON = '';
    this.currentModalCategory = '';

    /** @type {Map<string, any>} */
    this.domainCache = new Map();

    this.init();
  }

  // ─── File Type Detection ───────────────────────────────────────

  detectFileType() {
    const url = window.location.href.toLowerCase();
    if (url.includes('buyers.json')) return 'buyers';
    return 'sellers';
  }

  getSwitchUrl() {
    const url = window.location.href;
    if (this.fileType === 'sellers') {
      return url.replace(/sellers\.json/i, 'buyers.json');
    } else {
      return url.replace(/buyers\.json/i, 'sellers.json');
    }
  }

  getSwitchLabel() {
    return this.fileType === 'sellers' ? 'Buyers.json' : 'Sellers.json';
  }

  // ─── Initialization ────────────────────────────────────────────

  init() {
    const rawText = document.body.innerText;
    let jsonData;

    try {
      jsonData = JSON.parse(rawText);
    } catch {
      return;
    }

    this.originalNetworkData = { ...jsonData };
    delete this.originalNetworkData[this.entityKey];

    this.applyColors();

    document.body.innerHTML = '';
    document.body.classList.add('sellers-inspector-active');

    const container = document.createElement('div');
    container.className = 'json-container';
    container.innerHTML = this.syntaxHighlight(jsonData);
    document.body.appendChild(container);

    if (this.config.showPanel) {
      this.buildOverviewPanel(jsonData);
      this.injectModalAndTooltip();
    }
  }

  applyColors() {
    const root = document.documentElement.style;
    root.setProperty('--json-key', this.config.keyColor);
    root.setProperty('--json-str', this.config.strColor);
    root.setProperty('--json-num', this.config.numColor);
    root.setProperty('--json-bool', this.config.boolColor);
  }

  // ─── Domain Validation ─────────────────────────────────────────

  static validateDomain(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;

    try {
      const url = new URL('https://' + trimmed);
      if (url.hostname !== trimmed) return null;
      if (!trimmed.includes('.')) return null;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  // ─── Syntax Highlighting ───────────────────────────────────────

  static safeHref(str) {
    const raw = str.replace(/"/g, '');
    let url;
    try {
      url = raw.startsWith('http') ? new URL(raw) : new URL('https://' + raw);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(url.hostname)) return null;
    return url.href;
  }

  syntaxHighlight(json) {
    let str = JSON.stringify(json, undefined, 2);
    str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    str = str.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
            const href = SellersInspector.safeHref(match);
            if (href) {
              const escaped = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
              return `<a href="${escaped}" target="_blank" rel="noopener noreferrer" style="color:#5a9fd4;text-decoration:none;">${match}</a>`;
            }
          }
        } else if (/true|false|null/.test(match)) {
          cls = 'json-boolean';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );

    if (this.isBuyers) {
      return str.replace(
        /(<span class="json-key">"domain":<\/span>\s*)((?:<a[^>]*>)"([^"]*)"(?:<\/a>)|<span class="json-string">"([^"]*)"<\/span>)/g,
        (fullMatch, prefix, valueBlock, linkedDomain, plainDomain) => {
          const domain = linkedDomain || plainDomain || '';
          const escaped = domain.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          return `${fullMatch} <span class="seller-badges" data-domain="${escaped}"></span>`;
        }
      );
    } else {
      return str.replace(
        /(<span class="json-key">"seller_id":<\/span>\s*<span class="json-string">")(.*?)("<\/span>)/g,
        (fullMatch, p1, id, p3) => {
          const escaped = id.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          return `${fullMatch} <span class="seller-badges" data-seller-id="${escaped}"></span>`;
        }
      );
    }
  }

  // ─── IAB ads.txt Parsing ───────────────────────────────────────

  static parseAdsTxt(text) {
    const ids = new Set();
    if (!text) return ids;

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const noComment = trimmed.split('#')[0].trim();
      const parts = noComment.split(',');
      if (parts.length < 3) continue;

      const sellerId = parts[1].trim();
      if (sellerId) {
        ids.add(sellerId);
      }
    }
    return ids;
  }

  // ─── Overview Panel ────────────────────────────────────────────

  buildOverviewPanel(data) {
    const cfg = this.config;
    const panel = document.createElement('div');
    panel.id = 'sellers-overview-panel';

    const seenDomains = new Set();
    const entitiesToAnalyze = [];

    const entities = data[this.entityKey];

    if (entities && Array.isArray(entities)) {
      for (const s of entities) {
        this.categorized.total.push(s);

        const domain = SellersInspector.validateDomain(s.domain);
        if (domain) {
          if (!seenDomains.has(domain)) {
            seenDomains.add(domain);
            this.categorized.unique.push(s);
          }
          entitiesToAnalyze.push({ ...s, _normalizedDomain: domain });
        } else if (!this.isBuyers) {
          this.categorized.invalidDomain.push(s);
        }
      }
    }

    const switchLabel = this.getSwitchLabel();
    const switchUrl = this.getSwitchUrl();
    const switchBtnEscaped = switchUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    let html = '';

    html += `
      <button class="switch-file-btn" id="switchFileBtn" data-url="${switchBtnEscaped}" title="Navigate to ${switchLabel}">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5zm14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5z"/>
        </svg>
        Switch to ${switchLabel}
      </button>`;

    html += `<div class="overview-title">${this.entityName}.json Overview</div>`;

    if (cfg.showDomainList || cfg.showNameList) {
      html += `<div class="overview-stat" style="justify-content: flex-start; gap: 10px; margin-bottom: 12px;">`;
      if (cfg.showDomainList) {
        html += `<span class="stat-label" data-category="domainList" data-tip="List of all unique domains">Domain</span>`;
      }

      if (cfg.showDomainList && cfg.showNameList) {
        html += `<span style="color: #5a6480; font-weight: 700; font-size: 11px; user-select: none;">|</span>`;
      }
      
      if (cfg.showNameList) {
        html += `<span class="stat-label" data-category="nameList" data-tip="List of all unique names">Name</span>`;
      }
      html += `</div>`;
    }
    
    if (cfg.showTotalSellers) html += this.statRow('total', `Total ${this.entityName}:`, this.categorized.total.length, `Total number of ${this.entityName.toLowerCase()} records in the file.`);
    if (cfg.showUniqueSellers) html += this.statRow('unique', `Unique ${this.entityName}:`, this.categorized.unique.length, 'First occurrence of each unique domain.');

    if (!this.isBuyers && cfg.showInvalidDomains) {
      html += this.statRow('invalidDomain', 'Invalid domain:', this.categorized.invalidDomain.length, 'Sellers with missing or incorrectly formatted domains.');
    }

    const analyzeCount = seenDomains.size;
    html += `
      <button id="runAnalysisBtn" class="vbtn primary">Analyze ${analyzeCount} Domains</button>
      <div id="verifyProgress">
        <div class="progress-track"><div id="verifyProgressBarInner"></div></div>
        <div class="progress-meta">
          <span id="progressText">Analyzing...</span>
          <span id="progressCount">0 / ${analyzeCount}</span>
        </div>
      </div>
      <div id="analysis-stats-container" style="margin-top:15px;">`;

    if (this.isBuyers) {
      html += this.statRow('invSellersJson', 'Invalid sellers.json:', 0, 'Domains that do not have a sellers.json file.', true);
      html += this.statRow('invBuyersJson', 'Invalid buyers.json:', 0, 'Domains that do not have a buyers.json file.', true);
      html += this.statRow('validSellersJson', 'Valid sellers.json:', 0, 'Domains that have a sellers.json file.', true);
      html += this.statRow('validBuyersJson', 'Valid buyers.json:', 0, 'Domains that have a buyers.json file.', true);
    } else {
      if (cfg.showInvalidAds) html += this.statRow('invAds', 'Invalid ads.txt line:', 0, 'Sellers whose ID was not found in their ads.txt file.', true);
      if (cfg.showInvalidAppAds) html += this.statRow('invApp', 'Invalid app-ads.txt line:', 0, 'Sellers whose ID was not found in their app-ads.txt file.', true);
      if (cfg.showTotalInvalid) html += this.statRow('totInv', 'Total invalid Sellers:', 0, 'Sellers whose ID was missing from BOTH ads.txt and app-ads.txt.', true);
      if (cfg.showTotalFound) html += this.statRow('totFnd', 'Total found Sellers:', 0, 'Sellers whose ID was found in AT LEAST ONE of the files.', true);
    }

    html += `</div>`;

    panel.innerHTML = html;
    document.body.appendChild(panel);

    document.getElementById('switchFileBtn').addEventListener('click', () => {
      const url = document.getElementById('switchFileBtn').getAttribute('data-url');
      window.location.href = url;
    });

    const btn = document.getElementById('runAnalysisBtn');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerText = 'Analysis in progress...';
      document.getElementById('verifyProgress').classList.add('visible');

      if (this.isBuyers) {
        const uniqueDomains = [...seenDomains];
        this.startBuyersAnalysis(uniqueDomains, entitiesToAnalyze, () => {
          btn.innerText = 'Analysis Complete!';
          document.getElementById('progressText').innerText = 'Done!';
        });
      } else {
        const withId = entitiesToAnalyze.filter(s => s.seller_id);
        this.startSellersAnalysis(withId, () => {
          btn.innerText = 'Analysis Complete!';
          document.getElementById('progressText').innerText = 'Done!';
        });
      }
    }, { once: true });
  }

  statRow(id, label, val, tip, isHidden = false) {
    const display = isHidden ? 'display:none;' : '';
    const escapedTip = tip.replace(/"/g, '&quot;');
    return `
      <div class="overview-stat" id="row-${id}" style="${display}">
        <span class="stat-label" data-category="${id}" data-tip="${escapedTip}">${label}</span>
        <span class="stat-val" id="val-${id}">${val}</span>
      </div>`;
  }

  updateStatsUI() {
    let updates;
    if (this.isBuyers) {
      updates = [
        { id: 'invSellersJson', val: this.categorized.invSellersJson.length },
        { id: 'invBuyersJson', val: this.categorized.invBuyersJson.length },
        { id: 'validSellersJson', val: this.categorized.validSellersJson.length },
        { id: 'validBuyersJson', val: this.categorized.validBuyersJson.length }
      ];
    } else {
      updates = [
        { id: 'invAds', val: this.categorized.invAds.length },
        { id: 'invApp', val: this.categorized.invApp.length },
        { id: 'totInv', val: this.categorized.totInv.length },
        { id: 'totFnd', val: this.categorized.totFnd.length }
      ];
    }

    for (const { id, val } of updates) {
      const row = document.getElementById(`row-${id}`);
      const valSpan = document.getElementById(`val-${id}`);
      if (row && valSpan) {
        row.style.display = 'flex';
        valSpan.innerText = val;
      }
    }
  }

  // ─── Sellers.json Analysis Queue ───────────────────────────────

  async fetchDomainAdsTxt(domain) {
    if (this.domainCache.has(domain)) {
      return this.domainCache.get(domain);
    }

    const [adsText, appText] = await Promise.all([
      this.fetchFromBackground(`https://${domain}/ads.txt`),
      this.fetchFromBackground(`https://${domain}/app-ads.txt`)
    ]);

    const result = {
      adsIds: SellersInspector.parseAdsTxt(adsText),
      appIds: SellersInspector.parseAdsTxt(appText)
    };

    this.domainCache.set(domain, result);
    return result;
  }

  fetchFromBackground(url) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'fetchAds', url }, response => {
        resolve(response && response.success ? response.text : null);
      });
    });
  }

  async startSellersAnalysis(sellers, onComplete) {
    const CONCURRENCY = 10;
    let idx = 0;
    let completed = 0;
    let active = 0;
    const total = sellers.length;
    const startTime = Date.now();

    const bar = document.getElementById('verifyProgressBarInner');
    const countEl = document.getElementById('progressCount');
    const textEl = document.getElementById('progressText');

    const updateProgress = () => {
      const pct = (completed / total) * 100;
      bar.style.width = `${pct}%`;
      countEl.innerText = `${completed} / ${total}`;

      if (completed > 0) {
        const elapsed = Date.now() - startTime;
        const remaining = Math.round((elapsed / completed) * (total - completed) / 1000);
        if (remaining > 0) {
          textEl.innerText = `~${remaining}s remaining`;
        } else {
          textEl.innerText = 'Finishing...';
        }
      }
    };

    return new Promise(resolve => {
      const runNext = () => {
        if (completed >= total) {
          onComplete();
          resolve();
          return;
        }
        while (active < CONCURRENCY && idx < total) {
          const seller = sellers[idx++];
          active++;

          this.checkSeller(seller).then(() => {
            completed++;
            active--;
            updateProgress();
            runNext();
          });
        }
      };
      runNext();
    });
  }

  async checkSeller(seller) {
    const safeId = CSS.escape(seller.seller_id);
    const badgeContainer = document.querySelector(`.seller-badges[data-seller-id="${safeId}"]`);

    if (badgeContainer) {
      badgeContainer.innerHTML = '<span class="badge badge-wait">Checking...</span>';
    }

    const domain = seller._normalizedDomain || seller.domain;
    const { adsIds, appIds } = await this.fetchDomainAdsTxt(domain);

    const hasAds = adsIds.has(seller.seller_id);
    const hasApp = appIds.has(seller.seller_id);

    if (!hasAds) this.categorized.invAds.push(seller);
    if (!hasApp) this.categorized.invApp.push(seller);
    if (!hasAds && !hasApp) this.categorized.totInv.push(seller);
    if (hasAds || hasApp) this.categorized.totFnd.push(seller);

    this.updateStatsUI();

    if (badgeContainer) {
      badgeContainer.innerHTML =
        (hasAds ? '<span class="badge badge-ok">Ads: OK</span>' : '<span class="badge badge-err">Ads: NO</span>') +
        (hasApp ? '<span class="badge badge-ok">App: OK</span>' : '<span class="badge badge-err">App: NO</span>');
    }
  }

  // ─── Buyers.json Analysis Queue ────────────────────────────────

  async startBuyersAnalysis(uniqueDomains, allEntries, onComplete) {
    const CONCURRENCY = 10;
    let idx = 0;
    let completed = 0;
    let active = 0;
    const total = uniqueDomains.length;
    const startTime = Date.now();

    const domainEntryMap = new Map();
    for (const entry of allEntries) {
      if (!domainEntryMap.has(entry._normalizedDomain)) {
        domainEntryMap.set(entry._normalizedDomain, entry);
      }
    }

    const bar = document.getElementById('verifyProgressBarInner');
    const countEl = document.getElementById('progressCount');
    const textEl = document.getElementById('progressText');

    const updateProgress = () => {
      const pct = (completed / total) * 100;
      bar.style.width = `${pct}%`;
      countEl.innerText = `${completed} / ${total}`;

      if (completed > 0) {
        const elapsed = Date.now() - startTime;
        const remaining = Math.round((elapsed / completed) * (total - completed) / 1000);
        if (remaining > 0) {
          textEl.innerText = `~${remaining}s remaining`;
        } else {
          textEl.innerText = 'Finishing...';
        }
      }
    };

    return new Promise(resolve => {
      const runNext = () => {
        if (completed >= total) {
          onComplete();
          resolve();
          return;
        }
        while (active < CONCURRENCY && idx < total) {
          const domain = uniqueDomains[idx++];
          active++;

          this.checkBuyerDomain(domain, domainEntryMap).then(() => {
            completed++;
            active--;
            updateProgress();
            runNext();
          });
        }
      };
      runNext();
    });
  }

  async checkBuyerDomain(domain, domainEntryMap) {
    const safeDomain = CSS.escape(domain);
    const badges = document.querySelectorAll(`.seller-badges[data-domain="${safeDomain}"]`);
    for (const b of badges) {
      b.innerHTML = '<span class="badge badge-wait">Checking...</span>';
    }

    const [hasSellers, hasBuyers] = await Promise.all([
      this.fetchJsonExists(`https://${domain}/sellers.json`),
      this.fetchJsonExists(`https://${domain}/buyers.json`)
    ]);

    const entry = domainEntryMap.get(domain);
    if (entry) {
      if (hasSellers) {
        this.categorized.validSellersJson.push(entry);
      } else {
        this.categorized.invSellersJson.push(entry);
      }

      if (hasBuyers) {
        this.categorized.validBuyersJson.push(entry);
      } else {
        this.categorized.invBuyersJson.push(entry);
      }

      this.updateStatsUI();
    }

    for (const b of badges) {
      b.innerHTML =
        (hasSellers ? '<span class="badge badge-ok">Sellers: OK</span>' : '<span class="badge badge-err">Sellers: NO</span>') +
        (hasBuyers ? '<span class="badge badge-ok">Buyers: OK</span>' : '<span class="badge badge-err">Buyers: NO</span>');
    }
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

  // ─── Modal & Tooltip ───────────────────────────────────────────

  injectModalAndTooltip() {
    const tooltip = document.createElement('div');
    tooltip.id = 'sellers-tooltip';
    document.body.appendChild(tooltip);

    document.body.insertAdjacentHTML('beforeend', `
      <div id="sellers-modal-overlay">
        <div id="sellers-modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title-text">Filtered ${this.entityName}</span>
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
      </div>`);

    document.addEventListener('mousemove', e => {
      if (e.target.matches('.stat-label[data-tip]')) {
        tooltip.innerText = e.target.getAttribute('data-tip');
        tooltip.classList.add('visible');

        const tipW = 240;
        const pad = 12;
        let left = e.clientX + pad;
        let top = e.clientY - 10;

        if (left + tipW > window.innerWidth) {
          left = e.clientX - tipW - pad;
        }
        if (top < 0) top = pad;

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      } else {
        tooltip.classList.remove('visible');
      }
    });

    document.addEventListener('click', e => {
      if (e.target.matches('.stat-label[data-category]')) {
        const category = e.target.getAttribute('data-category');
        const label = e.target.innerText.replace(':', '');
        this.openModal(category, label);
      }
    });

    const overlay = document.getElementById('sellers-modal-overlay');

    document.getElementById('modalCloseBtn').addEventListener('click', () => {
      overlay.classList.remove('visible');
    });

    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('visible');
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        overlay.classList.remove('visible');
      }
    });

    document.getElementById('modalCopyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(this.currentModalJSON).then(() => {
        const btn = document.getElementById('modalCopyBtn');
        btn.innerText = 'Copied!';
        setTimeout(() => (btn.innerText = 'Copy to Clipboard'), 1500);
      });
    });

    document.getElementById('modalSaveBtn').addEventListener('click', () => {
      const isText = this.currentModalCategory === 'domainList' || this.currentModalCategory === 'nameList';
      const fileName = this.currentModalCategory === 'domainList' ? 'domains.txt' : 'names.txt';
      const blob = new Blob([this.currentModalJSON], { type: isText ? 'text/plain' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.entityKey}_${isText ? fileName : `filtered_${this.currentModalCategory}.json`}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  openModal(category, labelName) {
    this.currentModalCategory = category;

    if (category === 'domainList' || category === 'nameList') {
      const isDomain = category === 'domainList';
      const itemsSet = new Set();
      
      this.categorized.total.forEach(s => {
        const val = isDomain ? s.domain : s.name;
        if (val && typeof val === 'string') {
          itemsSet.add(val.trim());
        }
      });
      
      const itemsArray = Array.from(itemsSet);
      this.currentModalJSON = itemsArray.join('\n');

      document.getElementById('modal-title-text').innerText = `${isDomain ? 'Domains' : 'Names'} (${itemsArray.length})`;
      document.getElementById('modal-json-content').innerText = this.currentModalJSON;
      document.getElementById('modalSaveBtn').innerText = 'Save .txt';
      document.getElementById('sellers-modal-overlay').classList.add('visible');
      return;
    }

    document.getElementById('modalSaveBtn').innerText = 'Save .json';

    const entries = this.categorized[category] || [];
    const cleanEntries = entries.map(s => {
      const copy = { ...s };
      delete copy._normalizedDomain;
      return copy;
    });

    const exportData = {
      ...this.originalNetworkData,
      [this.entityKey]: cleanEntries
    };

    this.currentModalJSON = JSON.stringify(exportData, null, 2);

    document.getElementById('modal-title-text').innerText =
      `${labelName} (${cleanEntries.length} records)`;
    document.getElementById('modal-json-content').innerText = this.currentModalJSON;
    document.getElementById('sellers-modal-overlay').classList.add('visible');
  }
}

// ─── Entry Point ───────────────────────────────────────────────

chrome.storage.local.get(
  {
    keyColor: '#FF8C00',
    strColor: '#7bbf8e',
    numColor: '#F0FFF0',
    boolColor: '#F0FFF0',
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
  },
  config => {
    new SellersInspector(config);
  }
);