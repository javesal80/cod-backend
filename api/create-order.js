// Este es el archivo: /api/create-order.js (v1.5 - La versión correcta)

export default async function handler(request, response) {
  // 1. Configuración de Seguridad (CORS)
  response.setHeader('Access-Control-Allow-Origin', `https://${request.headers.origin.split('//')[1]}`);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 2. Leer las Claves Secretas
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN } = process.env;

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    return response.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  // 3. Preparar la llamada a la API
  const adminApiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`;
  const orderData = request.body; // Esto viene del front-end v2.2

  // Formatear el payload final
  const shopifyPayload = {
    draft_order: {
      line_items: orderData.line_items,
      
      // --- ESTA ES LA CORRECCIÓN v1.5 ---
      // El front-end v2.2 ya envía 'customer' y 'shipping_address' 
      // con first_name y last_name. Ahora el backend los pasará ambos.
      customer: orderData.customer,
      shipping_address: orderData.shipping_address,
      billing_address: orderData.shipping_address, 
      // --- FIN DE LA CORRECCIÓN ---

      note: orderData.note,
      use_customer_default_address: false
    }
  };

  try {
    // 4. Llamar a la API de Admin de Shopify
    const shopifyResponse = await fetch(adminApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify(shopifyPayload),
    });

    if (!shopifyResponse.ok) {
      const errorBody = await shopifyResponse.json();
      console.error('Shopify API Error:', errorBody);
      throw new Error('Failed to create draft order.');
    }

    const data = await shopifyResponse.json();

    // 5. Enviar respuesta de ÉXITO al front-end
    return response.status(200).json({ success: true, orderId: data.draft_order.id });

  } catch (error) {
    console.error(error);
    // 6. Enviar respuesta de ERROR al front-end
    return response.status(500).json({ success: false, message: error.message });
  }
}
