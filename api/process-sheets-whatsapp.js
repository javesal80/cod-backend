// /api/process-sheets-whatsapp.js - Script 2: Procesador de Google Sheets y WhatsApp
module.exports = async function handler(request, response) {
  // Solo permitimos peticiones POST (que es como le pega el Script 1)
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método no permitido" });
  }

  const { 
    GOOGLE_SHEET_URL, 
    EVOLUTION_API_URL, 
    EVOLUTION_API_KEY, 
    EVOLUTION_INSTANCE 
  } = process.env;

  console.log("--- [SCRIPT 2] Iniciando Procesamiento de Fondo ---");

  try {
    // Recibimos el paquete de datos que nos envió el Script 1
    const { orderId, totalBorrador, productos, orderData } = request.body;

    // Validación básica para asegurar que llegaron los datos mapeados en memoria
    if (!orderId || !orderData) {
      console.error("❌ [SCRIPT 2] Error: Datos incompletos recibidos del Script 1.");
      return response.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const clienteNombre = `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}`;
    const clienteTelefono = String(orderData.shipping_address.phone).replace('+', '');

    // 1. PASO A GOOGLE SHEETS (Mediante Sheet.best o tu Web App)
    const sheetData = {
      "ID Pedido": String(orderId), 
      "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
      "Cliente": clienteNombre,
      "Teléfono": clienteTelefono,
      "Dirección": orderData.shipping_address.address1,
      "Ciudad": orderData.shipping_address.city,
      "Productos": productos,
      "Estado": "Pendiente",
      "Total": totalBorrador
    };

    try {
      console.log("📡 [SCRIPT 2] Enviando fila a Google Sheets...");
      await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetData)
      });
      console.log("✅ [SCRIPT 2] Google Sheets actualizado correctamente.");
    } catch (sheetErr) {
      console.error("❌ [SCRIPT 2] Error al conectar con Google Sheets:", sheetErr.message);
    }

    // 2. PASO A WHATSAPP (Mediante Evolution API en Railway)
    try {
      console.log(`📡 [SCRIPT 2] Enviando WhatsApp a: ${clienteTelefono}...`);
      
      const mensajeWhatsApp = `📦 *CONFIRMACIÓN DE PEDIDO COD* 📦\n\n` +
                              `Hola *${orderData.shipping_address.first_name}*,\n` +
                              `Hemos recibido tu pedido con pago contra entrega.\n\n` +
                              `🛍️ *Detalle:* ${productos}\n` +
                              `📍 *Ciudad:* ${orderData.shipping_address.city}\n` +
                              `🏠 *Dirección:* ${orderData.shipping_address.address1}\n` +
                              `💰 *Total a pagar al recibir:* $${totalBorrador}\n\n` +
                              `Por favor, responde a este mensaje confirmando con un *SÍ* para proceder con el envío inmediato.`;

      const whatsappRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY
        },
        body: JSON.stringify({
          number: clienteTelefono,
          options: { delay: 1200, presence: "composing" },
          textMessage: { text: mensajeWhatsApp }
        })
      });

      if (whatsappRes.ok) {
        console.log("✅ [SCRIPT 2] WhatsApp enviado con éxito vía Railway.");
      } else {
        const errData = await whatsappRes.json();
        console.error("❌ [SCRIPT 2] Error de Evolution API:", errData);
      }
    } catch (waErr) {
      console.error("❌ [SCRIPT 2] Error conectando a Railway (WhatsApp):", waErr.message);
    }

    // Le respondemos a Vercel que el trabajo de fondo terminó de forma exitosa
    return response.status(200).json({ success: true, message: "Sheets y WhatsApp procesados de fondo." });

  } catch (error) {
    console.error("❌ [SCRIPT 2] Error General crítico:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
};
