// Este es el archivo: /api/create-order.js (v1.6 - Auto-renovación de token)
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
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    return response.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  // 3. Obtener token fresco automáticamente
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
    if (!tokenResponse.ok) throw new Error('Failed to get access token');
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.access_token;
  } catch (error) {
    return response.status(500).json({ success: false, message: 'Auth error: ' + error.message });
  }

  // 4. Preparar la llamada a la API
  const adminApiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`;
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
    // 5. Llamar a la API de Admin de Shopify
    const shopifyResponse = await fetch(adminApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(shopifyPayload),
    });
    if (!shopifyResponse.ok) {
      const errorBody = await shopifyResponse.json();
      console.error('Shopify API Error:', errorBody);
      throw new Error('Failed to create draft order.');
    }
    const data = await shopifyResponse.json();
    return response.status(200).json({ success: true, orderId: data.draft_order.id });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ success: false, message: error.message });
  }
}
