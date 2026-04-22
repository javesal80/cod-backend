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
    INSTANCE_NAME 
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

    // --- 6. LÓGICA DE WHATSAPP JRJMARKET (Saludo y Fecha Dinámica) ---
    if (EVOLUTION_URL && EVOLUTION_TOKEN && INSTANCE_NAME) {
      try {
        const rawPhone = orderData.shipping_address.phone || orderData.customer.phone;
        const cleanPhone = rawPhone.replace(/\D/g, '');
        
        // --- Lógica de Saludo (Hora Ecuador) ---
        const fechaEcuador = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
        const horaActual = fechaEcuador.getHours();
        let saludo = "Buenos días";
        if (horaActual >= 12 && horaActual < 18) saludo = "Buenas tardes";
        if (horaActual >= 18 || horaActual < 5) saludo = "Buenas noches";

        // --- Lógica de Días de Entrega ---
        const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
        const hoyIdx = fechaEcuador.getDay();
        
        // Calculamos pasado mañana
        const fechaPasado = new Date(fechaEcuador);
        fechaPasado.setDate(fechaEcuador.getDate() + 2);
        const nombrePasado = diasSemana[fechaPasado.getDay()];

        let textoEntrega = `mañana o el ${nombrePasado}`;
        
        // Ajuste para fin de semana
        if (hoyIdx === 5) textoEntrega = "el Lunes o Martes"; // Es viernes
        if (hoyIdx === 6) textoEntrega = "el Martes o Miércoles"; // Es sábado

        const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');

        // MENSAJE 1: Confirmación de datos
        const msg1 = `${saludo}. Nos comunicamos por confirmar el siguiente pedido:\n\n*${productosStr}*\n\nPara:\n*${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}*\nCELULAR: ${rawPhone}\n${orderData.shipping_address.address1}\n${orderData.shipping_address.province}_${orderData.shipping_address.city}`;

        // MENSAJE 2: Logística y Referencia
        const msg2 = `Listo, le estaría llegando entre ${textoEntrega}, en horario de 9am a 5pm. El pedido va por transportadoras conocidas por su seguridad (Servientrega, Gintracon o Laar).\n\nUn favor, disculpa, para una óptima entrega y disminuir los tiempos de entrega nos podría ayudar con una referencia del lugar, ejemplo en frente de farmacias económicas, casa de 1 piso color blanco portón negro.`;

        // Función para enviar a Evolution API
        const enviarWA = async (texto) => {
          await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: cleanPhone, text: texto, delay: 2000 })
          });
        };

        // Enviamos ambos mensajes
        await enviarWA(msg1);
        await enviarWA(msg2);
        
      } catch (waError) {
        console.error('Error enviando WhatsApp:', waError);
      }
    }

    // 7. RESPUESTA FINAL AL NAVEGADOR
    return response.status(200).json({ success: true, orderId: data.draft_order.id });

  } catch (error) {
    console.error('Error General:', error);
    return response.status(500).json({ success: false, message: error.message });
  }
}
