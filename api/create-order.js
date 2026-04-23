// /api/create-order.js (v3.0 - Ultra Ligero)
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, VERCEL_URL } = process.env;

  try {
    // 1. AUTH SHOPIFY
    const tokenRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET })
    });
    const { access_token } = await tokenRes.json();

    // 2. CREAR PEDIDO
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

    // 3. LLAMAR AL CEREBRO (Sin esperar respuesta, velocidad máxima)
    // El cerebro recibirá los datos y él decidirá cuándo y qué enviar.
    fetch(`https://${VERCEL_URL}/api/cerebro-confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tipo: "NUEVA_COMPRA", // Le avisamos que es un inicio
        orderData: orderData 
      })
    }).catch(e => console.log("Error llamando al cerebro"));

    return response.status(200).json({ success: true, orderId: data.draft_order?.id });

  } catch (error) {
    return response.status(500).json({ success: false });
  }
}
