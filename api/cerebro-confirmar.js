module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO, 
        OPENAI_API_KEY 
    } = process.env;

    const orderData = request.body;

    console.log("🚀 [CEREBRO-CONFIRMAR] Ejecutando control de calidad de datos interno con IA");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── PROCESAMIENTO NATIVO DE PRODUCTOS Y PRECIOS REVISADOS ───────────
        let productosRaw = String(orderData["Productos"] || "");
        let itemsDeCompra = productosRaw.split(',');
        let lineasDesglosadas = [];

        for (let item of itemsDeCompra) {
            let textoLimpio = item.trim();
            if (!textoLimpio) continue;

            let cantidadMatch = textoLimpio.match(/^(\d+)\s*x?|x\s*(\d+)/i);
            let cantidad = 1;
            if (cantidadMatch) cantidad = parseInt(cantidadMatch[1] || cantidadMatch[2] || "1");

            let itemLower = textoLimpio.toLowerCase();
            let textoProductoLinea = textoLimpio;

            // Lógica exacta para KIDGROW según cantidad
            if (itemLower.includes("kidgrow")) {
                if (cantidad === 1) {
                    textoProductoLinea = `1 un frasco de KIDGROW por $25,00`; // Modifica el $25 si manejas otro precio base por unidad
                } else if (cantidad === 2) {
                    textoProductoLinea = `2 frascos de KIDGROW por $35,00`;
                } else {
                    // Por si compran 3 o más, mantiene el desglose proporcional
                    let totalMas = (17.5 * cantidad).toFixed(2).replace('.', ',');
                    textoProductoLinea = `${cantidad} frascos de KIDGROW por $${totalMas}`;
                }
            } 
            // Mapeo para otros productos de VitaeLAB
            else if (itemLower.includes("colageno") || itemLower.includes("colágeno")) {
                let totalColageno = (14.99 * cantidad).toFixed(2).replace('.', ',');
                textoProductoLinea = `${cantidad} COLAGENO por $${totalColageno}`;
            } else if (itemLower.includes("oregano") || itemLower.includes("orégano")) {
                let totalOregano = (15.00 * cantidad).toFixed(2).replace('.', ',');
                textoProductoLinea = `${cantidad} OIL OREGANO por $${totalOregano}`;
            } else {
                textoProductoLinea = `${cantidad} ${textoLimpio}`;
            }

            lineasDesglosadas.push(`    ${textoProductoLinea}`);
        }

        let listaProductosFinal = lineasDesglosadas.join('\n');

        // ─── MASTER PROMPT INTERNO PARA ANÁLISIS DE CALIDAD DE DIRECCIÓN ─────
        const masterPromptAnalisis = `
Eres un asistente de control de calidad interno para VitaeLAB. Tu tono debe ser muy cálido, educado y profesional. Tratas de USTED.

Tu única misión es recibir los datos que ingresaron desde Google Sheets, verificar de forma inteligente si la dirección está completa y formatear el mensaje en 3 bloques separados por el delimitador "|||".

REGLAS DE EVALUACIÓN DE DIRECCIÓN:
1. Evalúa si el Nombre tiene apellido, y si la Dirección cuenta con DOS CALLES PRINCIPALES (intersección clara con conectores como 'y', 'entre' o 'e') y una REFERENCIA clara para el motorizado.
2. ESCENARIO DIRECCIÓN COMPLETA: Si consideras que la dirección ya cuenta con sus calles principales y referencia, no agregues ningún texto extra ni avisos en el bloque central. Déjalo limpio.
3. ESCENARIO DIRECCIÓN INCOMPLETA: Si detectas que la dirección es muy vaga (ejemplo: solo dice 'sOLANADA' o le faltan por completo las calles o la referencia), muestra los datos tal cual llegaron, pero añade en una línea abajo con mucha calidez:
"gracias por confirmar, pero ayudenos con esto que falta (por favor indíquenos sus calles principales y una referencia clara para que el motorizado pueda llegar sin problemas)."

ESTRUCTURA DE RESPUESTA OBLIGATORIA (Devuelve 3 bloques divididos exactamente por |||):
Hola, ${orderData["Cliente"]} muy buenas... Un gusto saludarle 😊
|||
Nos comunicamos para confirmar el siguiente pedido:

👤 *Cliente:* ${orderData["Cliente"] || ""}
📍 *Ciudad:* ${orderData["Ciudad"] || ""}
🏠 *Dirección:* ${orderData["Dirección"] || ""}
📦 *Producto:*
${listaProductosFinal}

[Si la dirección está incompleta, inyecta AQUÍ la línea amigable pidiendo las calles/referencia. Si está completa, deja este espacio en blanco]
|||
¿Nos confirma si todos sus datos están correctos para proceder? 😊

FORMATO DE SALIDA DE LA IA:
Devuelve un JSON puro con la estructura: {"mensaje": "[Tus 3 bloques con los |||]"}. Usa comillas simples dentro del texto del mensaje. Sin bloques de código markdown.
`;

        // ─── CONSULTA A OPENAI (Solo para analizar la dirección y armar la ráfaga) ───
        const openAiResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: masterPromptAnalisis }, { role: "user", content: `Analizar datos actuales del Sheet:\nCliente: ${orderData["Cliente"]}\nCiudad: ${orderData["Ciudad"]}\nDirección: ${orderData["Dirección"]}` }],
                temperature: 0.1
            })
        });

        const openAiJson = await openAiResp.json();
        const respuestaRaw = openAiJson.choices?.[0]?.message?.content || "";
        console.log("[IA RAW VERIFICACIÓN]", respuestaRaw);

        // ─── PARSEAR Y ENVIAR LOS MENSAJES A WHATSAPP ───────────────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/
```\s*/gi, "").trim();
            const m = clean.match(/\{[\s\S]*\}/);
            if (m) clean = m[0];
            parsed = JSON.parse(clean);
        } catch (e) { console.error("Error parseando el JSON verificado"); }

        if (parsed && parsed.mensaje) {
            const bloquesMensajes = parsed.mensaje.split('|||');

            for (let bloque of bloquesMensajes) {
                let textoMensaje = bloque.trim()
                    .replace(/\\n\\n/g, '\n\n')
                    .replace(/\\n/g, '\n')
                    .replace(/\*\*(.*?)\*\*/g, '*$1*');

                if (textoMensaje.length > 0) {
                    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                        body: JSON.stringify({ number: cleanPhone, text: textoMensaje })
                    });
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
