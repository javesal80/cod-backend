// /api/create-order.js (v2.3 - Sincronización Final)
export default async function handler(request, response) {
  // CORS y Seguridad (Intacto)
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { 
    SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO, TOKEN_DESPACHO 
  } = process.env;

  console.log("--- INICIO DE PROCESO ---");

  try {
    // 1. AUTH SHOPIFY
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const { access_token } = await tokenResponse.json();

    // 2. CREAR PEDIDO
    const orderData = request.body;
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
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

    const data = await shopifyResponse.json();
    console.log("✅ Pedido Shopify OK:", data.draft_order?.id);

    // 3. WHATSAPP (AQUÍ ESTÁ EL AJUSTE)
    if (INSTANCE_DESPACHO && data.draft_order) {
      const rawPhone = orderData.shipping_address.phone || orderData.customer.phone || "";
      let cleanPhone = rawPhone.replace(/\D/g, '');
      if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
      if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

      const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');
      const msg = `¡Hola! 😊 Recibimos su pedido de: *${productosStr}*. ¿Son correctos sus datos?`;

      const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
      
      console.log("📡 Intentando enviar a Evolution...");

      // Usamos AWAIT aquí para obligar a Vercel a terminar el envío antes de cerrar
      const waRes = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': apikeyFinal 
        },
        body: JSON.stringify({ 
          number: cleanPhone, 
          text: msg, 
          delay: 60000 
        })
      });

      const waData = await waRes.json();
      console.log("📡 Respuesta final Evolution:", JSON.stringify(waData));
    }

    // 4. RESPUESTA A LA WEB
    return response.status(200).json({ success: true, orderId: data.draft_order?.id });

  } catch (error) {
    console.error("❌ Error:", error.message);
    return response.status(500).json({ success: false });
  }
}
