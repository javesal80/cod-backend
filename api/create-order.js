// /api/create-order.js - v3.3 Blindado
export default async function handler(request, response) {
  // 1. CONFIGURACIÓN CORS (Indispensable para Shopify/Web)
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ success: false });

  const { 
    SHOPIFY_STORE_DOMAIN, 
    SHOPIFY_CLIENT_ID, 
    SHOPIFY_CLIENT_SECRET 
  } = process.env;

  console.log("--- [ORDER] Inicio de proceso de compra ---");

  try {
    // 2. OBTENER TOKEN DE SHOPIFY
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    
    if (!tokenResponse.ok) throw new Error('Error de autenticación con Shopify');
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 3. PREPARAR DATOS Y CREAR EN SHOPIFY
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

    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(shopifyPayload),
    });

    if (!shopifyRes.ok) {
      const errorBody = await shopifyRes.json();
      console.error('❌ [ORDER] Error Shopify:', errorBody);
      throw new Error('No se pudo crear el pedido');
    }

    const data = await shopifyRes.json();
    const orderId = data.draft_order.id;
    console.log("✅ [ORDER] Shopify OK, ID:", orderId);

    // 4. LLAMADA CRÍTICA AL CEREBRO
    // Usamos la URL absoluta de tu proyecto
    const host = request.headers.host;
    const cerebroURL = `https://${host}/api/cerebro-confirmar`;
    
    console.log("📡 [ORDER] Notificando al cerebro en:", cerebroURL);

    try {
      // Usamos AWAIT aquí para garantizar que Vercel no mate la función antes de avisar al cerebro
      const cerebroRes = await fetch(cerebroURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tipo: "NUEVA_COMPRA", 
          orderData: orderData 
        }),
      });

      if (cerebroRes.ok) {
        console.log("✅ [ORDER] Cerebro notificado correctamente");
      } else {
        console.error("⚠️ [ORDER] Cerebro respondió con error:", cerebroRes.status);
      }
    } catch (e) {
      console.error("❌ [ORDER] Falló la conexión con el cerebro:", e.message);
    }

    // 5. RESPUESTA FINAL AL CLIENTE (BOTÓN DE COMPRA)
    return response.status(200).json({ success: true, orderId: orderId });

  } catch (error) {
    console.error("❌ [ORDER] Error General:", error.message);
    return response.status(500).json({ success: false, message: error.message });
  }
}
