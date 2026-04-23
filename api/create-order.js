// /api/create-order.js (v3.1 - Con Logs de Salto)
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, VERCEL_URL } = process.env;
  console.log("--- [ORDER] Inicio de compra ---");

  try {
    const tokenRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET })
    });
    const { access_token } = await tokenRes.json();

    const orderData = request.body;
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access_token },
      body: JSON.stringify({
        draft_order: {
          line_items: orderData.line_items,
          customer: orderData.customer,
          shipping_address: orderData.shipping_address,
          billing_address: orderData.shipping_address, 
          note: orderData.note,
          use_customer_default_address: false
        }
      })
    });
    const data = await shopifyRes.json();
    console.log("✅ [ORDER] Shopify OK:", data.draft_order?.id);

    // DETERMINAR URL DEL CEREBRO
    // Si VERCEL_URL no está en las variables, usamos la del header o una fija
    const host = request.headers.host;
    const cerebroURL = `https://${host}/api/cerebro-confirmar`;
    
    console.log("📡 [ORDER] Intentando llamar al cerebro en:", cerebroURL);

    // Llamada al cerebro con timeout y logs
    fetch(cerebroURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: "NUEVA_COMPRA", orderData: orderData })
    })
    .then(r => console.log("✅ [ORDER] Respuesta del cerebro recibida (Status):", r.status))
    .catch(e => console.error("❌ [ORDER] Error llamando al cerebro:", e.message));

    return response.status(200).json({ success: true, orderId: data.draft_order?.id });

  } catch (error) {
    console.error("❌ [ORDER] Error General:", error.message);
    return response.status(500).json({ success: false });
  }
}
