// /api/process-sheets-whatsapp.js - Script 2: SOLO PROCESADOR DE GOOGLE SHEETS
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método no permitido" });
  }

  const { GOOGLE_SHEET_URL } = process.env;

  console.log("--- [SCRIPT 2] Iniciando Envío a Google Sheets ---");

  try {
    // 1. Recibimos los datos empaquetados por el Script 1
    const { orderId, totalBorrador, productos, orderData } = request.body;

    if (!orderId || !orderData) {
      console.error("❌ [SCRIPT 2] Error: Datos incompletos recibidos.");
      return response.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const clienteNombre = `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}`;
    const clienteTelefono = String(orderData.shipping_address.phone).replace('+', '');

    // 2. Armamos el JSON con los nombres exactos que espera tu Apps Script (Incluyendo el Total)
    const sheetData = {
      "ID Pedido": String(orderId), 
      "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
      "Cliente": clienteNombre.trim(),
      "Teléfono": clienteTelefono,
      "Dirección": orderData.shipping_address.address1 || "",
      "Ciudad": orderData.shipping_address.city || "",
      "Productos": productos || "",
      "Estado": "Pendiente",
      "Total": totalBorrador || ""
    };

    console.log("📡 [SCRIPT 2] Enviando fila a Apps Script...");
    
    // 3. Disparamos a la URL de Google (que activará tu efecto dominó)
    try {
      const sheetRes = await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetData)
      });
      
      if (sheetRes.ok) {
         console.log("✅ [SCRIPT 2] Fila guardada en Sheets. El dominó hacia cerebro-confirmar ha comenzado.");
      } else {
         console.error("❌ [SCRIPT 2] Error del servidor de Google:", sheetRes.status);
      }
    } catch (sheetErr) {
      console.error("❌ [SCRIPT 2] Error al conectar con Google Sheets:", sheetErr.message);
    }

    // 4. Cerramos el proceso con éxito
    return response.status(200).json({ success: true, message: "Dominó iniciado con éxito." });

  } catch (error) {
    console.error("❌ [SCRIPT 2] Error General crítico:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
};
