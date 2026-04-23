// /api/create-order.js
export default async function handler(request, response) {
  // 1. Manejo de CORS (Para que Shopify y tu Web puedan hablar con Vercel)
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ success: false });

  const { 
    SHOPIFY_STORE_DOMAIN, 
    SHOPIFY_CLIENT_ID, 
    SHOPIFY_CLIENT_SECRET, 
    GOOGLE_SHEET_URL // Esta es la URL que te dio Sheet.best
  } = process.env;

  console.log("--- [INICIO] Procesando compra ---");

  try {
    // 1. Obtener Token de Shopify
    const tokenRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const { access_token } = await tokenRes.json();

    // 2. Crear el Borrador de Pedido en Shopify
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
    console.log("✅ Shopify OK. ID:", orderId);

    // 3. Guardar en Google Sheets (Disparar y Olvidar)
    // No usamos 'await' aquí para que el botón de compra responda de inmediato
    const productos = orderData.line_items.map(i => `${i.quantity}x ${i.title}`).join(", ");
    
    fetch(GOOGLE_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "ID Pedido": orderId,
        "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
        "Cliente": `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}`,
        "Teléfono": orderData.shipping_address.phone,
        "Dirección": orderData.shipping_address.address1,
        "Ciudad": orderData.shipping_address.city,
        "Productos": productos,
        "Estado": "Pendiente"
      })
    })
    .then(() => console.log("✅ Fila insertada en Google Sheets"))
    .catch(e => console.error("❌ Error al insertar en Sheet:", e.message));

    // 4. Respuesta instantánea para liberar el botón de compra
    return response.status(200).json({ success: true, orderId: orderId });

  } catch (error) {
    console.error("❌ Error General:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
}
