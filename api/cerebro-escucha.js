const { createClient } = require('@supabase/supabase-js');

module.exports = async function (request, response) {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    console.log("🚀 [LOG] Petición recibida en Cerebro-Escucha");

    // 1. Filtro de seguridad
    if (!body.data || !body.data.message || body.data.key.fromMe) {
        console.log("⏭️ [LOG] Mensaje omitido");
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").toLowerCase();

    console.log(`💬 [LOG] Mensaje de: ${telefono} | Texto: "${mensajeCliente}"`);

    try {
        // 2. BUSCAR EN MEMORIA
        console.log(`🔍 [LOG] Buscando memoria para: ${telefono}`);
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();

        if (!cliente) {
            console.log("⚠️ [LOG] No se encontró al cliente en Supabase");
            return response.status(200).send("No es cliente");
        }

        const datos = cliente.datos_excel;
        const direccionActual = datos.Dirección || "";
        const tieneEstructuraVálida = /( y | entre | junto a | frente a | mz | villa | casa | lote | piso )/i.test(direccionActual);

        let promptIA = "";

        // CASO A: EL CLIENTE CONFIRMA
        if (mensajeCliente.includes("si") || mensajeCliente.includes("correcto") || mensajeCliente.includes("ok")) {
            if (!tieneEstructuraVálida) {
                promptIA = `Eres Fiorella. El cliente confirmó el pedido, pero su dirección "${direccionActual}" está incompleta. Tu tarea es decirle exactamente esto con tu calidez: '¡Excelente! Por favor ayudenos con el lugar de entrega solo tengo esto: ${direccionActual}. Para una entrega más eficaz ayúdame con la calle secundaria o una referencia detallada de tu casa.' Usa emojis de ubicación y casa.`;
            } else {
                promptIA = `Eres Fiorella. El cliente confirmó y su dirección parece buena. Agradece con calidez y dile que procedes al despacho inmediato para que le llegue pronto. Usa emojis de camión y felicidad.`;
            }
        } 
        
        // CASO B: EL CLIENTE YA NO QUIERE (Revendedora con Neuromarketing)
        else if (mensajeCliente.includes("no") || mensajeCliente.includes("cancela") || mensajeCliente.includes("deseo")) {
            promptIA = `Eres Fiorella. El cliente dice que ya no desea el pedido de ${datos.Productos}. Tu misión es NO rendirte pero sin ser pesada. Aplica neuromarketing: 1. Pregunta con mucha empatía qué pasó o si tiene alguna duda con el beneficio del producto. 2. Recuérdale brevemente por qué ${datos.Productos} es bueno para su salud. 3. Ayúdale, no solo quieras vender. Trata de salvar la venta con calidez.`;
        }

        // CASO C: SOPORTE
        else {
            promptIA = `Eres Fiorella. El cliente pregunta: "${mensajeCliente}". Usa los datos de su compra (${datos.Productos}) para responder con autoridad y calidez. Mantén siempre la persuasión y los emoticons que te caracterizan.`;
        }

        // 3. LLAMAR A GROK
        console.log("🧠 [LOG] Consultando a la IA...");
        const resIA = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "grok-beta", 
                messages: [
                    { role: "system", content: "Eres Fiorella, asistente cálida y persuasiva de JRJMarket. Usas emoticons y aplicas neuromarketing." },
                    { role: "user", content: promptIA }
                ]
            })
        });

        const dataIA = await resIA.json();
        const textoFinal = dataIA.choices?.[0]?.message?.content;

        // 4. ENVIAR A WHATSAPP
        console.log("📤 [LOG] Enviando respuesta a WhatsApp...");
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: telefono, text: textoFinal })
        });

        await supabase.from('memoria_clientes').update({ ultima_interaccion: new Date() }).eq('telefono', telefono);

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 [ERROR]:", error.message);
        return response.status(200).send("OK");
    }
};
