// /api/create-order.js - Script 1: Creador de Borradores Rápido
module.exports = async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { 
    SHOPIFY_STORE_DOMAIN, 
    SHOPIFY_CLIENT_ID, 
    SHOPIFY_CLIENT_SECRET
  } = process.env;

  console.log("--- [SCRIPT 1] Iniciando Creación de Borrador ---");

  try {
    // 1. Obtener Token de Shopify
    const tokenRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });
    const { access_token } = await tokenRes.json();

    // 2. Crear Pedido en Shopify (Draft Order)
    const orderData = request.body;
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/draft_orders.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access_token },
      body: JSON.stringify({
        draft_order: {
          line_items: orderData.line_items,
          customer: orderData.customer,
          shipping_address: orderData.shipping_address,
          billing_address: orderData.shipping_address, 
          note: orderData.note,
          use_customer_default_address: false
        }
      }),
    });

    const data = await shopifyRes.json();
    const draftOrder = data.draft_order;
    const orderId = draftOrder?.id;
    console.log("✅ Shopify OK, ID:", orderId);

   // 3. Cálculo matemático manual adaptado a COD (Suma directa sin multiplicar)
    let sumaTotalBorrador = 0;

    const productos = draftOrder.line_items.map(i => {
      // Tomamos el precio fijo de la línea exactamente como viene de Shopify
      const precioFijo = parseFloat(i.price || 0); 
      
      // Lo sumamos a la alcancía sin multiplicar por cantidad
      sumaTotalBorrador += precioFijo; 
      
      // Dejamos el texto visual intacto para el mensaje
      return `${i.quantity}x ${i.title.toUpperCase()} ($${precioFijo.toFixed(2).replace('.', ',')})`;
    }).join(" y ");

    // Guardamos el total forzado, asegurando 2 decimales
    const totalBorrador = sumaTotalBorrador.toFixed(2).replace('.', ',');

 // 4. DISPARAR SCRIPT 2 EN PARALELO (Asegurando la salida antes del cierre)
    const llamadaScript2 = fetch(`https://${request.headers.host}/api/process-sheets-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: String(orderId),
        totalBorrador: totalBorrador,
        productos: productos,
        orderData: orderData
      })
    }).catch(err => console.error("Error en segundo plano ejecutando Script 2:", err.message));

    // Si Vercel tiene habilitado el manejador de fondo, le ordenamos mantenerlo vivo
    if (request.waitUntil) {
      request.waitUntil(llamadaScript2);
    } else {
      // Si no, le damos 60 milisegundos para que el paquete salga a la red antes de responder
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    // 5. RESPUESTA ULTRA RÁPIDA: El cliente avanza a la página de gracias
    return response.status(200).json({ success: true, orderId: orderId });

  } catch (error) {
    console.error("❌ Error General en Script 1:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
};
