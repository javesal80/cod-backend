// /api/create-order.js (v2.3 - Fixed Phone Format & Products)
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { 
    SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO, TOKEN_DESPACHO 
  } = process.env;

  const orderData = request.body;

  // --- 1. FORMATEO DE TELÉFONO (PARA EVITAR EL ERROR 400) ---
  let rawPhone = orderData.shipping_address?.phone || orderData.customer?.phone || "";
  let cleanPhone = rawPhone.replace(/\D/g, ''); // Quitamos todo lo que no sea número

  // Si empieza con 09 (10 dígitos), quitamos el 0 y ponemos 593
  if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) {
    cleanPhone = '593' + cleanPhone.substring(1);
  } 
  // Si empieza con 9 (9 dígitos), solo ponemos 593
  else if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
    cleanPhone = '593' + cleanPhone;
  }

  console.log("Teléfono procesado para WhatsApp:", cleanPhone);

  // --- 2. OBTENER ACCESO A SHOPIFY ---
  let accessToken;
  try {
    const tokenResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET
      }),
    });
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.access_token;
  } catch (e) { console.error("Error Shopify Auth"); }

  try {
    // --- 3. CREAR PEDIDO EN SHOPIFY ---
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ draft_order: { ...orderData, use_customer_default_address: false } }),
    });
    const data = await shopifyResponse.json();

    // --- 4. ENVÍO DE WHATSAPP (INSTANCIA DESPACHO) ---
    if (INSTANCE_DESPACHO && cleanPhone.startsWith('593')) {
      const fecha = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
      const hora = fecha.getHours();
      let saludo = "Buenos días";
      if (hora >= 12 && hora < 18) saludo = "Buenas tardes";
      if (hora >= 18 || hora < 5) saludo = "Buenas noches";

      // Nota: Si la web no manda títulos, usamos un genérico basado en la cantidad
      const totalItems = orderData.line_items.reduce((acc, item) => acc + item.quantity, 0);
      const msg1 = `${saludo}. Nos comunicamos por confirmar el siguiente pedido:\n\n*${totalItems} Producto(s) JRJMarket*\n\nPara:\n*${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}*\nCELULAR: ${cleanPhone}\n${orderData.shipping_address.address1}\n${orderData.shipping_address.province}_${orderData.shipping_address.city}\n\n¿Es correcto?`;

      const msg2 = `Listo, procedemos al despacho. Su pedido llegará entre mañana o pasado por Servientrega, Laar o Gintracon. 🚚\n\nEl horario es de 9am a 5pm, por favor ayúdenos con una referencia exacta de su domicilio. ¡Gracias!`;

      const key = TOKEN_DESPACHO || EVOLUTION_TOKEN;
      const urlWA = `${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`;

      // Primer mensaje
      const res1 = await fetch(urlWA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key },
        body: JSON.stringify({ number: cleanPhone, text: msg1 })
      });
      console.log("Respuesta WA 1:", res1.status);

      if (res1.status <= 201) {
        await new Promise(r => setTimeout(r, 2000));
        await fetch(urlWA, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': key },
          body: JSON.stringify({ number: cleanPhone, text: msg2 })
        });
      }
    }

    return response.status(200).json({ success: true });
  } catch (error) {
    console.error("Error crítico:", error);
    return response.status(500).json({ success: false });
  }
}
