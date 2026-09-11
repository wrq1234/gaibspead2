/**
 * GAIB Spread Monitor Configuration
 */
const CONFIG = {
  // Exchange API Endpoints
  BITGET: {
    NAME: 'Bitget Spot',
    PAIR: 'GAIBUSDT',
    DISPLAY_PAIR: 'GAIB/USDT',
    TICKER_URL: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=GAIBUSDT',
    ORDERBOOK_URL: 'https://api.bitget.com/api/v2/spot/market/orderbook?symbol=GAIBUSDT&type=step0&limit=10',
    TRADE_URL: 'https://www.bitget.com/spot/GAIBUSDT'
  },
  KRAKEN: {
    NAME: 'Kraken Spot',
    PAIR: 'GAIBUSD', // fallback to GAIBUSDT or Synthetic if not available
    DISPLAY_PAIR: 'GAIB/USD',
    TICKER_URL: 'https://api.kraken.com/0/public/Ticker?pair=GAIBUSD',
    ORDERBOOK_URL: 'https://api.kraken.com/0/public/Depth?pair=GAIBUSD&count=10',
    FX_URL: 'https://api.kraken.com/0/public/Ticker?pair=USDTUSD',
    TRADE_URL: 'https://www.kraken.com/prices/gaib'
  },
  
  // Default Application Settings
  DEFAULTS: {
    refreshIntervalMs: 2000,   // Polling rate 2s to avoid rate-limits
    staleThresholdSec: 10,     // Data stale warning after 10s
    bitgetFee: 0.1,            // 0.10% spot fee
    krakenFee: 0.25,           // 0.25% spot fee
    slippage: 0.05,            // 0.05% slippage estimation
    networkCostUsd: 1.5,       // Withdrawal fee in USD
    tradeSizeUsd: 100,         // Default trade size
    minSpreadAlert: 1.0,       // Minimum spread % for alert trigger
    alertCooldownSec: 60,      // Anti-spam cooldown
    theme: 'dark'
  },

  // Telegram Alert Serverless Endpoint URL
  // Замініть на ваш Vercel / Cloudflare Workers URL після деплою backend частини
  TELEGRAM_SERVERLESS_URL: '/api/telegram'
};

// Freeze object to prevent modifications
Object.freeze(CONFIG);