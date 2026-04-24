export default async function handler(request, response) {
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, TOKEN_DESPACHO, EVOLUTION_TOKEN, 
        IA_PROVIDER, GEMINI_API_KEY, OPENAI_API_KEY, GROK_API_KEY 
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const user = "javesal80"; 
    const repo = "cod-backend";
    const GITHUB_BASE = `https://raw.githubusercontent.com/${user}/${repo}/main`;

    const orderData = request.body;
    console.log("--- [CEREBRO] GENERANDO RESUMEN DE PEDIDO ---");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        // 1. Limpieza de Teléfono
        let rawPhone = orderData["Teléfono"];
        let cleanPhone = String(rawPhone).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // 2. Determinación del Saludo (Hora Ecuador)
        const hora = new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil", hour: 'numeric', hour12: false});
        let saludo = "Buenos días";
        if (hora >= 12 && hora < 19) saludo = "Buenas tardes";
        if (hora >= 19 || hora < 5) saludo = "Buenas noches";

        // 3. Datos para el Prompt
        const nombreCliente = orderData["Cliente"] || "Cliente";
        const productosString = orderData["Productos"] || "";
        const direccion = orderData["Dirección"] || "";
        const ciudad = orderData["Ciudad"] || "";

        // --- PROMPT PARA GROK (FORMATO ESPECÍFICO) ---
        const fullPrompt = `
        Eres Fiorella de JRJMarket. 
        TU TAREA: Generar un mensaje de confirmación con este formato exacto:

        ${saludo} ${nombreCliente}.
        Nos comunicamos para confirmar el siguiente pedido:
        ${productosString}
        
        para:
        ${nombreCliente}
        CELULAR: ${cleanPhone}
        ${direccion}
        ${ciudad}

        Es correcto?

        REGLAS:
        - Si la dirección está incompleta (falta calle secundaria o referencia), después de "Es correcto?" añade de forma muy natural: "Por cierto, ¿me podría ayudar con la calle secundaria o una referencia de su casa para el mensajero?"
        - No uses negritas excesivas, mantén el formato limpio.
        `;

        let respuestaIA = "";
        const motor = IA_PROVIDER || 'xai';

        if (motor === 'xai' || motor === 'grok') {
            respuestaIA = await llamarXAI(fullPrompt, GROK_API_KEY);
        } else if (motor === 'openai') {
            respuestaIA = await llamarChatGPT(fullPrompt, OPENAI_API_KEY);
        } else {
            respuestaIA = await llamarGemini(fullPrompt, GEMINI_API_KEY);
        }

        // 4. Envío a Evolution
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
            body: JSON.stringify({ number: cleanPhone, text: respuestaIA, delay: 2000 })
        });

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("ERROR:", error.message);
        return response.status(200).json({ error: error.message });
    }
}

// --- FUNCIONES IA ---
async function llamarXAI(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [
                { role: "system", content: "Eres Fiorella. Confirmas pedidos de forma clara, respetando el formato de lista y validando la dirección en Ecuador." },
                { role: "user", content: prompt } 
            ],
            temperature: 0.5 // Baja temperatura para que respete el formato de lista
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}

async function llamarGemini(p, k) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: p }] }] })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function llamarChatGPT(p, k) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: p }] })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}
