// Este es el archivo: /api/create-order.js

// Esta función se encarga de todo.
export default async function handler(request, response) {
  // 1. Configuración de Seguridad (CORS)
  // Permite que tu tienda Shopify hable con esta función
  response.setHeader('Access-Control-Allow-Origin', `https://${request.headers.origin.split('//')[1]}`);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Manejar solicitudes 'pre-flight' de CORS
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // Solo permitir solicitudes POST
  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // 2. Leer las Claves Secretas (las configuraremos en Vercel)
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN } = process.env;

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    return response.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  // 3. Preparar la llamada a la API de Shopify
  const adminApiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`;
  
  // Recibir los datos del formulario (line_items, customer, etc.)
  const orderData = request.body;

  // Formatear el payload final para la API de Draft Orders
  // El 'request.body' que enviamos desde el front-end ya casi tiene este formato.
  const shopifyPayload = {
    draft_order: {
      line_items: orderData.line_items,
      customer: {
        first_name: orderData.shipping_address.name, // Shopify prefiere el nombre aquí
        phone: orderData.shipping_address.phone
      },
      shipping_address: orderData.shipping_address,
      note: orderData.note,
      // Importante: Usar un 'custom_sale' si no quieres que el precio se calcule
      // basado en los productos, sino en el total que ya calculamos.
      // Para este caso, dejaremos que Shopify lo calcule basado en las variantes.
      use_customer_default_address: false
    }
  };

  try {
    // 4. Llamar a la API de Admin de Shopify de forma segura
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