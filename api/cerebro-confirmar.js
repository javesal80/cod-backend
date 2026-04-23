// /api/cerebro-confirmar.js - Motor Inteligente JRJMarket v3.2
export default async function handler(request, response) {
    // 1. CAPTURA DE DATOS Y VARIABLES DE ENTORNO
    const { tipo, orderData, data } = request.body; 
    const { 
        EVOLUTION_URL, 
        INSTANCE_DESPACHO, 
        TOKEN_DESPACHO, 
        EVOLUTION_TOKEN, 
        IA_PREFERIDA,
        GEMINI_API_KEY,
        OPENAI_API_KEY,
        XAI_API_KEY,
        GITHUB_USER,
        GITHUB_REPO
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const GITHUB_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main`;

    console.log(`--- [CEREBRO] Evento: ${tipo || "WEBHOOK_WHATSAPP"} ---`);

    try {
        // ============================================================
        // CASO A: SALUDO INICIAL (Trigger desde create-order.js)
        // ============================================================
        if (tipo === "NUEVA_COMPRA" && orderData) {
            console.log("🛠️ Procesando nueva compra para WhatsApp...");
            
            const rawPhone = orderData.shipping_address?.phone || orderData.customer?.phone || "";
            let cleanPhone = rawPhone.replace(/\D/g, '');
            
            // Formateo de número para Ecuador
            if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
            if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

            const fechaEcuador = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"}));
            const horaActual = fechaEcuador.getHours();
            let saludo = "Buenos días";
            if (horaActual >= 12 && horaActual < 18) saludo = "Buenas tardes";
            if (horaActual >= 18 || horaActual < 5) saludo = "Buenas noches";

            const productosStr = orderData.line_items.map(item => `${item.quantity} ${item.title}`).join(', ');
            
            const msgApertura = `${saludo}. 😊 Qué gusto saludarle de parte de *JRJMarket*. 

He recibido su pedido de: *${productosStr}*. 

Para asegurar que todo llegue perfecto, ¿podría confirmarme si sus datos de envío son correctos?
📍 *Dirección:* ${orderData.shipping_address.address1}
🏘️ *Ciudad:* ${orderData.shipping_address.city}

¿Está todo bien o prefiere que ajustemos algún detalle?`;

            console.log(`📡 Enviando saludo a ${cleanPhone} vía Evolution...`);

            const waRes = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                body: JSON.stringify({ number: cleanPhone, text: msgApertura, delay: 60000 })
            });

            const waResult = await waRes.json();
            console.log("✅ Respuesta Evolution (Saludo):", JSON.stringify(waResult));
            
            return response.status(200).json({ success: true, info: "Saludo enviado" });
        }

        // ============================================================
        // CASO B: CONVERSACIÓN IA (Webhook de Evolution API)
        // ============================================================
        if (data && data.message && !data.key.fromMe) {
            const customerPhone = data.key.remoteJid.replace(/\D/g, '');
            const customerMessage = (data.message.conversation || data.message.extendedTextMessage?.text || "").toLowerCase();
            
            console.log(`📩 Mensaje recibido de ${customerPhone}: "${customerMessage}"`);

            // 1. CARGAR RECURSOS DESDE GITHUB
            console.log("📖 Cargando catálogo y prompt desde GitHub...");
            const [catRes, promptRes] = await Promise.all([
                fetch(`${GITHUB_BASE}/api/productos.json`),
                fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
            ]);

            if (!catRes.ok || !promptRes.ok) throw new Error("Error cargando archivos de GitHub");

            const catalogo = await catRes.json();
            const promptMaestroData = await promptRes.json();

            // 2. BUSCAR PROTOCOLO ESPECÍFICO (.TXT)
            let infoProducto = "Información general de salud y bienestar de JRJMarket.";
            for (const p of catalogo.PRODUCTOS) {
                if (p.keywords.some(k => customerMessage.includes(k.toLowerCase()))) {
                    const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
                    if (txtRes.ok) {
                        infoProducto = await txtRes.text();
                        console.log(`🎯 Protocolo encontrado: ${p.archivo}`);
                    }
                    break;
                }
            }

            // 3. CONSTRUIR EL PROMPT PARA LA IA
            const fullPrompt = `
                IDENTIDAD Y REGLAS:
                ${JSON.stringify(promptMaestroData)}

                CONOCIMIENTO DEL PRODUCTO:
                ${infoProducto}

                CLIENTE DICE:
                "${customerMessage}"

                INSTRUCCIÓN: Responde como Fiorella, cálida y humana. 
                - Si confirma datos, pide referencia detallada de la casa.
                - Si pregunta cómo usar, usa el CONOCIMIENTO DEL PRODUCTO.
                - Si el problema es el horario, ofrece retirar en Servientrega.
            `;

            // 4. SELECCIÓN DE MOTOR DE IA (Lógica Fiorella)
            let respuestaIA = "";
            const motorIA = IA_PREFERIDA || 'gemini';
            console.log(`🤖 Usando motor IA: ${motorIA}`);

            if (motorIA === 'gemini' && GEMINI_API_KEY) {
                respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
            } 
            else if (motorIA === 'openai' && OPENAI_API_KEY) {
                respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
            } 
            else if (motorIA === 'grok' && XAI_API_KEY) {
                respuestaIA = await llamarGrok(fullPrompt, XAI_API_KEY);
            }

            // 5. ENVIAR RESPUESTA POR WHATSAPP
            if (respuestaIA) {
                console.log("📤 Enviando respuesta generada por IA...");
                const sendRes = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                    body: JSON.stringify({ number: customerPhone, text: respuestaIA })
                });
                const sendResult = await sendRes.json();
                console.log("✅ Respuesta IA enviada:", JSON.stringify(sendResult));
            }

            return response.status(200).end();
        }

    } catch (error) {
        console.error("❌ ERROR CRÍTICO EN CEREBRO:", error.message);
        // Respondemos 200 para que el Webhook no se quede reintentando infinitamente
        return response.status(200).json({ error: error.message });
    }

    return response.status(200).end();
}

// --- FUNCIONES CONECTORAS DE IA ---

async function llamarGemini(prompt, apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const json = await res.json();
    return json.candidates[0].content.parts[0].text;
}

async function llamarChatGPT(prompt, apiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: prompt }] })
    });
    const json = await res.json();
    return json.choices[0].message.content;
}

async function llamarGrok(prompt, apiKey) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-beta", messages: [{ role: "system", content: prompt }] })
    });
    const json = await res.json();
    return json.choices[0].message.content;
}
