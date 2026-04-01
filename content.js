initInspector();

function initInspector() {
  const rawText = document.body.innerText;
  let jsonData;
  
  try { jsonData = JSON.parse(rawText); } 
  catch (e) { return; }

  document.body.innerHTML = ''; 
  document.body.classList.add('sellers-inspector-active');

  const container = document.createElement('div');
  container.className = 'json-container';
  container.innerHTML = syntaxHighlight(jsonData);
  document.body.appendChild(container);

  buildOverviewPanel(jsonData);
}

// Рендерим JSON и вставляем невидимые контейнеры для бейджей возле каждого seller_id
function syntaxHighlight(json) {
  let str = JSON.stringify(json, undefined, 2);
  str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Базовая покраска
  str = str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) cls = 'json-key';
      else {
        cls = 'json-string';
        if (match.includes('http') || match.includes('.com') || match.includes('.net') || match.includes('.io')) {
          let url = match.replace(/"/g, '');
          url = url.startsWith('http') ? url : 'https://' + url;
          return `<a href="${url}" target="_blank" style="color:#4fc3f7; text-decoration:none;">${match}</a>`;
        }
      }
    }
    return `<span class="${cls}">${match}</span>`;
  });

  // Вставляем спан-контейнер data-seller-id для инжекта бейджей (Валид/Невалид)
  return str.replace(/"seller_id":\s*<span class="json-string">"(.*?)"<\/span>/g, (fullMatch, id) => {
    return `${fullMatch} <span class="seller-badges" data-seller-id="${id}"></span>`;
  });
}

function buildOverviewPanel(data) {
  const panel = document.createElement('div');
  panel.id = 'sellers-overview-panel';

  let domains = new Set();
  const sellersToAnalyze = [];

  if (data.sellers && Array.isArray(data.sellers)) {
    data.sellers.forEach(s => {
      if (s.domain) domains.add(s.domain);
      // Собираем тех, кого нужно проверить (только если есть домен и ID)
      if (s.domain && s.seller_id) {
        sellersToAnalyze.push({ id: String(s.seller_id), domain: s.domain });
      }
    });
  }

  panel.innerHTML = `
    <div class="overview-title">Sellers.json Overview</div>
    <div class="overview-stat"><span>Network:</span> <span class="stat-val">${data.contact_address || 'Unknown'}</span></div>
    <div class="overview-stat"><span>Total Sellers:</span> <span class="stat-val">${data.sellers ? data.sellers.length : 0}</span></div>
    <div class="overview-stat"><span>Unique Domains:</span> <span class="stat-val">${domains.size}</span></div>
    
    <button id="runAnalysisBtn" class="vbtn primary">Analyze ${sellersToAnalyze.length} Domains</button>
    
    <div id="verifyProgress">
      <div class="progress-track"><div id="verifyProgressBarInner"></div></div>
      <div class="progress-meta">
        <span id="progressText">Analyzing...</span>
        <span id="progressCount">0 / ${sellersToAnalyze.length}</span>
      </div>
    </div>
  `;
  
  document.body.appendChild(panel);

  // Обработчик клика "Analyze"
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

// ── Логика асинхронной очереди (чтобы не убить браузер тысячами запросов) ──

async function startAnalysisQueue(sellers, onComplete) {
  const CONCURRENCY_LIMIT = 10; // Одновременно проверяем 10 доменов
  let currentIndex = 0;
  let completed = 0;
  let activeWorkers = 0;
  const total = sellers.length;

  const progressBar = document.getElementById('verifyProgressBarInner');
  const progressCount = document.getElementById('progressCount');

  return new Promise(resolve => {
    function runNext() {
      // Если все завершены
      if (completed >= total) {
        onComplete();
        resolve();
        return;
      }
      // Запускаем воркеры до лимита
      while (activeWorkers < CONCURRENCY_LIMIT && currentIndex < total) {
        const seller = sellers[currentIndex++];
        activeWorkers++;
        
        checkDomain(seller).then(() => {
          completed++;
          activeWorkers--;
          
          // Обновляем UI прогресс-бара
          progressBar.style.width = `${(completed / total) * 100}%`;
          progressCount.innerText = `${completed} / ${total}`;
          
          runNext();
        });
      }
    }
    runNext();
  });
}

async function checkDomain(seller) {
  const badgeContainer = document.querySelector(`.seller-badges[data-seller-id="${seller.id}"]`);
  if (badgeContainer) {
    badgeContainer.innerHTML = `<span class="badge badge-wait">Checking...</span>`;
  }

  // Параллельно запрашиваем ads.txt и app-ads.txt через background (чтобы обойти CORS)
  const [adsText, appAdsText] = await Promise.all([
    fetchFromBackground(`https://${seller.domain}/ads.txt`),
    fetchFromBackground(`https://${seller.domain}/app-ads.txt`)
  ]);

  const hasAds = adsText && adsText.includes(seller.id);
  const hasAppAds = appAdsText && appAdsText.includes(seller.id);

  if (badgeContainer) {
    let html = '';
    html += hasAds ? `<span class="badge badge-ok">Ads: ✅</span>` : `<span class="badge badge-err">Ads: ❌</span>`;
    html += hasAppAds ? `<span class="badge badge-ok">App: ✅</span>` : `<span class="badge badge-err">App: ❌</span>`;
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