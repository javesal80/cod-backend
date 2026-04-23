// /api/create-order.js (v1.8 - Estructura original intacta)
export default async function handler(request, response) {
  // --- SEGURIDAD CORS (INTACTO) ---
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ success: false });

  // --- VARIABLES (INTACTO) ---
  const { 
    SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO, TOKEN_DESPACHO 
  } = process.env;

  // --- AUTH SHOPIFY (INTACTO) ---
  let accessToken;
  try {
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.access_token;
  } catch (error) { return response.status(500).json({ success: false }); }

  // --- DATOS PARA SHOPIFY (INTACTO) ---
  const orderData = request.body;
  const shopifyPayload = {
    draft_order: {
      line_items: orderData.line_items,
      customer: orderData.customer,
      shipping_address: orderData.shipping_address,
      billing_address: orderData.shipping_address, 
      note: orderData.note,
      use_customer_default_address: false
    }
  };

  try {
    // --- CREAR PEDIDO (INTACTO) ---
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify(shopifyPayload),
    });

    const data = await shopifyResponse.json();

    // --- ÚNICA MODIFICACIÓN: ENVÍO WHATSAPP DISPARADOR ---
    if (EVOLUTION_URL && INSTANCE_DESPACHO) {
      try {
        const rawPhone = orderData.shipping_address.phone || orderData.customer.phone;
        let cleanPhone = rawPhone.replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title || 'Producto'}`).join(', ');

        const msgApertura = `¡Hola! 😊 Qué gusto saludarle de parte de *JRJMarket*. 

He recibido su pedido de: *${productosStr}*. 

Para asegurar que todo llegue perfecto, ¿podría confirmarme si sus datos de envío son correctos?
📍 *Dirección:* ${orderData.shipping_address.address1}
🏘️ *Ciudad:* ${orderData.shipping_address.city}

¿Está todo bien o prefiere que ajustemos algún detalle?`;

        // Envío con delay para que la IA cerebro-confirmar tome el control después
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': TOKEN_DESPACHO || EVOLUTION_TOKEN },
          body: JSON.stringify({ 
            number: cleanPhone, 
            text: msgApertura,
            delay: 60000 
          })
        });
      } catch (waError) { console.error('Error WA'); }
    }

    return response.status(200).json({ success: true, orderId: data.draft_order.id });

  } catch (error) { return response.status(500).json({ success: false }); }
}
