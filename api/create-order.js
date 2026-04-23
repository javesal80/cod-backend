// /api/create-order.js
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, GOOGLE_SHEET_URL } = process.env;

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
      body: JSON.stringify({ draft_order: { 
        line_items: orderData.line_items, 
        customer: orderData.customer, 
        shipping_address: orderData.shipping_address,
        note: orderData.note
      }})
    });
    const shopifyData = await shopifyRes.json();
    const orderId = shopifyData.draft_order.id;

    // 3. GUARDAR EN GOOGLE SHEETS (Disparar y olvidar para máxima velocidad)
    const productos = orderData.line_items.map(i => `${i.quantity}x ${i.title}`).join(", ");
    
    fetch(GOOGLE_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "ID Pedido": orderId,
        "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
        "Cliente": orderData.shipping_address.first_name,
        "Teléfono": orderData.shipping_address.phone,
        "Dirección": orderData.shipping_address.address1,
        "Ciudad": orderData.shipping_address.city,
        "Productos": productos,
        "Estado": "Pendiente"
      })
    }).catch(e => console.error("Error Sheet:", e));

    // 4. RESPUESTA AL CLIENTE
    return response.status(200).json({ success: true, orderId });

  } catch (error) {
    return response.status(500).json({ success: false });
  }
}
