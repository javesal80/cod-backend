// /api/create-order.js (v1.9 - JRJMarket Split Instances Integration)
export default async function handler(request, response) {
  // 1. CONFIGURACIÓN DE SEGURIDAD (CORS) - INTACTO
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }
  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 2. LEER VARIABLES DE ENTORNO - INTACTO
  const { 
    SHOPIFY_STORE_DOMAIN, 
    SHOPIFY_CLIENT_ID, 
    SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, 
    EVOLUTION_TOKEN, 
    INSTANCE_DESPACHO, 
    TOKEN_DESPACHO 
  } = process.env;

  // 3. OBTENER TOKEN DE SHOPIFY - INTACTO
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
    if (!tokenResponse.ok) throw new Error('Falló la autenticación con Shopify');
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.access_token;
  } catch (error) {
    return response.status(500).json({ success: false, message: 'Auth error: ' + error.message });
  }

  // 4. PREPARAR DATOS PARA SHOPIFY - INTACTO
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
    // 5. CREAR PEDIDO EN SHOPIFY - INTACTO
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(shopifyPayload),
    });

    if (!shopifyResponse.ok) {
      const errorBody = await shopifyResponse.json();
      console.error('Shopify Error:', errorBody);
      throw new Error('Error al crear el pedido en Shopify');
    }

    const data = await shopifyResponse.json();

    // --- 6. LÓGICA DE WHATSAPP JRJMARKET (MODIFICADO PARA CEREBRO IA) ---
    if (EVOLUTION_URL && INSTANCE_DESPACHO) {
      try {
        const rawPhone = orderData.shipping_address.phone || orderData.customer.phone;
        const cleanPhone = rawPhone.replace(/\D/g, '');
        
        const fechaEcuador = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
        const horaActual = fechaEcuador.getHours();
        let saludo = "Buenos días";
        if (horaActual >= 12 && horaActual < 18) saludo = "Buenas tardes";
        if (horaActual >= 18 || horaActual < 5) saludo = "Buenas noches";

        const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');

        // MENSAJE DE APERTURA: Semilla para el cerebro de IA
        const msgDisparador = `¡${saludo}! 😊 Qué gusto saludarle de parte de *JRJMarket*. 

He recibido su pedido de: *${productosStr}*. 

Para asegurar que todo llegue perfecto, ¿podría confirmarme si sus datos de envío son correctos?
📍 *Dirección:* ${orderData.shipping_address.address1}
🏘️ *Ciudad:* ${orderData.shipping_address.city}

¿Está todo bien o prefiere que ajustemos algún detalle?`;

        // Función para enviar a Evolution API (Solo un envío con delay de 1 min para ser humano)
        const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
          body: JSON.stringify({ 
            number: cleanPhone, 
            text: msgDisparador, 
            delay: 60000 // 1 minuto de espera gestionado por la API
          })
        });
        
      } catch (waError) {
        console.error('Error enviando WhatsApp:', waError);
      }
    }

    return response.status(200).json({ success: true, orderId: data.draft_order.id });

  } catch (error) {
    console.error('Error General:', error);
    return response.status(500).json({ success: false, message: error.message });
  }
}
