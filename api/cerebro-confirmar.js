export default async function handler(request, response) {
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, TOKEN_DESPACHO, EVOLUTION_TOKEN, 
        IA_PROVIDER, GROK_API_KEY, GEMINI_API_KEY, GITHUB_USER, GITHUB_REPO 
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const user = "javesal80"; 
    const repo = "cod-backend";
    const GITHUB_BASE = `https://raw.githubusercontent.com/${user}/${repo}/main`;

    const orderData = request.body;

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        // 1. Teléfono y Saludo
        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const hora = new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil", hour: 'numeric', hour12: false});
        let saludo = (hora >= 5 && hora < 12) ? "Buenos días" : (hora >= 12 && hora < 19) ? "Buenas tardes" : "Buenas noches";

        // 2. Obtener info de productos desde GitHub para que la IA sepa los precios
        let catalogo = { PRODUCTOS: [] };
        try {
            const catRes = await fetch(`${GITHUB_BASE}/api/productos.json`);
            if (catRes.ok) catalogo = await catRes.json();
        } catch (e) { console.error("Error catálogo"); }

        // 3. Pedir a la IA que formatee los productos y precios
        const promptPrecios = `
        Basado en este pedido: "${orderData["Productos"]}" y este catálogo: ${JSON.stringify(catalogo)}, 
        genera una lista detallada con precios y el total final.
        Formato:
        Cant x Producto .... $Precio
        Total $Suma
        
        Responde SOLO la lista, sin textos extra.
        `;

        // Intentamos Grok, si falla usamos Gemini (IA_PROVIDER)
        let listaDetallada = "";
        if (IA_PROVIDER === 'xai' || IA_PROVIDER === 'grok') {
            listaDetallada = await llamarXAI(promptPrecios, GROK_API_KEY);
        } else {
            listaDetallada = await llamarGemini(promptPrecios, GEMINI_API_KEY);
        }

        // Si la IA falla, usamos al menos el texto crudo del Excel para no enviar nada vacío
        if (!listaDetallada || listaDetallada.length < 5) {
            listaDetallada = orderData["Productos"];
        }

        // 4. Definir y enviar los 4 mensajes por separado
        const mensajes = [
            `${saludo} ${orderData["Cliente"]}.`,
            `Nos comunicamos para confirmar el siguiente pedido:\n\n${listaDetallada}`,
            `para:\n${orderData["Cliente"]}\nCELULAR: ${cleanPhone}\n${orderData["Dirección"]}\n${orderData["Ciudad"]}`,
            `Es correcto?`
        ];

        for (const msg of mensajes) {
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                body: JSON.stringify({ number: cleanPhone, text: msg })
            });
            await new Promise(r => setTimeout(r, 2000)); // Pausa de 2 segundos entre mensajes
        }

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("ERROR:", error.message);
        return response.status(200).json({ error: error.message });
    }
}

// --- FUNCIONES IA ---
async function llamarXAI(prompt, key) {
    try {
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "grok-beta", 
                messages: [{ role: "system", content: "Eres un experto en facturación. Solo devuelves listas de productos y precios." }, { role: "user", content: prompt }]
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) { return ""; }
}

async function llamarGemini(prompt, key) {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (e) { return ""; }
}
