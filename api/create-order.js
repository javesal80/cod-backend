// /api/create-order.js (v2.2 - Data Inspector)
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();
  
  // --- PASO 1: INSPECCIÓN DE DATA (MIRA ESTO EN VERCEL LOGS) ---
  const orderData = request.body;
  console.log("=== INSPECCIÓN DE DATA RECIBIDA ===");
  console.log("DATOS DEL CLIENTE:", JSON.stringify(orderData.customer, null, 2));
  console.log("DIRECCIÓN DE ENVÍO:", JSON.stringify(orderData.shipping_address, null, 2));
  console.log("PRODUCTOS RECIBIDOS (Line Items):", JSON.stringify(orderData.line_items, null, 2));
  console.log("CANTIDAD DE PRODUCTOS DETECTADOS:", orderData.line_items?.length || 0);
  console.log("===================================");

  const { 
    SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO, TOKEN_DESPACHO 
  } = process.env;

  // Autenticación Shopify
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
  } catch (e) { console.error("Error Auth Shopify:", e); }

  try {
    // Crear en Shopify
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ draft_order: { ...orderData, use_customer_default_address: false } }),
    });
    const data = await shopifyResponse.json();

    // --- LOGICA DE WHATSAPP CON LIMPIEZA TOTAL ---
    let rawPhone = orderData.shipping_address?.phone || orderData.customer?.phone || "";
    // Limpiamos absolutamente todo (espacios, +, -, letras)
    const cleanPhone = rawPhone.replace(/\D/g, ''); 

    console.log("Teléfono extraído:", rawPhone);
    console.log("Teléfono limpio para enviar:", cleanPhone);

    if (EVOLUTION_URL && INSTANCE_DESPACHO && cleanPhone) {
      const fechaEcuador = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
      const hora = fechaEcuador.getHours();
      let saludo = hora < 12 ? "Buenos días" : (hora < 18 ? "Buenas tardes" : "Buenas noches");

      // Verificamos si productosStr coge todos los items
      const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');

      const msg1 = `${saludo}. Nos comunicamos por confirmar el siguiente pedido:\n\n*${productosStr}*\n\nPara:\n*${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}*\nCELULAR: ${cleanPhone}\n${orderData.shipping_address.address1}\n${orderData.shipping_address.province}_${orderData.shipping_address.city}`;
      const msg2 = `Listo, le estaría llegando entre mañana o pasado, en horario de 9am a 5pm. El pedido va por transportadoras conocidas (Servientrega, Gintracon o Laar).\n\nPor favor, ayúdenos con una referencia exacta.`;

      const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
      const urlWA = `${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`;

      const resWA = await fetch(urlWA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
        body: JSON.stringify({ number: cleanPhone, text: msg1 })
      });
      
      console.log("Respuesta de Evolution API (Status):", resWA.status);

      await new Promise(r => setTimeout(r, 2000));
      await fetch(urlWA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
        body: JSON.stringify({ number: cleanPhone, text: msg2 })
      });
    }

    return response.status(200).json({ success: true });
  } catch (error) {
    console.error('Error Crítico:', error);
    return response.status(500).json({ success: false });
  }
}
