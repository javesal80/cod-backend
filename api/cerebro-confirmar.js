export default async function handler(request, response) {
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

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

    console.log("--- [CEREBRO] INICIO DE PROCESAMIENTO ---");
    const orderData = request.body;
    console.log("Datos recibidos:", JSON.stringify(orderData));

    try {
        if (!orderData || (!orderData["Teléfono"] && !orderData.shipping_address)) {
            return response.status(200).json({ success: false, error: "Estructura inválida" });
        }

        // 1. Limpieza de Teléfono
        let rawPhone = orderData["Teléfono"] || (orderData.shipping_address ? orderData.shipping_address.phone : "");
        let cleanPhone = String(rawPhone).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // 2. Mapeo de Variables
        const nombreCliente = orderData["Cliente"] || "Cliente";
        const productosString = orderData["Productos"] || "Productos JRJ";
        const ciudadDestino = orderData["Ciudad"] || "Ecuador";

        // 3. Conexión con GitHub (CAMBIO PUNTUAL: api/productos.json)
        console.log("📡 Conectando con GitHub para protocolos...");
        let catalogo = { PRODUCTOS: [] };
        let promptMaestroData = { identidad: "Asistente de ventas", tono: "amable" };

        try {
            const [catRes, promptRes] = await Promise.all([
                fetch(`${GITHUB_BASE}/api/productos.json`), // <--- RUTA CORREGIDA
                fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
            ]);

            if (catRes.ok) catalogo = await catRes.json();
            else console.warn(`⚠️ No se encontró: ${GITHUB_BASE}/api/productos.json`);
            
            if (promptRes.ok) promptMaestroData = await promptRes.json();
        } catch (e) { console.error("⚠️ Error de red en GitHub"); }

        // 4. Búsqueda de Protocolo
        let infoProducto = "Información general de salud de JRJMarket.";
        const productosLower = productosString.toLowerCase();
        if (catalogo.PRODUCTOS && Array.isArray(catalogo.PRODUCTOS)) {
            for (const p of catalogo.PRODUCTOS) {
                if (p.keywords && p.keywords.some(k => productosLower.includes(k.toLowerCase()))) {
                    const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
                    if (txtRes.ok) infoProducto = await txtRes.text();
                    break;
                }
            }
        }

        // 5. Construcción del Prompt
        const fullPrompt = `IDENTIDAD: ${JSON.stringify(promptMaestroData)}. INFO PRODUCTO: ${infoProducto}. CLIENTE: ${nombreCliente}. PRODUCTOS: ${productosString}. CIUDAD: ${ciudadDestino}. TAREA: Confirma pedido y pide referencia detallada de su casa para Servientrega.`;

        // 6. Selección de Motor de IA (Respetando IA_PREFERIDA: Grok)
        let respuestaIA = "";
        const motor = IA_PREFERIDA || 'xai'; 
        console.log(`🤖 Usando motor de IA: ${motor}`);

        if (motor === 'xai') {
            respuestaIA = await llamarXAI(fullPrompt, XAI_API_KEY);
        } else if (motor === 'openai') {
            respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
        } else if (motor === 'gemini') {
            respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
        }

        if (!respuestaIA) throw new Error(`La IA (${motor}) no devolvió contenido.`);

        // 7. Envío a WhatsApp
        console.log("📤 Enviando a WhatsApp...");
        const sendRes = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
            body: JSON.stringify({ number: cleanPhone, text: respuestaIA, delay: 2000 })
        });

        const finalData = await sendRes.json();
        console.log("✅ Proceso completado:", JSON.stringify(finalData));

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO:", error.message);
        return response.status(200).json({ success: false, error: error.message });
    }
}

// --- FUNCIONES DE APOYO (AJUSTE PUNTUAL EN LLAMARXAI) ---

async function llamarGemini(prompt, key) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function llamarChatGPT(prompt, key) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: prompt }] })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}

async function llamarXAI(prompt, key) {
    // CAMBIO PUNTUAL: Ajuste de estructura para la API de xAI (Grok)
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${key}`, 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [
                { role: "system", content: "Eres Fiorella, una asistente cálida y eficiente de JRJMarket." },
                { role: "user", content: prompt } 
            ],
            stream: false,
            temperature: 0.7
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}
