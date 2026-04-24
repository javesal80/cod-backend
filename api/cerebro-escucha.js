const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    console.log("-----------------------------------------");
    console.log("🚀 [PASO 1] WEBHOOK RECIBIDO");

    if (!body?.data?.message || body.data.key.fromMe) {
        console.log("⏭️ [LOG] Mensaje omitido (es propio o sin texto)");
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").trim();
    
    console.log(`👤 [CLIENTE]: ${telefono}`);
    console.log(`💬 [MENSAJE]: "${mensajeCliente}"`);

    try {
        // BUSCAR EN SUPABASE
        const { data: cliente, error: errorSupa } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();
        
        if (errorSupa || !cliente) {
            console.log("❌ [ERROR SUPABASE]: No se encontró memoria para este número.");
            return response.status(200).send("No memo");
        }

        console.log("✅ [PASO 2] MEMORIA RECUPERADA:", cliente.nombre);

        // PREPARAR LLAMADA A IA
        const promptIA = `Eres Fiorella. El cliente compró ${cliente.datos_excel.Productos} y dice: "${mensajeCliente}". Responde con calidez y neuromarketing.`;
        
        console.log("🧠 [PASO 3] ENVIANDO A GROK...");

        const gResponse = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROK_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "grok-beta",
                "messages": [
                    { "role": "system", "content": "Eres Fiorella, asistente de JRJMarket." },
                    { "role": "user", "content": promptIA }
                ],
                "temperature": 0.7
            })
        });

        const gData = await gResponse.json();
        
        // --- LOG DE RESPUESTA DE IA ---
        console.log("🤖 [GROK RESPONSE]:", JSON.stringify(gData));

        if (!gData.choices || !gData.choices[0]) {
            console.log("❌ [ERROR IA]: Grok no devolvió texto.");
            return response.status(200).send("IA Error");
        }

        const textoIA = gData.choices[0].message.content;
        console.log(`📝 [TEXTO GENERADO]: "${textoIA.substring(0, 50)}..."`);

        // ENVÍO A WHATSAPP
        console.log("📤 [PASO 4] ENVIANDO A EVOLUTION API...");
        
        const payloadWha = {
            "number": telefono,
            "text": textoIA,
            "delay": 1000,
            "linkPreview": true
        };

        console.log("📦 [PAYLOAD WHATSAPP]:", JSON.stringify(payloadWha));

        const resEvolution = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": EVOLUTION_TOKEN
            },
            body: JSON.stringify(payloadWha)
        });

        const resWhaText = await resEvolution.text();
        console.log(`📡 [STATUS EVOLUTION]: ${resEvolution.status}`);
        console.log(`📄 [RESPUESTA EVOLUTION]: ${resWhaText}`);

        console.log("🏁 [FIN] PROCESO COMPLETADO");
        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 [CRASH CRÍTICO]:", error.message);
        return response.status(200).send("Crash");
    }
};
