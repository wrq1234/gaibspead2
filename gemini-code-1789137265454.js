/**
 * Serverless Telegram Proxy Endpoint
 * Deployable to Vercel Functions / Node.js Runtime
 */

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get Secrets from Environment Variable
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN environment variable is missing on server!' });
  }

  const { chatId, messageData } = req.body || {};

  if (!chatId || !messageData) {
    return res.status(400).json({ error: 'Missing chatId or messageData payload' });
  }

  const { direction, buyEx, sellEx, buyPrice, sellPrice, grossSpread, netSpread } = messageData;

  const textMessage = `🚨 *GAIB ARBITRAGE ALERT*

🟢 *${direction}*
*Buy:*
${buyEx} $${Number(buyPrice).toFixed(4)}
*Sell:*
${sellEx} $${Number(sellPrice).toFixed(4)}

*Gross Spread:*
+${Number(grossSpread).toFixed(2)}%
*Estimated Net:*
+${Number(netSpread).toFixed(2)}%

⏰ *Time:* ${new Date().toISOString().substring(11, 19)} UTC
_GAIB Spread Monitor_`;

  try {
    const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const tgRes = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: textMessage,
        parse_mode: 'Markdown'
      })
    });

    const tgJson = await tgRes.json();

    if (!tgRes.ok || !tgJson.ok) {
      return res.status(500).json({ error: 'Telegram API response error', details: tgJson });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error sending Telegram alert', details: err.message });
  }
}