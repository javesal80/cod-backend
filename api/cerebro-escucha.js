const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    // 1. FILTRO DE ENTRADA (Igual al bot funcional)
    if (!body?.data?.message || body.data.key.fromMe) {
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").trim();

    try {
        // 2. RECUPERAR MEMORIA
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();
        if (!cliente) return response.status(200).send("No cliente");

        const productos = cliente.datos_excel.Productos;

        // 3. FORMATO DE ENVÍO A GROK (Estructura exacta de Fiorella)
        const gResponse = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROK_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "grok-beta",
                "messages": [
                    {
                        "role": "system",
                        "content": "Eres Fiorella, una asistente de ventas cálida, persuasiva y experta en salud de JRJMarket. Tu objetivo es ayudar al cliente y salvar ventas usando neuromarketing. Usa emoticons y un tono amable."
                    },
                    {
                        "role": "user",
                        "content": `Contexto: El cliente compró ${productos}. \nPregunta del cliente: "${mensajeCliente}" \n\nResponde como Fiorella:`
                    }
                ],
                "temperature": 0.7,
                "stream": false
            })
        });

        const gData = await gResponse.json();
        
        // 4. EXTRACCIÓN DEL CONTENIDO (Formato Grok)
        const textoIA = gData.choices[0].message.content;

        // 5. FORMATO DE RESPUESTA A EVOLUTION
        const resEvolution = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": EVOLUTION_TOKEN
            },
            body: JSON.stringify({
                "number": telefono,
                "text": textoIA,
                "delay": 1200, // Simula escritura
                "linkPreview": true
            })
        });

        console.log(`✅ Respuesta enviada. Status: ${resEvolution.status}`);
        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 Error en formato Fiorella:", error.message);
        return response.status(200).send("Error");
    }
};
