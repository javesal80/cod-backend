// /api/create-order.js (v2.0 - Respuesta Inmediata + WhatsApp en Background)
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

  let accessToken;
  try {
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.access_token;
  } catch (error) {
    return response.status(500).json({ success: false, message: 'Auth Error' });
  }

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
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify(shopifyPayload),
    });

    if (!shopifyResponse.ok) {
      const errorBody = await shopifyResponse.json();
      return response.status(500).json({ success: false, error: errorBody });
    }

    const data = await shopifyResponse.json();

    // --- AQUÍ ESTÁ EL TRUCO: RESPONDEMOS A LA WEB PRIMERO ---
    // Esto libera el botón de compra inmediatamente.
    response.status(200).json({ success: true, orderId: data.draft_order.id });

    // --- DESPUÉS ENVIAMOS EL WHATSAPP (Vercel permite unos segundos más) ---
    if (INSTANCE_DESPACHO) {
      try {
        const rawPhone = orderData.shipping_address.phone || orderData.customer.phone;
        let cleanPhone = rawPhone.replace(/\D/g, '');
        
        // Formateo de número indispensable (Lo que le faltaba al 1.9)
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const fechaEcuador = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
        const horaActual = fechaEcuador.getHours();
        let saludo = "Buenos días";
        if (horaActual >= 12 && horaActual < 18) saludo = "Buenas tardes";
        if (horaActual >= 18 || horaActual < 5) saludo = "Buenas noches";

        const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');

        const msgDisparador = `${saludo}. 😊 Qué gusto saludarle de parte de *JRJMarket*. 

He recibido su pedido de: *${productosStr}*. 

Para asegurar que todo llegue perfecto, ¿podría confirmarme si sus datos de envío son correctos?
📍 *Dirección:* ${orderData.shipping_address.address1}
🏘️ *Ciudad:* ${orderData.shipping_address.city}

¿Está todo bien o prefiere que ajustemos algún detalle?`;

        // El fetch se ejecuta pero ya no bloquea la respuesta de Shopify
        fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': TOKEN_DESPACHO || EVOLUTION_TOKEN },
          body: JSON.stringify({ 
            number: cleanPhone, 
            text: msgDisparador, 
            delay: 60000 
          })
        }).catch(e => console.log("Error background WA"));

      } catch (e) {
        console.log("Error preparando datos WA");
      }
    }

  } catch (error) {
    if (!response.writableEnded) {
        return response.status(500).json({ success: false, message: error.message });
    }
  }
}
