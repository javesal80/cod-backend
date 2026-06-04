// /api/process-sheets-whatsapp.js - Script 2: PROCESADOR DE SHEETS Y CÁLCULO DE TOTAL
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método no permitido" });
  }

  const { GOOGLE_SHEET_URL } = process.env;

  console.log("--- [SCRIPT 2] Iniciando Envío a Google Sheets ---");

  try {
    // 1. Recibimos los datos empaquetados por tu create-order original
    const { orderId, totalBorrador, productos, orderData } = request.body;

    if (!orderId || !orderData) {
      console.error("❌ [SCRIPT 2] Error: Datos incompletos recibidos.");
      return response.status(400).json({ success: false, error: "Datos incompletos" });
    }

    // 2. CÁLCULO MATEMÁTICO DEL TOTAL (En las sombras)
    let sumaTotal = 0;
    
    // Verificamos que vengan los productos y los sumamos
    if (orderData.line_items && Array.isArray(orderData.line_items)) {
      orderData.line_items.forEach(item => {
        // Tomamos el precio fijo de cada línea y lo sumamos (sin multiplicar por cantidad)
        const precioFijo = parseFloat(item.price || 0);
        sumaTotal += precioFijo;
      });
    }

    // Si la suma funcionó, la formateamos a 2 decimales con coma. Si da 0, intentamos usar el viejo totalBorrador
    const totalCalculado = sumaTotal > 0 ? sumaTotal.toFixed(2).replace('.', ',') : (totalBorrador || "");

    // 3. Saneamiento de datos del cliente
    const clienteNombre = `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}`;
    const clienteTelefono = String(orderData.shipping_address.phone).replace('+', '');

    // 4. Armamos el JSON con los nombres exactos para tu Apps Script
    const sheetData = {
      "ID Pedido": String(orderId), 
      "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
      "Cliente": clienteNombre.trim(),
      "Teléfono": clienteTelefono,
      "Dirección": orderData.shipping_address.address1 || "",
      "Ciudad": orderData.shipping_address.city || "",
      "Productos": productos || "",
      "Estado": "Pendiente",
      "Total": totalCalculado // <--- AQUÍ SE ENVÍA EL TOTAL MATEMÁTICO A LA COLUMNA I
    };

    console.log(`📡 [SCRIPT 2] Enviando a Sheets... Total calculado: $${totalCalculado}`);
    
    // 5. Disparamos a la URL de Google (Inicia el dominó)
    try {
      const sheetRes = await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetData)
      });
      
      if (sheetRes.ok) {
         console.log("✅ [SCRIPT 2] Fila guardada en Sheets con el Total. El dominó ha comenzado.");
      } else {
         console.error("❌ [SCRIPT 2] Error del servidor de Google:", sheetRes.status);
      }
    } catch (sheetErr) {
      console.error("❌ [SCRIPT 2] Error al conectar con Google Sheets:", sheetErr.message);
    }

    // 6. Cerramos el proceso con éxito
    return response.status(200).json({ success: true, message: "Dominó y cálculos iniciados con éxito." });

  } catch (error) {
    console.error("❌ [SCRIPT 2] Error General crítico:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
};
