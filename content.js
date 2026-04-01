/**
 * Sellers.json Inspector — Content Script
 *
 * Improvements over v1.0:
 *  - Class-based architecture (SellersInspector) instead of globals
 *  - Domain-level fetch caching: each domain's ads.txt / app-ads.txt fetched once
 *  - IAB-spec ads.txt line parsing (matches seller_id in the correct CSV field)
 *  - XSS protection: URL scheme validation before injecting <a> tags
 *  - Smarter tooltip positioning (no off-screen overflow)
 *  - Domain validation via URL API instead of loose regex
 *  - Keyboard-accessible modal (Escape to close)
 *  - Estimated time remaining in progress bar
 */

class SellersInspector {
  constructor(config) {
    this.config = config;

    this.categorized = {
      total: [],
      unique: [],
      invalidDomain: [],
      invAds: [],
      invApp: [],
      totInv: [],
      totFnd: []
    };

    this.originalNetworkData = {};
    this.currentModalJSON = '';
    this.currentModalCategory = '';

    /** @type {Map<string, {ads: string|null, app: string|null}>} */
    this.domainCache = new Map();

    this.init();
  }

  // ─── Initialization ────────────────────────────────────────────

  init() {
    const rawText = document.body.innerText;
    let jsonData;

    try {
      jsonData = JSON.parse(rawText);
    } catch {
      return; // not a JSON page
    }

    this.originalNetworkData = { ...jsonData };
    delete this.originalNetworkData.sellers;

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

  /**
   * Validates a domain string more strictly than a simple regex.
   * Returns the normalized lowercase domain or null.
   */
  static validateDomain(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;

    try {
      const url = new URL('https://' + trimmed);
      // hostname must match what we put in (no path injection, etc.)
      if (url.hostname !== trimmed) return null;
      // must have at least one dot
      if (!trimmed.includes('.')) return null;
      // reject IPs
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  // ─── Syntax Highlighting ───────────────────────────────────────

  /**
   * Safely checks if a string is a navigable URL (http/https only).
   */
  static safeHref(str) {
    const raw = str.replace(/"/g, '');
    let url;
    try {
      url = raw.startsWith('http') ? new URL(raw) : new URL('https://' + raw);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // basic domain format check
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

    // inject badge placeholders after seller_id values
    return str.replace(
      /(<span class="json-key">"seller_id":<\/span>\s*<span class="json-string">)"(.*?)"(<\/span>)/g,
      (fullMatch, p1, id, p2) => {
        const escaped = id.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `${fullMatch} <span class="seller-badges" data-seller-id="${escaped}"></span>`;
      }
    );
  }

  // ─── IAB ads.txt Parsing ───────────────────────────────────────

  /**
   * Parses ads.txt / app-ads.txt content per IAB spec and returns
   * a Set of seller_id strings found.
   *
   * Each valid line format: <domain>, <seller_id>, <relationship>[, <cert_authority>]
   * Lines starting with # are comments. Blank lines are skipped.
   */
  static parseAdsTxt(text) {
    const ids = new Set();
    if (!text) return ids;

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Remove inline comments
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
    const sellersToAnalyze = [];

    if (data.sellers && Array.isArray(data.sellers)) {
      for (const s of data.sellers) {
        this.categorized.total.push(s);

        const domain = SellersInspector.validateDomain(s.domain);
        if (domain) {
          if (!seenDomains.has(domain)) {
            seenDomains.add(domain);
            this.categorized.unique.push(s);
          }
          if (s.seller_id) sellersToAnalyze.push({ ...s, _normalizedDomain: domain });
        } else {
          this.categorized.invalidDomain.push(s);
        }
      }
    }

    let html = `<div class="overview-title">Sellers.json Overview</div>`;

    if (cfg.showTotalSellers) html += this.statRow('total', 'Total Sellers:', this.categorized.total.length, 'Total number of seller records in the file.');
    if (cfg.showUniqueSellers) html += this.statRow('unique', 'Unique Sellers:', this.categorized.unique.length, 'First occurrence of each unique domain.');
    if (cfg.showInvalidDomains) html += this.statRow('invalidDomain', 'Invalid domain:', this.categorized.invalidDomain.length, 'Sellers with missing or incorrectly formatted domains.');

    html += `
      <button id="runAnalysisBtn" class="vbtn primary">Analyze ${sellersToAnalyze.length} Domains</button>
      <div id="verifyProgress">
        <div class="progress-track"><div id="verifyProgressBarInner"></div></div>
        <div class="progress-meta">
          <span id="progressText">Analyzing...</span>
          <span id="progressCount">0 / ${sellersToAnalyze.length}</span>
        </div>
      </div>
      <div id="analysis-stats-container" style="margin-top:15px;">`;

    if (cfg.showInvalidAds) html += this.statRow('invAds', 'Invalid ads.txt line:', 0, 'Sellers whose ID was not found in their ads.txt file.', true);
    if (cfg.showInvalidAppAds) html += this.statRow('invApp', 'Invalid app-ads.txt line:', 0, 'Sellers whose ID was not found in their app-ads.txt file.', true);
    if (cfg.showTotalInvalid) html += this.statRow('totInv', 'Total invalid Sellers:', 0, 'Sellers whose ID was missing from BOTH ads.txt and app-ads.txt.', true);
    if (cfg.showTotalFound) html += this.statRow('totFnd', 'Total found Sellers:', 0, 'Sellers whose ID was found in AT LEAST ONE of the files.', true);

    html += `</div>`;

    panel.innerHTML = html;
    document.body.appendChild(panel);

    const btn = document.getElementById('runAnalysisBtn');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerText = 'Analysis in progress...';
      document.getElementById('verifyProgress').classList.add('visible');

      this.startAnalysis(sellersToAnalyze, () => {
        btn.innerText = 'Analysis Complete!';
        document.getElementById('progressText').innerText = 'Done!';
      });
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
    const updates = [
      { id: 'invAds', val: this.categorized.invAds.length },
      { id: 'invApp', val: this.categorized.invApp.length },
      { id: 'totInv', val: this.categorized.totInv.length },
      { id: 'totFnd', val: this.categorized.totFnd.length }
    ];

    for (const { id, val } of updates) {
      const row = document.getElementById(`row-${id}`);
      const valSpan = document.getElementById(`val-${id}`);
      if (row && valSpan) {
        row.style.display = 'flex';
        valSpan.innerText = val;
      }
    }
  }

  // ─── Analysis Queue ────────────────────────────────────────────

  /**
   * Fetches ads.txt / app-ads.txt for a domain, caching per-domain.
   * Returns { adsIds: Set, appIds: Set }
   */
  async fetchDomainFiles(domain) {
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

  async startAnalysis(sellers, onComplete) {
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

      // ETA calculation
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
    const { adsIds, appIds } = await this.fetchDomainFiles(domain);

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

  // ─── Modal & Tooltip ───────────────────────────────────────────

  injectModalAndTooltip() {
    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'sellers-tooltip';
    document.body.appendChild(tooltip);

    // Modal
    document.body.insertAdjacentHTML('beforeend', `
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
      </div>`);

    // Tooltip follow with safe positioning
    document.addEventListener('mousemove', e => {
      if (e.target.matches('.stat-label[data-tip]')) {
        tooltip.innerText = e.target.getAttribute('data-tip');
        tooltip.classList.add('visible');

        const tipW = 240;
        const pad = 12;
        let left = e.clientX + pad;
        let top = e.clientY - 10;

        // prevent overflow right
        if (left + tipW > window.innerWidth) {
          left = e.clientX - tipW - pad;
        }
        // prevent overflow top
        if (top < 0) top = pad;

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      } else {
        tooltip.classList.remove('visible');
      }
    });

    // Stat label click -> modal
    document.addEventListener('click', e => {
      if (e.target.matches('.stat-label[data-category]')) {
        const category = e.target.getAttribute('data-category');
        const label = e.target.innerText.replace(':', '');
        this.openModal(category, label);
      }
    });

    // Close modal
    const overlay = document.getElementById('sellers-modal-overlay');

    document.getElementById('modalCloseBtn').addEventListener('click', () => {
      overlay.classList.remove('visible');
    });

    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('visible');
    });

    // Escape key closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        overlay.classList.remove('visible');
      }
    });

    // Copy
    document.getElementById('modalCopyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(this.currentModalJSON).then(() => {
        const btn = document.getElementById('modalCopyBtn');
        btn.innerText = 'Copied!';
        setTimeout(() => (btn.innerText = 'Copy to Clipboard'), 1500);
      });
    });

    // Save
    document.getElementById('modalSaveBtn').addEventListener('click', () => {
      const blob = new Blob([this.currentModalJSON], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sellers_filtered_${this.currentModalCategory}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  openModal(category, labelName) {
    this.currentModalCategory = category;

    const sellers = this.categorized[category] || [];
    // Strip internal _normalizedDomain before export
    const cleanSellers = sellers.map(s => {
      const copy = { ...s };
      delete copy._normalizedDomain;
      return copy;
    });

    const exportData = {
      ...this.originalNetworkData,
      sellers: cleanSellers
    };

    this.currentModalJSON = JSON.stringify(exportData, null, 2);

    document.getElementById('modal-title-text').innerText =
      `${labelName} (${cleanSellers.length} records)`;
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