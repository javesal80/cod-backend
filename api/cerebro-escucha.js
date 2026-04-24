const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    // 1. Filtro de entrada
    if (!body?.data?.message || body.data.key.fromMe) return response.status(200).send("OK");

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").trim();

    try {
        // 2. Buscar datos del cliente
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();
        if (!cliente) return response.status(200).send("Sin memoria");

        const productos = cliente.datos_excel.Productos;

        // 3. Llamada a Grok con formato RESPONSES (Tu formato específico)
        // Nota: Agregamos las instrucciones de Fiorella directamente en el input
        const promptFinal = `Eres Fiorella, asistente persuasiva de JRJMarket. 
        Contexto: El cliente compró ${productos}. 
        Pregunta del cliente: "${mensajeCliente}". 
        REGLA: Si dice que NO, sé empática y trata de salvar la venta. 
        Responde brevemente:`;

        const resIA = await fetch('https://api.x.ai/v1/responses', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${GROK_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                "model": "grok-4.20-reasoning", 
                "input": promptFinal
            })
        });

        const dataIA = await resIA.json();
        
        // 4. Extracción de respuesta según el formato de "responses"
        // Normalmente este formato devuelve { "message": "texto" } o { "output": "texto" }
        // Según tu curl, Grok responde en el campo "message" o directamente el texto.
        const textoIA = dataIA.message || dataIA.output || (dataIA.choices && dataIA.choices[0].text);

        if (!textoIA) {
            console.log("❌ Error en formato Grok:", JSON.stringify(dataIA));
            return response.status(200).send("Error IA");
        }

        // 5. Envío a WhatsApp via Evolution
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
            body: JSON.stringify({ 
                number: telefono, 
                text: textoIA.trim()
            })
        });

        return response.status(200).json({ success: true });

    } catch (e) {
        console.error("🔥 Crash:", e.message);
        return response.status(200).send(e.message);
    }
};
