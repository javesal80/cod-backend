export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ success: false });

  const { 
    SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO, TOKEN_DESPACHO 
  } = process.env;

  const orderData = request.body;

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

    // 2. Crear el Borrador en Shopify
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

    if (!shopifyResponse.ok) throw new Error('Error en Shopify');
    const data = await shopifyResponse.json();

    // 3. LOGICA DE WHATSAPP (Formateo Crítico)
    const rawPhone = orderData.shipping_address?.phone || orderData.customer?.phone || "";
    let cleanPhone = rawPhone.replace(/\D/g, '');
    
    // IMPORTANTE: Aseguramos el 593 para Ecuador
    if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
    if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

    const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');
    const msgDisparador = `¡Hola! 😊 Qué gusto saludarle de parte de *JRJMarket*. 

He recibido su pedido de: *${productosStr}*. 

Para asegurar que todo llegue perfecto, ¿podría confirmarme si sus datos de envío son correctos?
📍 *Dirección:* ${orderData.shipping_address.address1}
🏘️ *Ciudad:* ${orderData.shipping_address.city}

¿Está todo bien o prefiere que ajustemos algún detalle?`;

    // 4. ENVÍO DE MENSAJE (Sin await para no bloquear la respuesta de la web)
    // Pero lo ponemos antes de la respuesta para que Vercel alcance a enviarlo
    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    
    fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
      body: JSON.stringify({ 
        number: cleanPhone, 
        text: msgDisparador, 
        delay: 60000 
      })
    }).catch(e => console.log("WA Error:", e));

    // 5. RESPUESTA INMEDIATA A LA WEB
    return response.status(200).json({ success: true, orderId: data.draft_order.id });

  } catch (error) {
    console.error("Error General:", error);
    return response.status(500).json({ success: false, message: error.message });
  }
}
