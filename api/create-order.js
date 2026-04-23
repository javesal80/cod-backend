// /api/create-order.js - v3.5 Disparar y Olvidar
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ success: false });

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;

  try {
    // 1. OBTENER TOKEN (Rápido)
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const { access_token } = await tokenResponse.json();

    // 2. CREAR EN SHOPIFY (Prioridad absoluta)
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
      }),
    });

    const data = await shopifyRes.json();
    const orderId = data.draft_order?.id;

    // 3. EL "DISPARO" AL CEREBRO (Sin AWAIT)
    // Al quitar el await, el código NO espera respuesta. Envía la señal y sigue.
    const host = request.headers.host;
    fetch(`https://${host}/api/cerebro-confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: "NUEVA_COMPRA", orderData: orderData }),
    }).catch(e => console.log("Cerebro offline o lento, no importa."));

    // 4. RESPUESTA INMEDIATA AL CLIENTE
    // Esto se ejecuta milisegundos después de que Shopify responda.
    return response.status(200).json({ success: true, orderId: orderId });

  } catch (error) {
    console.error("❌ Error:", error.message);
    return response.status(500).json({ success: false });
  }
}
