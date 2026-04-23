// /api/create-order.js (v2.2 - Debug Mode Activo)
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

  console.log("--- INICIO DE PROCESO ---");

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
    console.log("✅ Token de Shopify obtenido");
  } catch (error) {
    console.error("❌ Error en Auth Shopify:", error.message);
    return response.status(500).json({ success: false });
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

    const data = await shopifyResponse.json();
    console.log("✅ Pedido creado en Shopify:", data.draft_order?.id);

    // --- SECCIÓN DE WHATSAPP CON LOGS ---
    if (INSTANCE_DESPACHO && data.draft_order) {
      const rawPhone = orderData.shipping_address.phone || orderData.customer.phone || "";
      let cleanPhone = rawPhone.replace(/\D/g, '');
      
      // LOG DE NÚMERO
      console.log("📱 Teléfono Original:", rawPhone);
      
      if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
      if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;
      
      console.log("📱 Teléfono Formateado:", cleanPhone);

      const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');
      const msg = `¡Hola! 😊 Recibimos su pedido de: *${productosStr}*. ¿Son correctos sus datos?`;

      const targetURL = `${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`;
      const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;

      console.log("🔗 Enviando a URL:", targetURL);
      
      // Enviamos el fetch sin el 'await' para que no bloquee el botón de compra, 
      // pero capturamos el resultado en los logs.
      fetch(targetURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
        body: JSON.stringify({ number: cleanPhone, text: msg, delay: 60000 })
      })
      .then(async (res) => {
        const resData = await res.json();
        console.log("📡 Respuesta de Evolution API:", JSON.stringify(resData));
      })
      .catch((err) => {
        console.error("❌ Error en el fetch de WhatsApp:", err.message);
      });
    }

    // RESPUESTA INMEDIATA PARA LIBERAR EL BOTÓN
    return response.status(200).json({ success: true, orderId: data.draft_order?.id });

  } catch (error) {
    console.error("❌ Error General en el Handler:", error.message);
    return response.status(500).json({ success: false });
  }
}
