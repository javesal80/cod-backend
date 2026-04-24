const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    console.log("--- INICIO DE PROCESO ---");

    if (!body?.data?.message || body.data.key.fromMe) {
        return response.status(200).send("Ignorado");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").trim();

    console.log(`1. 📞 Cliente: ${telefono} | Dijo: "${mensajeCliente}"`);

    try {
        // BUSCAR MEMORIA
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();
        if (!cliente) {
            console.log("❌ 2. Memoria: No encontrada en Supabase");
            return response.status(200).send("Sin memoria");
        }
        console.log(`✅ 2. Memoria: Encontrada (${cliente.nombre})`);

        // LLAMADA A GROK
        console.log("🧠 3. Llamando a Grok...");
        const resIA = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "grok-beta", 
                messages: [
                    { role: "system", content: "Eres Fiorella, asistente de JRJMarket. Responde con calidez." },
                    { role: "user", content: `Cliente compró ${cliente.datos_excel.Productos}. Dijo: ${mensajeCliente}. Responde:` }
                ]
            })
        });

        const dataIA = await resIA.json();
        
        // LOG DE RESPUESTA IA
        console.log("🤖 4. Respuesta Raw de Grok:", JSON.stringify(dataIA));

        const textoFinal = dataIA.choices?.[0]?.message?.content;
        if (!textoFinal) {
            console.log("❌ 5. Error: Grok no devolvió texto.");
            return response.status(200).send("Error IA");
        }
        console.log(`📝 5. Texto a enviar: "${textoFinal.substring(0, 40)}..."`);

        // ENVÍO A WHATSAPP
        const payload = { number: telefono, text: textoFinal };
        console.log("📤 6. Payload para Evolution:", JSON.stringify(payload));

        const resEnvio = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify(payload)
        });

        const resWhaBody = await resEnvio.text();
        
        // LOG DE RESULTADO FINAL
        console.log(`📡 7. Status Evolution: ${resEnvio.status}`);
        console.log(`📄 8. Respuesta Evolution Raw: ${resWhaBody}`);

        return response.status(200).json({ success: true });

    } catch (e) {
        console.error("🔥 ERROR CRÍTICO:", e.message);
        return response.status(200).send("Crash");
    }
};
