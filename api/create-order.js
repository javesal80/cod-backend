// /api/create-order.js (v1.8 - JRJMarket Master Integration)
export default async function handler(request, response) {
  // 1. CONFIGURACIÓN DE SEGURIDAD (CORS)
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

  // 2. LEER VARIABLES DE ENTORNO
  const { 
    SHOPIFY_STORE_DOMAIN, 
    SHOPIFY_CLIENT_ID, 
    SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, 
    EVOLUTION_TOKEN, 
    INSTANCE_DESPACHO, 
    TOKEN_DESPACHO 
  } = process.env;

  // 3. OBTENER TOKEN DE SHOPIFY
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

  // 4. PREPARAR DATOS PARA SHOPIFY
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
    // 5. CREAR PEDIDO EN SHOPIFY
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

    // --- 6. ENVÍO DE WHATSAPP (Siembre de contexto para la IA) ---
    if (EVOLUTION_URL && INSTANCE_DESPACHO) {
      try {
        const rawPhone = orderData.shipping_address.phone || orderData.customer.phone;
        let cleanPhone = rawPhone.replace(/\D/g, '');
        
        // Corrección de prefijo Ecuador
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const fechaEcuador = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
        const horaActual = fechaEcuador.getHours();
        let saludo = horaActual < 12 ? "Buenos días" : (horaActual < 18 ? "Buenas tardes" : "Buenas noches");

        const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title || 'Producto'}`).join(', ');

        const msgApertura = `¡${saludo}! 😊 Qué gusto saludarle de parte de *JRJMarket*. 

He recibido su pedido de: *${productosStr}*. 

Para asegurar que todo llegue perfecto, ¿podría confirmarme si sus datos de envío son correctos?
📍 *Dirección:* ${orderData.shipping_address.address1}
🏘️ *Ciudad:* ${orderData.shipping_address.city}

¿Está todo bien o prefiere que ajustemos algún detalle?`;

        // Esperar 1 minuto (60000 ms) antes de enviar para no saturar y dar espacio a Shopify
        setTimeout(async () => {
          await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              'apikey': TOKEN_DESPACHO || EVOLUTION_TOKEN 
            },
            body: JSON.stringify({ number: cleanPhone, text: msgApertura })
          });
        }, 60000); 

      } catch (waError) {
        console.error('Error en proceso de WhatsApp:', waError);
      }
    }

    // 7. RESPUESTA FINAL
    return response.status(200).json({ success: true, orderId: data.draft_order.id });

  } catch (error) {
    console.error('Error General:', error);
    return response.status(500).json({ success: false, message: error.message });
  }
}
