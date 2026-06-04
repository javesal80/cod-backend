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

// --- NUEVO FLUJO LIMPIO: Avisar al Script 2 en segundo plano ---
    try {
      // Le pegamos a la URL de nuestro nuevo script pasándole los datos calculados
      // NO usamos 'await' aquí para que no se quede esperando la respuesta
      fetch(`https://${request.headers.host}/api/process-sheets-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: String(orderId),
          totalBorrador: totalBorrador,
          productos: productos,
          orderData: orderData,
          sheetData: sheetData
        })
      }).catch(err => console.error("Error disparando Script 2:", err.message));
      
      console.log("🚀 Script 2 disparado en segundo plano con éxito.");
    } catch (triggerErr) {
      console.error("❌ Error al intentar llamar al Script 2:", triggerErr.message);
    }

    // RESPUESTA INMEDIATA: El cliente se va a la página de gracias YA
    return response.status(200).json({ success: true, orderId: orderId });

  } catch (error) {
    console.error("❌ Error General:", error.message);
    return response.status(500).json({ success: false, error: error.message });
  }
}
