module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO 
    } = process.env;

    const orderData = request.body;

    console.log("🚀 [CEREBRO-CONFIRMAR] Enviando ráfaga estructurada en mensajes separados");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // 1. Limpiar nombre duplicado (Solo primera palabra)
        let nombreRaw = String(orderData["Cliente"] || "").trim();
        let primerNombre = nombreRaw.split(' ')[0] || nombreRaw;

        // 2. Formatear la lista de productos de forma vertical
        let productosRaw = String(orderData["Productos"] || "");
        let listaProductosFinal = productosRaw.split(',')
            .map(item => `▪️ ${item.trim()}`)
            .join('\n');

        // Extraer el total general enviado desde el Sheet
        let totalGeneral = orderData["Total"] || "";
        let textoTotal = totalGeneral ? `\n\n💰 *Total pedido:* $${totalGeneral}` : "";

        // 3. Estructura de mensajes independientes
        const mensajesAEnviar = [
            // Mensaje 1: El saludo
            `Hola, muy buenas... Un gusto saludarle 😊`,
            
            // Mensaje 2: Confirmación de productos y valores + Total general
            `Nos comunicamos por confirmar el siguiente pedido:\n\n📦 *Productos:*\n${listaProductosFinal}${textoTotal}`,
            
            // Mensaje 3: Datos de entrega del cliente
            `📍 *Para:* ${primerNombre}\n🏙️ *Ciudad:* ${orderData["Ciudad"] || ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}\n\n¿Es correcto?`
        ];

        // 4. Enviar la ráfaga con espacio de 1.5 segundos entre cada mensaje
        for (const msgTexto of mensajesAEnviar) {
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                body: JSON.stringify({ number: cleanPhone, text: msgTexto })
            });
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
