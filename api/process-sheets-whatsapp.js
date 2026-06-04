// /api/process-sheets-whatsapp.js - Script 2: PROCESADOR DE SHEETS CON RASTREADORES
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método no permitido" });
  }

  const { GOOGLE_SHEET_URL } = process.env;

  try {
    const { orderId, totalBorrador, productos, orderData } = request.body;

    if (!orderId || !orderData) {
      return response.status(400).json({ success: false, error: "Datos incompletos" });
    }

    console.log("🔍 [DEBUG] Texto de productos a analizar:", productos);

    // 💡 CÁLCULO INFALIBLE
    let sumaTotal = 0;
    if (productos) {
        const precios = productos.match(/\$([0-9]+[.,]?[0-9]*)/g);
        console.log("🔍 [DEBUG] Precios encontrados con regex:", precios);
        
        if (precios) {
            precios.forEach(p => {
                let valor = parseFloat(p.replace('$', '').replace(',', '.'));
                console.log(`🔍 [DEBUG] Valor extraído y listo para sumar: ${valor}`);
                sumaTotal += valor; 
            });
        }
    }

    const totalCalculado = sumaTotal > 0 ? sumaTotal.toFixed(2).replace('.', ',') : (totalBorrador || "");
    console.log("🔍 [DEBUG] TOTAL FINAL CALCULADO:", totalCalculado);

    const clienteNombre = `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}`;
    const clienteTelefono = String(orderData.shipping_address.phone).replace('+', '');

    const sheetData = {
      "ID Pedido": String(orderId), 
      "Fecha": new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
      "Cliente": clienteNombre.trim(),
      "Teléfono": clienteTelefono,
      "Dirección": orderData.shipping_address.address1 || "",
      "Ciudad": orderData.shipping_address.city || "",
      "Productos": productos || "",
      "Estado": "Pendiente",
      "Total": totalCalculado // <--- AQUÍ VA EL TOTAL
    };

    console.log(`📡 [SCRIPT 2] Enviando a Sheets con payload de Total: ${sheetData["Total"]}`);
    
    await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetData)
    });

    return response.status(200).json({ success: true });

  } catch (error) {
    console.error("❌ [SCRIPT 2] Error crítico:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
};
