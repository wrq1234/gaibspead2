/**
 * GAIB Spread Monitor Main Application Script
 */

class SpreadMonitorApp {
  constructor() {
    this.bitgetData = null;
    this.krakenData = null;
    this.usdUsdFxRate = 1.0; // Conversion rate if pairs differ in quote currency
    this.spreadHistory = [];
    this.alerts = [];
    this.chart = null;
    this.lastLatency = 0;
    this.isDemoMode = false;

    this.initLocalStorage();
    this.initDOM();
    this.initChart();
    this.bindEvents();
    
    // Start Polling Data
    this.startPolling();
  }

  initLocalStorage() {
    const savedAlerts = localStorage.getItem('gaib_alerts');
    if (savedAlerts) {
      try { this.alerts = JSON.parse(savedAlerts); } catch (e) { this.alerts = []; }
    }
    
    const savedChatId = localStorage.getItem('gaib_chat_id');
    if (savedChatId) {
      setTimeout(() => {
        const el = document.getElementById('alertChatId');
        if (el) el.value = savedChatId;
      }, 200);
    }
  }

  saveAlerts() {
    localStorage.setItem('gaib_alerts', JSON.stringify(this.alerts));
  }

  initDOM() {
    this.renderAlertsList();
  }

  bindEvents() {
    // Fee / Setting inputs change handlers
    ['inputBitgetFee', 'inputKrakenFee', 'inputSlippage', 'inputNetworkCost', 'selectTradeSize'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.calculateAndRender());
    });

    // Alert Creation
    document.getElementById('btnCreateAlert').addEventListener('click', () => this.handleCreateAlert());
    document.getElementById('btnTestAlert').addEventListener('click', () => this.handleTestAlert());
    
    // Chat ID saving
    document.getElementById('alertChatId').addEventListener('input', (e) => {
      localStorage.setItem('gaib_chat_id', e.target.value.trim());
    });

    // Timeframe selector
    document.querySelectorAll('.btn-tf').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-tf').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.updateChartTimeframe(e.target.dataset.tf);
      });
    });
  }

  // --- API DATA FETCHING ---

  async fetchBitget() {
    const startTime = Date.now();
    try {
      const [tickerRes, obRes] = await Promise.all([
        fetch(CONFIG.BITGET.TICKER_URL),
        fetch(CONFIG.BITGET.ORDERBOOK_URL)
      ]);

      const tickerJson = await tickerRes.json();
      const obJson = await obRes.json();

      if (tickerJson.code === "00000" && tickerJson.data && tickerJson.data.length > 0) {
        const t = tickerJson.data[0];
        const ob = obJson.data || { asks: [], bids: [] };

        this.lastLatency = Date.now() - startTime;

        return {
          bid: parseFloat(t.bidPr),
          ask: parseFloat(t.askPr),
          last: parseFloat(t.lastPr),
          chg24h: parseFloat(t.change24h || 0) * 100,
          vol24h: parseFloat(t.quoteVolume || 0),
          asks: ob.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
          bids: ob.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
          timestamp: Date.now()
        };
      }
      throw new Error("Invalid Bitget response structure");
    } catch (err) {
      console.warn("Bitget API Error:", err);
      return null;
    }
  }

  async fetchKraken() {
    try {
      const response = await fetch(CONFIG.KRAKEN.TICKER_URL);
      const json = await response.json();

      // Check if pair is listed on Kraken
      if (json.error && json.error.length > 0) {
        this.enableDemoFallbackMode("GAIB pair is not active on Kraken Spot. Synthetic/Fallback Feed active.");
        return this.generateSyntheticKrakenData();
      }

      const keys = Object.keys(json.result || {});
      if (keys.length > 0) {
        const pairData = json.result[keys[0]];
        const obRes = await fetch(CONFIG.KRAKEN.ORDERBOOK_URL);
        const obJson = await obRes.json();
        const obData = obJson.result ? obJson.result[keys[0]] : { asks: [], bids: [] };

        return {
          bid: parseFloat(pairData.b[0]),
          ask: parseFloat(pairData.a[0]),
          last: parseFloat(pairData.c[0]),
          chg24h: 0.0, // Calculated separately if needed
          vol24h: parseFloat(pairData.v[1]) * parseFloat(pairData.c[0]),
          asks: obData.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
          bids: obData.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
          timestamp: Date.now()
        };
      }
      
      throw new Error("Empty Kraken payload");
    } catch (err) {
      this.enableDemoFallbackMode("Kraken Spot API unavailable. Demo Mode Active.");
      return this.generateSyntheticKrakenData();
    }
  }

  generateSyntheticKrakenData() {
    if (!this.bitgetData) {
      return {
        bid: 0.1250, ask: 0.1255, last: 0.1252, chg24h: 1.2, vol24h: 45000,
        asks: [[0.1255, 1000], [0.1260, 2000]], bids: [[0.1250, 1500], [0.1245, 2500]],
        timestamp: Date.now()
      };
    }
    // Simulate slight market variation on Kraken (+0.8% spread variation)
    const variation = 1.008;
    return {
      bid: parseFloat((this.bitgetData.bid * variation).toFixed(5)),
      ask: parseFloat((this.bitgetData.ask * variation).toFixed(5)),
      last: parseFloat((this.bitgetData.last * variation).toFixed(5)),
      chg24h: this.bitgetData.chg24h,
      vol24h: this.bitgetData.vol24h * 0.8,
      asks: this.bitgetData.asks.map(a => [parseFloat((a[0] * variation).toFixed(5)), a[1]]),
      bids: this.bitgetData.bids.map(b => [parseFloat((b[0] * variation).toFixed(5)), b[1]]),
      timestamp: Date.now()
    };
  }

  enableDemoFallbackMode(reason) {
    this.isDemoMode = true;
    const banner = document.getElementById('dataNotice');
    const text = document.getElementById('noticeText');
    banner.classList.remove('hidden');
    text.innerText = reason;
  }

  // --- CORE CALCULATION ENGINE ---

  calculateVWAP(orderBookSide, tradeSizeUsd) {
    if (!orderBookSide || orderBookSide.length === 0) return 0;
    
    let remainingUsd = tradeSizeUsd;
    let totalBaseVolume = 0;

    for (const [price, amount] of orderBookSide) {
      const levelUsd = price * amount;
      if (remainingUsd <= levelUsd) {
        totalBaseVolume += remainingUsd / price;
        remainingUsd = 0;
        break;
      } else {
        totalBaseVolume += amount;
        remainingUsd -= levelUsd;
      }
    }

    if (remainingUsd > 0) {
      // Orderbook deeper than trade size, use top level fallback
      return orderBookSide[0][0];
    }

    return tradeSizeUsd / totalBaseVolume;
  }

  async startPolling() {
    const updateLoop = async () => {
      const [bg, kr] = await Promise.all([this.fetchBitget(), this.fetchKraken()]);
      
      this.bitgetData = bg;
      this.krakenData = kr;

      this.calculateAndRender();
      setTimeout(updateLoop, CONFIG.DEFAULTS.refreshIntervalMs);
    };

    updateLoop();
  }

  calculateAndRender() {
    this.updateStatusBadge();

    if (!this.bitgetData || !this.krakenData) return;

    // Check data staleness (10s)
    const now = Date.now();
    if ((now - this.bitgetData.timestamp > 10000) || (now - this.krakenData.timestamp > 10000)) {
      document.getElementById('connectionStatus').innerText = "⚠️ STALE DATA";
      document.getElementById('connectionStatus').className = "status-badge offline";
      return;
    }

    // Input Parameters
    const bgFeePct = parseFloat(document.getElementById('inputBitgetFee').value) / 100 || 0;
    const krFeePct = parseFloat(document.getElementById('inputKrakenFee').value) / 100 || 0;
    const slipPct = parseFloat(document.getElementById('inputSlippage').value) / 100 || 0;
    const networkCost = parseFloat(document.getElementById('inputNetworkCost').value) || 0;
    const tradeSizeUsd = parseFloat(document.getElementById('selectTradeSize').value) || 100;

    // 1. Bitget -> Kraken (Buy Bitget Ask, Sell Kraken Bid)
    const b2kBuyPrice = this.calculateVWAP(this.bitgetData.asks, tradeSizeUsd) || this.bitgetData.ask;
    const b2kSellPrice = this.calculateVWAP(this.krakenData.bids, tradeSizeUsd) || this.krakenData.bid;
    
    const b2kGrossSpread = ((b2kSellPrice - b2kBuyPrice) / b2kBuyPrice) * 100;
    const b2kAbsDiff = b2kSellPrice - b2kBuyPrice;

    // 2. Kraken -> Bitget (Buy Kraken Ask, Sell Bitget Bid)
    const k2bBuyPrice = this.calculateVWAP(this.krakenData.asks, tradeSizeUsd) || this.krakenData.ask;
    const k2bSellPrice = this.calculateVWAP(this.bitgetData.bids, tradeSizeUsd) || this.bitgetData.bid;
    
    const k2bGrossSpread = ((k2bSellPrice - k2bBuyPrice) / k2bBuyPrice) * 100;
    const k2bAbsDiff = k2bSellPrice - k2bBuyPrice;

    // Render Cards UI
    this.renderExchangeCards();
    this.renderArbitrageCard(b2kBuyPrice, b2kSellPrice, b2kGrossSpread, b2kAbsDiff, k2bBuyPrice, k2bSellPrice, k2bGrossSpread, k2bAbsDiff);
    this.renderOrderBooks();

    // Render Profit Projections
    this.renderProfitTable(b2kGrossSpread, k2bGrossSpread, bgFeePct, krFeePct, slipPct, networkCost);

    // Update History & Table
    const record = {
      time: new Date().toLocaleTimeString(),
      bgAsk: b2kBuyPrice,
      krBid: b2kSellPrice,
      grossSpread: b2kGrossSpread,
      netSpread: b2kGrossSpread - ((bgFeePct + krFeePct + slipPct) * 100)
    };
    
    this.addHistoryRecord(record);
    this.checkAlerts(b2kGrossSpread, k2bGrossSpread, record.netSpread);
  }

  updateStatusBadge() {
    const badge = document.getElementById('connectionStatus');
    const latencyEl = document.getElementById('apiLatency');
    const updateEl = document.getElementById('lastUpdate');

    if (this.bitgetData && this.krakenData) {
      badge.innerText = this.isDemoMode ? "🟡 DEMO / LIVE" : "🟢 LIVE";
      badge.className = "status-badge online";
      latencyEl.innerText = `${this.lastLatency} ms`;
      updateEl.innerText = new Date().toLocaleTimeString();
    } else {
      badge.innerText = "🔴 OFFLINE";
      badge.className = "status-badge offline";
    }
  }

  renderExchangeCards() {
    // Bitget
    document.getElementById('bitgetBid').innerText = `$${this.bitgetData.bid.toFixed(5)}`;
    document.getElementById('bitgetAsk').innerText = `$${this.bitgetData.ask.toFixed(5)}`;
    document.getElementById('bitgetLast').innerText = `$${this.bitgetData.last.toFixed(5)}`;
    document.getElementById('bitget24hChg').innerText = `${this.bitgetData.chg24h.toFixed(2)}%`;
    document.getElementById('bitget24hVol').innerText = `$${Math.round(this.bitgetData.vol24h).toLocaleString()}`;
    document.getElementById('bitgetUpdateTime').innerText = new Date(this.bitgetData.timestamp).toLocaleTimeString();

    // Kraken
    document.getElementById('krakenBid').innerText = `$${this.krakenData.bid.toFixed(5)}`;
    document.getElementById('krakenAsk').innerText = `$${this.krakenData.ask.toFixed(5)}`;
    document.getElementById('krakenLast').innerText = `$${this.krakenData.last.toFixed(5)}`;
    document.getElementById('kraken24hChg').innerText = `${this.krakenData.chg24h.toFixed(2)}%`;
    document.getElementById('kraken24hVol').innerText = `$${Math.round(this.krakenData.vol24h).toLocaleString()}`;
    document.getElementById('krakenUpdateTime').innerText = new Date(this.krakenData.timestamp).toLocaleTimeString();
  }

  renderArbitrageCard(b2kBuy, b2kSell, b2kGross, b2kDiff, k2bBuy, k2bSell, k2bGross, k2bDiff) {
    // Bitget -> Kraken
    document.getElementById('b2kBuyPrice').innerText = `$${b2kBuy.toFixed(5)}`;
    document.getElementById('b2kSellPrice').innerText = `$${b2kSell.toFixed(5)}`;
    
    const b2kElem = document.getElementById('b2kGrossSpread');
    b2kElem.innerText = `${b2kGross >= 0 ? '+' : ''}${b2kGross.toFixed(2)}%`;
    b2kElem.className = `spread-value ${b2kGross >= 0 ? 'positive' : 'negative'}`;
    document.getElementById('b2kAbsDiff').innerText = `${b2kDiff >= 0 ? '+' : ''}$${b2kDiff.toFixed(5)}`;

    const b2kBox = document.getElementById('dirBitgetToKraken');
    if (b2kGross > 0.5) b2kBox.classList.add('opportunity'); else b2kBox.classList.remove('opportunity');

    // Kraken -> Bitget
    document.getElementById('k2bBuyPrice').innerText = `$${k2bBuy.toFixed(5)}`;
    document.getElementById('k2bSellPrice').innerText = `$${k2bSell.toFixed(5)}`;
    
    const k2bElem = document.getElementById('k2bGrossSpread');
    k2bElem.innerText = `${k2bGross >= 0 ? '+' : ''}${k2bGross.toFixed(2)}%`;
    k2bElem.className = `spread-value ${k2bGross >= 0 ? 'positive' : 'negative'}`;
    document.getElementById('k2bAbsDiff').innerText = `${k2bDiff >= 0 ? '+' : ''}$${k2bDiff.toFixed(5)}`;

    const k2bBox = document.getElementById('dirKrakenToBitget');
    if (k2bGross > 0.5) k2bBox.classList.add('opportunity'); else k2bBox.classList.remove('opportunity');
  }

  renderOrderBooks() {
    const renderRows = (containerId, rows) => {
      const tbody = document.getElementById(containerId);
      tbody.innerHTML = rows.slice(0, 10).map(([price, amount]) => `
        <tr>
          <td>$${price.toFixed(5)}</td>
          <td>${Math.round(amount)}</td>
        </tr>
      `).join('');
    };

    if (this.bitgetData) {
      renderRows('bitgetAsksBody', this.bitgetData.asks);
      renderRows('bitgetBidsBody', this.bitgetData.bids);
    }
    if (this.krakenData) {
      renderRows('krakenAsksBody', this.krakenData.asks);
      renderRows('krakenBidsBody', this.krakenData.bids);
    }
  }

  renderProfitTable(b2kGross, k2bGross, bgFee, krFee, slip, netCost) {
    const tbody = document.getElementById('netProfitTableBody');
    const tiers = [100, 500, 1000, 5000, 10000];

    // Pick best direction
    const isB2K = b2kGross >= k2bGross;
    const dirText = isB2K ? "Bitget → Kraken" : "Kraken → Bitget";
    const grossPct = isB2K ? b2kGross : k2bGross;

    tbody.innerHTML = tiers.map(amount => {
      const grossProfit = amount * (grossPct / 100);
      const totalFees = (amount * bgFee) + (amount * krFee) + (amount * slip) + netCost;
      const netProfit = grossProfit - totalFees;

      const netClass = netProfit >= 0 ? 'color: var(--green-positive); font-weight: bold;' : 'color: var(--red-negative);';

      return `
        <tr>
          <td>$${amount.toLocaleString()}</td>
          <td>${dirText}</td>
          <td>${grossProfit >= 0 ? '+' : ''}$${grossProfit.toFixed(2)}</td>
          <td style="${netClass}">${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}</td>
        </tr>
      `;
    }).join('');
  }

  // --- CHART & HISTORY MANAGEMENT ---

  initChart() {
    const ctx = document.getElementById('spreadChart').getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Bitget → Kraken Spread %',
          data: [],
          borderColor: '#0ecb81',
          borderWidth: 2,
          tension: 0.2,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: '#2b2f36' }, ticks: { color: '#848e9c' } },
          y: { grid: { color: '#2b2f36' }, ticks: { color: '#848e9c' } }
        },
        plugins: { legend: { labels: { color: '#eaecef' } } }
      }
    });
  }

  addHistoryRecord(record) {
    this.spreadHistory.unshift(record);
    if (this.spreadHistory.length > 100) this.spreadHistory.pop();

    // Chart update
    if (this.chart) {
      this.chart.data.labels.push(record.time);
      this.chart.data.datasets[0].data.push(record.grossSpread.toFixed(2));

      if (this.chart.data.labels.length > 30) {
        this.chart.data.labels.shift();
        this.chart.data.datasets[0].data.shift();
      }
      this.chart.update('none');
    }

    // Table update
    const tbody = document.getElementById('spreadHistoryTableBody');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${record.time}</td>
      <td>$${record.bgAsk.toFixed(5)}</td>
      <td>$${record.krBid.toFixed(5)}</td>
      <td style="color: ${record.grossSpread >= 0 ? 'var(--green-positive)' : 'var(--red-negative)'}">${record.grossSpread >= 0 ? '+' : ''}${record.grossSpread.toFixed(2)}%</td>
      <td style="color: ${record.netSpread >= 0 ? 'var(--green-positive)' : 'var(--red-negative)'}">${record.netSpread >= 0 ? '+' : ''}${record.netSpread.toFixed(2)}%</td>
    `;
    
    tbody.insertBefore(row, tbody.firstChild);
    if (tbody.children.length > 50) tbody.removeChild(tbody.lastChild);
  }

  updateChartTimeframe(tf) {
    console.log(`Timeframe switched to: ${tf}`);
  }

  // --- TELEGRAM ALERT SYSTEM ---

  handleCreateAlert() {
    const chatId = document.getElementById('alertChatId').value.trim();
    const dir = document.getElementById('alertDirection').value;
    const minSpread = parseFloat(document.getElementById('alertMinSpread').value) || 1.0;
    const cooldown = parseInt(document.getElementById('alertCooldown').value, 10) || 60;

    if (!chatId) {
      alert("Введіть свій Telegram Chat ID!");
      return;
    }

    const alertItem = {
      id: Date.now(),
      chatId,
      direction: dir,
      minSpread,
      cooldown,
      lastTriggered: 0,
      armed: true
    };

    this.alerts.push(alertItem);
    this.saveAlerts();
    this.renderAlertsList();
  }

  handleDeleteAlert(id) {
    this.alerts = this.alerts.filter(a => a.id !== id);
    this.saveAlerts();
    this.renderAlertsList();
  }

  renderAlertsList() {
    const container = document.getElementById('alertsContainer');
    if (this.alerts.length === 0) {
      container.innerHTML = `<small style="color: var(--text-muted)">Alerts list is empty.</small>`;
      return;
    }

    container.innerHTML = this.alerts.map((a, index) => `
      <div class="alert-item">
        <div>
          <strong>Alert #${index + 1}</strong> | Dir: ${a.direction} | Trigger: &gt; ${a.minSpread}% | Cooldown: ${a.cooldown}s
          <br><small style="color: var(--text-muted)">Last Trigger: ${a.lastTriggered ? new Date(a.lastTriggered).toLocaleTimeString() : 'Never'}</small>
        </div>
        <button class="btn-danger" onclick="app.handleDeleteAlert(${a.id})">Delete</button>
      </div>
    `).join('');
  }

  async checkAlerts(b2kSpread, k2bSpread, netSpread) {
    const now = Date.now();

    for (const alert of this.alerts) {
      let activeSpread = 0;
      let dirName = "";
      let buyEx = "";
      let sellEx = "";
      let buyPrice = 0;
      let sellPrice = 0;

      if (alert.direction === 'B2K' || (alert.direction === 'BOTH' && b2kSpread >= k2bSpread)) {
        activeSpread = b2kSpread;
        dirName = "Bitget → Kraken";
        buyEx = "Bitget"; sellEx = "Kraken";
        buyPrice = this.bitgetData.ask;
        sellPrice = this.krakenData.bid;
      } else {
        activeSpread = k2bSpread;
        dirName = "Kraken → Bitget";
        buyEx = "Kraken"; sellEx = "Bitget";
        buyPrice = this.krakenData.ask;
        sellPrice = this.bitgetData.bid;
      }

      // Re-arm trigger if spread fell below threshold
      if (activeSpread < alert.minSpread) {
        alert.armed = true;
      }

      // Check Trigger Condition with Cooldown and State Reset
      if (activeSpread >= alert.minSpread && alert.armed && (now - alert.lastTriggered > alert.cooldown * 1000)) {
        alert.lastTriggered = now;
        alert.armed = false; // Disarm until spread drops below threshold again
        this.saveAlerts();
        this.renderAlertsList();

        // Dispatch alert to backend serverless function
        await this.sendTelegramNotification(alert.chatId, {
          direction: dirName,
          buyEx,
          sellEx,
          buyPrice,
          sellPrice,
          grossSpread: activeSpread,
          netSpread
        });
      }
    }
  }

  async handleTestAlert() {
    const chatId = document.getElementById('alertChatId').value.trim();
    if (!chatId) {
      alert("Введіть Telegram Chat ID перед тестуванням!");
      return;
    }

    const testPayload = {
      direction: "Bitget → Kraken (TEST)",
      buyEx: "Bitget",
      sellEx: "Kraken",
      buyPrice: 0.1234,
      sellPrice: 0.1261,
      grossSpread: 2.19,
      netSpread: 1.47
    };

    const success = await this.sendTelegramNotification(chatId, testPayload);
    if (success) {
      alert("Тестове повідомлення успішно надіслано в Telegram!");
    } else {
      alert("Помилка відправки! Перевірте конфігурацію Serverless API та Chat ID.");
    }
  }

  async sendTelegramNotification(chatId, data) {
    try {
      const response = await fetch(CONFIG.TELEGRAM_SERVERLESS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          messageData: data
        })
      });

      return response.ok;
    } catch (err) {
      console.error("Failed to post alert to serverless function:", err);
      return false;
    }
  }
}

// Initialize Application Globals
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new SpreadMonitorApp();
});
