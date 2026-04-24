// /api/cerebro-confirmar.js - Motor Fiorella v4.8 (Versión Completa sin cortes)
export default async function handler(request, response) {
    // --- CONFIGURACIÓN DE CORS (MANTENIDO) ---
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    // --- VARIABLES DE ENTORNO (MANTENIDO) ---
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

    // --- LOG DE ENTRADA (MANTENIDO Y REFORZADO) ---
    console.log("--- [CEREBRO] PETICIÓN DETECTADA ---");
    const orderData = request.body;
    console.log("Datos recibidos:", JSON.stringify(orderData));

    try {
        // --- VALIDACIÓN DE ESTRUCTURA (MANTENIDO) ---
        if (!orderData || (!orderData["Teléfono"] && !orderData.shipping_address)) {
            console.error("❌ Error: Datos de entrada no reconocidos");
            return response.status(200).json({ success: false, error: "Estructura de datos inválida" });
        }

        // --- EXTRACCIÓN Y LIMPIEZA DE TELÉFONO (MANTENIDO) ---
        let rawPhone = orderData["Teléfono"] || (orderData.shipping_address ? orderData.shipping_address.phone : "");
        let cleanPhone = String(rawPhone).replace(/\D/g, '');
        
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) {
            cleanPhone = '593' + cleanPhone.substring(1);
        } else if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
            cleanPhone = '593' + cleanPhone;
        }

        // --- MAPEO DE VARIABLES (MANTENIDO) ---
        const nombreCliente = orderData["Cliente"] || (orderData.shipping_address ? `${orderData.shipping_address.first_name} ${orderData.shipping_address.last_name}` : "Cliente");
        const productosString = orderData["Productos"] || (orderData.line_items ? orderData.line_items.map(i => i.title).join(", ") : "Productos JRJ");
        const ciudadDestino = orderData["Ciudad"] || (orderData.shipping_address ? orderData.shipping_address.city : "Ecuador");

        // --- CONEXIÓN CON GITHUB (ARREGLADO: Ruta exacta a productos.json) ---
        console.log("📡 Conectando con GitHub para protocolos...");
        let catalogo = { PRODUCTOS: [] };
        let promptMaestroData = { identidad: "Asistente de ventas", tono: "amable" };

        try {
            const [catRes, promptRes] = await Promise.all([
                fetch(`${GITHUB_BASE}/productos.json`), // CORREGIDO: Sin /api/ y nombre exacto
                fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
            ]);

            if (catRes.ok) {
                catalogo = await catRes.json();
            } else {
                console.warn("⚠️ No se pudo cargar productos.json, status:", catRes.status);
            }
            
            if (promptRes.ok) {
                promptMaestroData = await promptRes.json();
            }
        } catch (errGithub) {
            console.error("⚠️ Error de red en GitHub, se usará configuración base.");
        }

        // --- BÚSQUEDA DE INFORMACIÓN ESPECÍFICA (MANTENIDO) ---
        let infoProducto = "Información general de salud de JRJMarket.";
        const productosLower = productosString.toLowerCase();

        if (catalogo.PRODUCTOS && Array.isArray(catalogo.PRODUCTOS)) {
            for (const p of catalogo.PRODUCTOS) {
                if (p.keywords && p.keywords.some(k => productosLower.includes(k.toLowerCase()))) {
                    console.log(`🎯 Producto detectado: ${p.nombre}`);
                    const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
                    if (txtRes.ok) {
                        infoProducto = await txtRes.text();
                    }
                    break;
                }
            }
        }

        // --- CONSTRUCCIÓN DEL PROMPT (MANTENIDO) ---
        const fullPrompt = `
            IDENTIDAD Y REGLAS: ${JSON.stringify(promptMaestroData)}
            CONOCIMIENTO PRODUCTO: ${infoProducto}
            
            DATOS PEDIDO:
            - Cliente: ${nombreCliente}
            - Productos: ${productosString}
            - Ciudad: ${ciudadDestino}

            TAREA: Eres Fiorella. Escribe un mensaje de WhatsApp confirmando el pedido. 
            Pide amablemente una referencia detallada de su casa para Servientrega. 
            Sé humana, cálida y usa emojis.
        `;

        // --- SELECCIÓN DE MOTOR DE IA (MANTENIDO: Gemini, OpenAI, XAI) ---
        let respuestaIA = "";
        const motor = IA_PREFERIDA || 'gemini';
        console.log(`🤖 Motor: ${motor}`);

        if (motor === 'gemini') {
            respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
        } else if (motor === 'openai') {
            respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
        } else if (motor === 'xai') {
            respuestaIA = await llamarXAI(fullPrompt, XAI_API_KEY);
        }

        if (!respuestaIA) throw new Error("La IA no devolvió contenido");

        // --- ENVÍO A EVOLUTION API (MANTENIDO) ---
        console.log("📤 Enviando a WhatsApp...");
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

        const finalData = await sendRes.json();
        console.log("✅ Proceso completado:", JSON.stringify(finalData));

        return response.status(200).json({ success: true, evolutionResponse: finalData });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO:", error.message);
        return response.status(200).json({ success: false, error: error.message });
    }
}

// --- FUNCIONES DE APOYO (MANTENIDO: Gemini, OpenAI, XAI) ---

async function llamarGemini(prompt, key) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function llamarChatGPT(prompt, key) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: prompt }] })
    });
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
}

async function llamarXAI(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-beta", messages: [{ role: "system", content: prompt }] })
    });
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
}
