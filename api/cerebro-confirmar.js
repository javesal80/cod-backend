export default async function handler(request, response) {
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, TOKEN_DESPACHO, EVOLUTION_TOKEN, 
        IA_PROVIDER, GROK_API_KEY 
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const orderData = request.body;

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        // 1. Limpieza de Teléfono y Hora
        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const hora = new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil", hour: 'numeric', hour12: false});
        let saludo = "Buenos días";
        if (hora >= 12 && hora < 19) saludo = "Buenas tardes";
        if (hora >= 19 || hora < 5) saludo = "Buenas noches";

        // 2. IA para formatear la lista de precios y total (Grok)
        const promptPrecios = `
        A partir de estos productos: "${orderData["Productos"]}", genera una lista con precios individuales y un total. 
        Usa este estilo (ajusta los precios según tu lista real):
        2 Kidgrow por $35
        1 Magnesio por $18
        
        Total $53
        
        SOLO responde la lista y el total, nada más.
        `;

        const listaPrecios = await llamarXAI(promptPrecios, GROK_API_KEY);

        // 3. Definir los mensajes por separado
        const mensajes = [
            `${saludo} ${orderData["Cliente"]}.`,
            `Nos comunicamos para confirmar el siguiente pedido:\n\n${listaPrecios}`,
            `para:\n${orderData["Cliente"]}\nCELULAR: ${cleanPhone}\n${orderData["Dirección"]}\n${orderData["Ciudad"]}`,
            `Es correcto?`
        ];

        // 4. Función para enviar con delay (pausa entre mensajes)
        for (const msg of mensajes) {
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                body: JSON.stringify({ 
                    number: cleanPhone, 
                    text: msg,
                    delay: 1500 // Pausa de 1.5 seg entre mensajes para naturalidad
                })
            });
            // Pequeño tiempo de espera adicional en el bucle
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("ERROR:", error.message);
        return response.status(200).json({ error: error.message });
    }
}

// --- FUNCIÓN GROK ---
async function llamarXAI(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [{ role: "user", content: prompt }]
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}
