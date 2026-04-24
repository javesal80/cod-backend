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
        IA_PROVIDER, 
        GEMINI_API_KEY, 
        OPENAI_API_KEY, 
        GROK_API_KEY 
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const user = "javesal80"; 
    const repo = "cod-backend";
    const GITHUB_BASE = `https://raw.githubusercontent.com/${user}/${repo}/main`;

    console.log("--- [CEREBRO] INICIO: VALIDACIÓN LOGÍSTICA ---");
    const orderData = request.body;

    try {
        if (!orderData || !orderData["Teléfono"]) {
            return response.status(200).json({ success: false, error: "Sin datos" });
        }

        // 1. Limpieza de Teléfono
        let rawPhone = orderData["Teléfono"];
        let cleanPhone = String(rawPhone).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // 2. Variables de Pedido
        const nombreCliente = orderData["Cliente"] || "Cliente";
        const productosString = orderData["Productos"] || "Productos JRJ";
        const ciudadDestino = orderData["Ciudad"] || "Ecuador";
        const direccionOriginal = orderData["Dirección"] || "";

        // 3. Conexión con GitHub (api/productos.json)
        let catalogo = { PRODUCTOS: [] };
        let promptMaestroData = {};
        try {
            const [catRes, promptRes] = await Promise.all([
                fetch(`${GITHUB_BASE}/api/productos.json`),
                fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
            ]);
            if (catRes.ok) catalogo = await catRes.json();
            if (promptRes.ok) promptMaestroData = await promptRes.json();
        } catch (e) { console.error("Error GitHub"); }

        let infoProducto = "Información general.";
        const productosLower = productosString.toLowerCase();
        if (catalogo.PRODUCTOS) {
            for (const p of catalogo.PRODUCTOS) {
                if (p.keywords?.some(k => productosLower.includes(k.toLowerCase()))) {
                    const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
                    if (txtRes.ok) infoProducto = await txtRes.text();
                    break;
                }
            }
        }

        // --- 4. PROMPT DE VALIDACIÓN DE DIRECCIÓN (PROFESIONAL) ---
        const fullPrompt = `
        IDENTIDAD: ${JSON.stringify(promptMaestroData)}
        INFO PRODUCTO: ${infoProducto}

        DATOS DEL CLIENTE:
        - Nombre: ${nombreCliente}
        - Ciudad: ${ciudadDestino}
        - Dirección proporcionada: "${direccionOriginal}"

        OBJETIVO LOGÍSTICO:
        Eres Fiorella. Debes confirmar el pedido de "${productosString}" y validar si la dirección es apta para despacho.
        
        CRITERIOS DE VALIDACIÓN:
        1. ¿Tiene calle principal y secundaria?
        2. ¿Si es urbanización, tiene etapa/manzana/villa?
        3. ¿Tiene una referencia física clara (ej: frente a, junto a, color de casa)?

        INSTRUCCIÓN DE RESPUESTA:
        - Si falta la calle secundaria o referencia: Saluda cortésmente, confirma el pedido y pide específicamente la información faltante para evitar retrasos con Servientrega.
        - Si la dirección es perfecta: Confirma el pedido e indica que procedes al despacho.
        - NUNCA uses jerga informal como "veci". Mantén el tono de asistente profesional de JRJMarket.
        `;

        // 5. Selección de Motor de IA
        let respuestaIA = "";
        const motor = IA_PROVIDER || 'xai';

        if (motor === 'xai' || motor === 'grok') {
            respuestaIA = await llamarXAI(fullPrompt, GROK_API_KEY);
        } else if (motor === 'openai') {
            respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
        } else {
            respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
        }

        if (!respuestaIA) throw new Error("IA sin respuesta");

        // 6. Envío a Evolution API
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
            body: JSON.stringify({ number: cleanPhone, text: respuestaIA, delay: 2000 })
        });

        console.log(`✅ Mensaje enviado a ${nombreCliente}. Motor: ${motor}`);
        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return response.status(200).json({ error: error.message });
    }
}

// --- FUNCIONES DE APOYO ---

async function llamarXAI(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [
                { role: "system", content: "Eres Fiorella, asistente profesional de JRJMarket. Experta en logística de entregas en Ecuador." },
                { role: "user", content: prompt } 
            ],
            temperature: 0.7
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}

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
