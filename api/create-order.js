// /api/create-order.js - v3.9 Completo Dinámico Corregido
export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { 
    SHOPIFY_STORE_DOMAIN, 
    SHOPIFY_CLIENT_ID, 
    SHOPIFY_CLIENT_SECRET, 
    GOOGLE_SHEET_URL 
  } = process.env;

  console.log("--- [DEBUG SHEETS] Inicio de Proceso ---");

  // --- CIRUGÍA 1: Envolver el proceso pesado en una función de fondo ---
  const tareaDeFondo = async () => {
    try {
    // 1. Obtener Token
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
    console.log("✅ [DEBUG SHEETS] Shopify OK, ID:", orderId);

    // 3. Preparar Datos para el Sheet leyendo los precios reales calculados por Shopify
    const productos = draftOrder.line_items.map(i => {
      const cantidad = i.quantity;
      const nombreProducto = i.title.toUpperCase();
      
      // Obtenemos el precio unitario real que calculó Shopify
      let precioBase = parseFloat(i.price || 0);
      
      // Multiplicamos por la cantidad del item, fijamos 2 decimales y cambiamos punto por coma
      const precioTotalFormateado = (precioBase * cantidad).toFixed(2).replace('.', '.');
      
      return `${cantidad}x ${nombreProducto} por $${precioTotalFormateado}`;
    }).join(" , "); // <--- CAMBIO CLAVE: Separamos con guion en lugar de coma para no romper los decimales

    // Extraemos el total general del borrador y le ponemos formato con coma (ej: 35,00)
    const totalBorrador = draftOrder?.total_price 
      ? parseFloat(draftOrder.total_price).toFixed(2).replace('.', '.') 
      : "";

    const sheetData = {
      "ID Pedido": String(orderId), 
      "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
      "Cliente": `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}`,
      "Teléfono": String(orderData.shipping_address.phone),
      "Dirección": orderData.shipping_address.address1,
      "Ciudad": orderData.shipping_address.city,
      "Productos": productos,
      "Estado": "Pendiente",
      "Total": totalBorrador
    };

    console.log("📡 [DEBUG SHEETS] Intentando enviar a Sheet.best...");
    console.log("📦 Payload enviado:", JSON.stringify(sheetData));

    try {
      // Forzamos el await pero con un tiempo de espera optimizado para que guarde en Sheets sí o sí
      const sheetRes = await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetData)
      });

      const sheetStatus = sheetRes.status;
      const sheetBody = await sheetRes.json();

      if (sheetRes.ok) {
        console.log("✅ [DEBUG SHEETS] Sheet.best respondió éxito (200/201):", sheetBody);
      } else {
        console.error(`❌ [DEBUG SHEETS] Sheet.best error (${sheetStatus}):`, sheetBody);
      }
    } catch (sheetErr) {
      console.error("❌ [DEBUG SHEETS] Error conectando a Sheet.best:", sheetErr.message);
    }

console.log("✅ [FONDO] Todo el flujo en segundo plano se ejecutó con éxito.");
    } catch (error) {
      console.error("❌ [FONDO] Error General en segundo plano:", error.message);
    }
  };

 // --- CIRUGÍA CORRECTIVA: Disparar en paralelo real ---
  // Ejecutamos la tarea de fondo inmediatamente sin el 'await' para que no bloquee
  tareaDeFondo();

  // Le damos un respiro minúsculo al hilo de Node antes de cortar la respuesta
  await new Promise(resolve => setTimeout(resolve, 50));

  // Enviamos la página de gracias al cliente
  response.status(200).json({ 
    success: true, 
    message: "Pedido recibido. Procesando en segundo plano." 
  });
  return;
}
