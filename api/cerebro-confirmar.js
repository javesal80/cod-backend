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

    console.log("🚀 [CEREBRO-CONFIRMAR] Copiando y enviando datos puros de Google Sheets (100% Obediente)");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── EXTRAER PRODUCTOS EXACTOS DE GOOGLE SHEETS ───────────────────
        // Separamos por comas y dejamos cada producto con su precio tal cual viene en tu celda
        let productosRaw = String(orderData["Productos"] || "");
        let listaProductosFinal = productosRaw.split(',')
            .map(item => `    ${item.trim()}`)
            .join('\n');

        // ─── ARMAR LOS TRES MENSAJES LITERALES ─────────────────────────────
        const mensajesAEnviar = [
            `Hola, muy buenas... Un gusto saludarle 😊`,
            `Nos comunicamos de *VitaeLAB* para confirmar el siguiente pedido:\n\n👤 *Cliente:* ${orderData["Cliente"] || ""}\n📍 *Ciudad:* ${orderData["Ciudad"] || ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}\n📦 *Producto:*\n${listaProductosFinal}`,
            `¿Nos confirma si todos sus datos están correctos para proceder? 😊`
        ];

        // ─── ENVIAR LA RÁFAGA DIRECTA A WHATSAPP ───────────────────────────
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
