// /api/cerebro-confirmar.js - Motor Inteligente Multi-IA JRJMarket
export default async function handler(request, response) {
    // 1. CONFIGURACIÓN INICIAL Y VARIABLES
    const { tipo, orderData, data } = request.body;
    const { 
        EVOLUTION_URL, 
        INSTANCE_DESPACHO, 
        TOKEN_DESPACHO, 
        EVOLUTION_TOKEN, 
        IA_PREFERIDA,
        GEMINI_API_KEY,
        OPENAI_API_KEY,
        XAI_API_KEY
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const GITHUB_BASE = "https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main";

    // --- CASO A: INYECCIÓN DEL PRIMER MENSAJE (Viene de create-order) ---
    if (tipo === "NUEVA_COMPRA" && orderData) {
        try {
            console.log("--- PROCESANDO SALUDO INICIAL ---");
            const rawPhone = orderData.shipping_address.phone || orderData.customer.phone || "";
            let cleanPhone = rawPhone.replace(/\D/g, '');
            
            // Formateo Ecuador
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

            // Envío a Evolution API con delay para parecer humano
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                body: JSON.stringify({ number: cleanPhone, text: msgApertura, delay: 60000 })
            });

            console.log("✅ Saludo inicial enviado a la cola de Evolution");
            return response.status(200).json({ success: true, message: "Saludo programado" });

        } catch (error) {
            console.error("❌ Error en Saludo Inicial:", error.message);
            return response.status(500).json({ error: error.message });
        }
    }

    // --- CASO B: CONVERSACIÓN INTELIGENTE (Viene del Webhook de WhatsApp) ---
    if (data && data.message && !data.key.fromMe) {
        try {
            console.log("--- PROCESANDO RESPUESTA DE CLIENTE ---");
            const customerPhone = data.key.remoteJid.replace(/\D/g, '');
            const customerMessage = (data.message.conversation || data.message.extendedTextMessage?.text || "").toLowerCase();

            // 1. CARGAR CATÁLOGO Y PROMPT MAESTRO DESDE GITHUB
            const [catRes, promptRes] = await Promise.all([
                fetch(`${GITHUB_BASE}/api/productos.json`),
                fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
            ]);

            if (!catRes.ok || !promptRes.ok) throw new Error("No se pudo cargar la configuración de GitHub");

            const catalogo = await catRes.json();
            const promptMaestroData = await promptRes.json();

            // 2. BUSCAR PROTOCOLO DEL PRODUCTO (.TXT)
            let infoProducto = "Información general de salud y bienestar de JRJMarket.";
            for (const p of catalogo.PRODUCTOS) {
                if (p.keywords.some(k => customerMessage.includes(k.toLowerCase()))) {
                    const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
                    if (txtRes.ok) {
                        infoProducto = await txtRes.text();
                        console.log("📖 Protocolo cargado:", p.archivo);
                    }
                    break;
                }
            }

            // 3. CONSTRUIR EL PROMPT PARA LA IA
            const fullPrompt = `
                SISTEMA DE IDENTIDAD (Prompt Maestro):
                ${JSON.stringify(promptMaestroData)}

                CONOCIMIENTO TÉCNICO DEL PRODUCTO:
                ${infoProducto}

                MENSAJE DEL CLIENTE A RESPONDER:
                "${customerMessage}"

                INSTRUCCIÓN: Responde como Fiorella. Si el cliente confirma, pide referencias de la casa. 
                Si tiene dudas de cómo se usa, usa el "CONOCIMIENTO TÉCNICO". 
                Si el horario es el problema, ofrece dejarlo en agencia Servientrega.
            `;

            // 4. SELECCIÓN DINÁMICA DE IA (IFs igual a Fiorella)
            let respuestaIA = "";
            const motorIA = IA_PREFERIDA || 'gemini';

            if (motorIA === 'gemini' && GEMINI_API_KEY) {
                respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
            } 
            else if (motorIA === 'openai' && OPENAI_API_KEY) {
                respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
            } 
            else if (motorIA === 'grok' && XAI_API_KEY) {
                respuestaIA = await llamarGrok(fullPrompt, XAI_API_KEY);
            }

            // 5. ENVIAR RESPUESTA AL CLIENTE
            if (respuestaIA) {
                await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                    body: JSON.stringify({ number: customerPhone, text: respuestaIA })
                });
                console.log("✅ Respuesta de IA enviada");
            }

            return response.status(200).end();

        } catch (error) {
            console.error("❌ Error en Proceso de IA:", error.message);
            return response.status(200).end(); // Respondemos 200 para evitar reintentos del webhook
        }
    }

    return response.status(200).json({ status: "Esperando eventos" });
}

// --- FUNCIONES CONECTORAS (MANTENIENDO EL STAND-ALONE) ---

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
