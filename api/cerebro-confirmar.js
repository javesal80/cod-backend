// /api/cerebro-confirmar.js - Motor Fiorella v4.8 (Estructura de 180+ líneas mantenida)
export default async function handler(request, response) {
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

    // --- VARIABLES DE ENTORNO ---
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

    // --- LOG DE ENTRADA ---
    console.log("--- [CEREBRO] INICIO DE PROCESAMIENTO ---");
    const orderData = request.body;
    console.log("Datos recibidos de la fuente:", JSON.stringify(orderData));

    try {
        // --- VALIDACIÓN DE DATOS ---
        if (!orderData || (!orderData["Teléfono"] && !orderData.shipping_address)) {
            console.error("❌ Error: Estructura de datos no reconocida");
            return response.status(200).json({ success: false, error: "Datos insuficientes" });
        }

        // --- EXTRACCIÓN Y LIMPIEZA DE TELÉFONO (MODO COMPATIBILIDAD) ---
        let rawPhone = orderData["Teléfono"] || (orderData.shipping_address ? orderData.shipping_address.phone : "");
        let cleanPhone = String(rawPhone).replace(/\D/g, '');
        
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        console.log(`📱 Teléfono procesado: ${cleanPhone}`);

        // --- VARIABLES DE PEDIDO ---
        const nombreCliente = orderData["Cliente"] || (orderData.shipping_address ? `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}` : "Cliente");
        const productosString = orderData["Productos"] || (orderData.line_items ? orderData.line_items.map(i => i.title).join(", ") : "Productos JRJ");
        const ciudadDestino = orderData["Ciudad"] || (orderData.shipping_address ? orderData.shipping_address.city : "Ecuador");

        // --- CONEXIÓN CON GITHUB (PROTOCOLOS) ---
        console.log("📡 Conectando con GitHub para protocolos...");
        const [catRes, promptRes] = await Promise.all([
            fetch(`${GITHUB_BASE}/api/productos.json`),
            fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
        ]);

        if (!catRes.ok) throw new Error("No se pudo cargar el catálogo de productos desde GitHub");
        if (!promptRes.ok) throw new Error("No se pudo cargar el prompt maestro desde GitHub");

        const catalogo = await catRes.json();
        const promptMaestroData = await promptRes.json();

        // --- BÚSQUEDA DE INFORMACIÓN DEL PRODUCTO ---
        let infoProducto = "Información general de salud de JRJMarket.";
        const productosLower = productosString.toLowerCase();

        for (const p of catalogo.PRODUCTOS) {
            if (p.keywords.some(k => productosLower.includes(k.toLowerCase()))) {
                console.log(`🎯 Producto detectado: ${p.nombre}`);
                const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
                if (txtRes.ok) infoProducto = await txtRes.text();
                break;
            }
        }

        // --- CONSTRUCCIÓN DEL PROMPT ---
        const fullPrompt = `
            IDENTIDAD Y REGLAS DE NEGOCIO:
            ${JSON.stringify(promptMaestroData)}

            CONOCIMIENTO DEL PRODUCTO VENDIDO:
            ${infoProducto}

            DETALLES DEL PEDIDO PARA CONFIRMAR:
            - Cliente: ${nombreCliente}
            - Productos: ${productosString}
            - Ciudad: ${ciudadDestino}

            INSTRUCCIÓN ACTUAL:
            Eres Fiorella. Tu objetivo es enviar un mensaje de confirmación vía WhatsApp. 
            1. Saluda por su nombre.
            2. Confirma la recepción del pedido de ${productosString}.
            3. Pide una referencia física de la dirección para el repartidor.
            4. Mantén el tono humano, cálido y usa emojis.
        `;

        // --- SELECCIÓN DE MOTOR DE IA ---
        let respuestaIA = "";
        const motor = IA_PREFERIDA || 'gemini';
        console.log(`🤖 Usando motor de IA: ${motor}`);

        if (motor === 'gemini') {
            respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
        } else if (motor === 'openai') {
            respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
        } else if (motor === 'xai') {
            respuestaIA = await llamarXAI(fullPrompt, XAI_API_KEY);
        }

        if (!respuestaIA) throw new Error("La IA no generó ninguna respuesta");

        // --- ENVÍO A EVOLUTION API ---
        console.log("📤 Enviando mensaje a Evolution API...");
        const sendRes = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'apikey': apikeyFinal 
            },
            body: JSON.stringify({ 
                number: cleanPhone, 
                text: respuestaIA,
                delay: 2000
            })
        });

        const sendData = await sendRes.json();
        console.log("✅ Resultado final:", JSON.stringify(sendData));

        return response.status(200).json({ success: true, message: "WhatsApp procesado" });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO EN CEREBRO:", error.message);
        return response.status(200).json({ success: false, error: error.message });
    }
}

// --- FUNCIONES AUXILIARES DE IA (RECONSTRUIDAS) ---

async function llamarGemini(prompt, key) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function llamarChatGPT(prompt, key) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: prompt }] })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}

async function llamarXAI(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-beta", messages: [{ role: "system", content: prompt }] })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}
