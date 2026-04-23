// /api/create-order.js (v2.4 - Velocidad Rayo + WhatsApp en Segundo Plano)
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { 
    SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO, TOKEN_DESPACHO 
  } = process.env;

  try {
    // 1. AUTH SHOPIFY (Rápido)
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const { access_token } = await tokenResponse.json();

    // 2. CREAR PEDIDO (Lo que el cliente espera)
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
    const orderId = data.draft_order?.id;

    // --- EL TRUCO DE VELOCIDAD ---
    // 3. RESPONDEMOS INMEDIATAMENTE AL CLIENTE
    // Esto libera el botón de compra en la web al instante.
    response.status(200).json({ success: true, orderId });

    // 4. PROCESO POST-RESPUESTA (WhatsApp en "segundo plano")
    // Al no usar 'return' antes de esto, el código sigue ejecutándose unos milisegundos más
    if (INSTANCE_DESPACHO && orderId) {
      const rawPhone = orderData.shipping_address.phone || orderData.customer.phone || "";
      let cleanPhone = rawPhone.replace(/\D/g, '');
      if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
      if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

      const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');
      const msg = `¡Hola! 😊 Recibimos su pedido de: *${productosStr}*. ¿Son correctos sus datos?`;

      // Disparamos el fetch pero NO lo esperamos con await para no bloquear
      // Usamos el .then solo para dejar constancia en logs si quieres
      fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': TOKEN_DESPACHO || EVOLUTION_TOKEN },
        body: JSON.stringify({ number: cleanPhone, text: msg, delay: 100 })
      }).catch(err => console.error("Error post-envío:", err.message));
    }

  } catch (error) {
    // Si hay error antes de responder, mandamos el 500
    if (!response.writableEnded) {
      return response.status(500).json({ success: false });
    }
  }
}
