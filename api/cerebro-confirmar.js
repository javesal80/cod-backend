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

    console.log("🚀 [CEREBRO-CONFIRMAR] Enviando ráfaga limpia con corrección de nombre y datos directos");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── 1. CORREGIR NOMBRE REPETIDO ─────────────────────────────────────
        // Tomamos el valor de la celda Cliente y nos quedamos solo con el primer bloque de texto antes del espacio
        let nombreRaw = String(orderData["Cliente"] || "").trim();
        let primerNombre = nombreRaw.split(' ')[0] || nombreRaw;

        // ─── 2. LISTAR PRODUCTOS TAL CUAL VIENEN (CON SU VALOR INCLUIDO) ──────
        // Separamos por comas si vienen varios productos en la misma celda
        let productosRaw = String(orderData["Productos"] || "");
        let listaProductosFinal = productosRaw.split(',')
            .map(item => `    ${item.trim()}`)
            .join('\n');

        // ─── 3. ARMAR LOS TRES MENSAJES LITERALES ─────────────────────────────
        const mensajesAEnviar = [
            `Hola, muy buenas... Un gusto saludarle 😊`,
            `Nos comunicamos de *VitaeLAB* para confirmar el siguiente pedido:\n\n👤 *Cliente:* ${primerNombre}\n📍 *Ciudad:* ${orderData["Ciudad"] || ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}\n📦 *Producto:*\n${listaProductosFinal}`,
            `¿Nos confirma si todos sus datos están correctos para proceder? 😊`
        ];

        // ─── 4. ENVIAR LA RÁFAGA DIRECTA A WHATSAPP ───────────────────────────
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
