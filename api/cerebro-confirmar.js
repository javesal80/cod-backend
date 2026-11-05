module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const {
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO,
        PAYPHONE_LINK          // link de pago de PayPhone
    } = process.env;

    const DATOS_TRANSFERENCIA =
`👤 *Nombre:* Javier Espín

🏦 *Banco Pichincha:* cuenta # 4082653600
🏦 *Banco Produbanco:* cuenta # 12001090841
🏦 *Banco del Pacífico:* cuenta # 1016255178`;
    
    const orderData = request.body;

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const nombreCompleto = String(orderData["Cliente"] || "").trim();

        // --- Tipo de cobro (normalizado) ---
        const metodoRaw = String(orderData["Tipo de cobro"] || "")
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        let metodo = "contraentrega"; // valor por defecto si llega vacío o desconocido
        if (metodoRaw.includes("transfer")) metodo = "transferencia";
        else if (metodoRaw.includes("tarjeta") || metodoRaw.includes("payphone")) metodo = "tarjeta";

        // --- Productos y total (igual que antes) ---
        const productosFormateados = String(orderData["Productos"] || "")
            .replace(/\(\$/g, "por $")
            .replace(/\)/g, "")
            .replace(/,/g, ".");

        const listaProductosFinal = productosFormateados.split(' y ')
            .map(item => `▪️ ${item.trim()}`)
            .join('\n');

        let totalGeneral = orderData["Total"] || "";
        if (totalGeneral) totalGeneral = String(totalGeneral).replace(/,/g, ".");
        const textoTotal = totalGeneral ? `\n\n💰 *Total pedido:* $${totalGeneral}` : "";

        // --- Mensajes comunes ---
        const mensajesAEnviar = [
            `Hola, muy buenas... Un gusto saludarle 😊`,
            `Nos comunicamos por confirmar el siguiente pedido:\n\n📦 *Productos:*\n${listaProductosFinal}${textoTotal}`,
            `📍 *Para:* ${nombreCompleto}\n🏙️ *Ciudad:* ${orderData["Ciudad"] || ""}${orderData["Provincia"] ? `\n🗺️ *Provincia:* ${orderData["Provincia"]}` : ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}`
        ];

        // --- Mensajes según tipo de cobro ---
        if (metodo === "contraentrega") {
            mensajesAEnviar.push(`¿Es esto correcto?`);
        } else if (metodo === "transferencia") {
            mensajesAEnviar.push(
    `A continuación los datos para la transferencia${totalGeneral ? ` por *$${totalGeneral}*` : ""}.\n\nPor favor realízala *del mismo banco* para que sea inmediata:\n▪️ Pichincha → Pichincha\n▪️ Produbanco → Produbanco\n▪️ Pacífico → Pacífico`,
    DATOS_TRANSFERENCIA,
    `Una vez realizada, por favor adjúntanos el comprobante de pago 📎 y confírmanos si los datos de entrega son correctos.`
);
        } else if (metodo === "tarjeta") {
            mensajesAEnviar.push(
                `Te adjunto el link de pago seguro de PayPhone para pagar con tu tarjeta:\n\n💳 ${PAYPHONE_LINK || ""}`,
                `Una vez realizado el pago, por favor adjúntanos el comprobante 📎 y confírmanos si los datos de entrega son correctos.`
            );
        }

        console.log(`🚀 [CEREBRO-CONFIRMAR] Método: ${metodo} | ${mensajesAEnviar.length} mensajes`);

        for (const msgTexto of mensajesAEnviar) {
            const r = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                body: JSON.stringify({ number: cleanPhone, text: msgTexto })
            });
            if (!r.ok) console.error("Evolution respondió", r.status, await r.text());
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
