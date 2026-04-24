import { createClient } from '@supabase/supabase-js';

export default async function handler(request, response) {
    // --- CONFIGURACIÓN DE CORS (MANTENIDO) ---
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, TOKEN_DESPACHO, EVOLUTION_TOKEN, 
        IA_PROVIDER, GEMINI_API_KEY, OPENAI_API_KEY, GROK_API_KEY,
        GITHUB_USER, GITHUB_REPO, SUPABASE_URL, SUPABASE_KEY 
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Rutas de GitHub (Mantenidas directas para evitar errores)
    const user = "javesal80"; 
    const repo = "cod-backend";
    const GITHUB_BASE = `https://raw.githubusercontent.com/${user}/${repo}/main`;

    const orderData = request.body;

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        // 1. Limpieza de Teléfono y Saludo con Energía (MANTENIDO)
        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const hora = new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil", hour: 'numeric', hour12: false});
        let saludo = (hora >= 5 && hora < 12) ? "¡Muy buenos días! ☀️" : (hora >= 12 && hora < 19) ? "¡Buenas tardes! ✨" : "¡Hola, muy buenas noches! 🌙";

        // --- 2. ADHERIR MEMORIA (NUEVO) ---
        // Guardamos los datos del Excel en Supabase para que el Robot tenga referencia postventa
        await supabase.from('memoria_clientes').upsert({
            telefono: cleanPhone,
            nombre: orderData["Cliente"],
            datos_excel: orderData,
            estado_pedido: 'esperando_confirmacion',
            ultima_interaccion: new Date()
        });

        // 3. Conexión con GitHub para Protocolos (MANTENIDO)
        let catalogo = { PRODUCTOS: [] };
        try {
            const catRes = await fetch(`${GITHUB_BASE}/api/productos.json`);
            if (catRes.ok) catalogo = await catRes.json();
        } catch (e) { console.error("Error GitHub"); }

        // 4. Lógica de Lista Vertical con Neuromarketing y Emoticones (MANTENIDO)
        let productosRaw = orderData["Productos"] || "";
        let listaVertical = productosRaw.split(',')
            .map(item => {
                let nombre = item.trim();
                if (nombre.toLowerCase().includes("kidgrow")) return `✅ ${nombre} (Crecimiento y Nutrición) 🚀`;
                if (nombre.toLowerCase().includes("magnesio")) return `✅ ${nombre} (Bienestar y Energía) ✨`;
                if (nombre.toLowerCase().includes("shilajit")) return `✅ ${nombre} (Vitalidad Natural) 🏔️`;
                return `✅ ${nombre}`;
            }).join('\n');

        // 5. Definición de los 4 Mensajes (MANTENIDO)
        const mensajes = [
            `${saludo} ${orderData["Cliente"]}. ¡Qué gusto saludarte! 👋`,
            `Estamos felices de procesar tu compra. Aquí tienes el resumen de tu pedido: 📦\n\n${listaVertical}`,
            `Lo estaremos enviando a estos datos:\n\n📍 *Para:* ${orderData["Cliente"]}\n📱 *Celular:* ${cleanPhone}\n🏠 *Dirección:* ${orderData["Dirección"]}\n🏙️ *Ciudad:* ${orderData["Ciudad"]}`,
            `¿Los datos son correctos para proceder con tu despacho? 😊`
        ];

        // 6. Envío Secuencial con Delays (MANTENIDO)
        for (const msg of mensajes) {
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                body: JSON.stringify({ number: cleanPhone, text: msg })
            });
            await new Promise(r => setTimeout(r, 2500));
        }

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return response.status(200).json({ error: error.message });
    }
}

// --- FUNCIONES IA (MANTENIDAS: GEMINI, OPENAI, GROK) ---
async function llamarXAI(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [{ role: "system", content: "Eres Fiorella, asistente de JRJMarket. Persuasiva, cálida y servicial." }, { role: "user", content: prompt }]
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
