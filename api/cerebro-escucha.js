const { createClient } = require('@supabase/supabase-js');

export default async function handler(request, response) {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    // --- LOG 1: ENTRADA ---
    console.log("🚀 [WEBHOOK] Petición recibida desde Evolution");

    // 1. Filtro de seguridad: Solo mensajes entrantes del cliente
    if (!body.data || !body.data.message || body.data.key.fromMe) {
        console.log("⏭️ [LOG] Mensaje omitido (es saliente o no tiene contenido)");
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").toLowerCase();

    console.log(`💬 [LOG] Mensaje de: ${telefono} | Texto: "${mensajeCliente}"`);

    try {
        // --- LOG 2: BASE DE DATOS ---
        console.log(`🔍 [LOG] Buscando en Supabase memoria para: ${telefono}`);
        
        // 2. BUSCAR EN MEMORIA (Qué compró y qué dirección dio)
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();

        if (!cliente) {
            console.log("⚠️ [LOG] Cliente NO encontrado en memoria de despacho.");
            return response.status(200).send("No es cliente de despacho");
        }

        console.log("✅ [LOG] Cliente localizado. Datos Excel recuperados.");

        const datos = cliente.datos_excel;
        const direccionActual = datos.Dirección || "";
        
        // 3. LÓGICA DE VALIDACIÓN DE DIRECCIÓN (Calles y Referencia)
        const tieneEstructuraVálida = /( y | entre | junto a | frente a | mz | villa | casa | lote | piso )/i.test(direccionActual);

        let promptIA = "";

        // CASO A: EL CLIENTE CONFIRMA
        if (mensajeCliente.includes("si") || mensajeCliente.includes("correcto") || mensajeCliente.includes("ok")) {
            console.log("🤖 [IA] Rama: Confirmación de pedido.");
            if (!tieneEstructuraVálida) {
                promptIA = `Eres Fiorella. El cliente confirmó el pedido, pero su dirección "${direccionActual}" está incompleta. Tu tarea es decirle exactamente esto con tu calidez: '¡Excelente! Por favor ayudenos con el lugar de entrega solo tengo esto: ${direccionActual}. Para una entrega más eficaz ayúdame con la calle secundaria o una referencia detallada de tu casa.' Usa emojis de ubicación y casa.`;
            } else {
                promptIA = `Eres Fiorella. El cliente confirmó y su dirección parece buena. Agradece con calidez y dile que procedes al despacho inmediato para que le llegue pronto. Usa emojis de camión y felicidad.`;
            }
        } 
        
        // CASO B: EL CLIENTE YA NO QUIERE (Revendedora con Neuromarketing)
        else if (mensajeCliente.includes("no") || mensajeCliente.includes("cancela") || mensajeCliente.includes("deseo")) {
            console.log("🤖 [IA] Rama: Reventa/Cancelación.");
            promptIA = `Eres Fiorella. El cliente dice que ya no desea el pedido de ${datos.Productos}. Tu misión es NO rendirte pero sin ser pesada. Aplica neuromarketing: 1. Pregunta con mucha empatía qué sucedió o si tiene alguna duda con el beneficio del producto. 2. Recuérdale brevemente por qué ${datos.Productos} es bueno para su salud. 3. Ayúdale, no solo quieras vender. Trata de salvar la venta con calidez.`;
        }

        // CASO C: SOPORTE / PREGUNTAS / POSTVENTA
        else {
            console.log("🤖 [IA] Rama: Otros/Soporte.");
            promptIA = `Eres Fiorella. El cliente pregunta: "${mensajeCliente}". Usa los datos de su compra (${datos.Productos}) para responder con autoridad y calidez. Mantén siempre la persuasión y los emoticons que te caracterizan.`;
        }

        // --- LOG 3: LLAMADA IA ---
        console.log("🧠 [LOG] Llamando a Grok...");

        // 4. GENERAR RESPUESTA CON GROK
        const respuestaIA = await llamarGrok(promptIA, GROK_API_KEY);

        console.log("📤 [LOG] Enviando respuesta a WhatsApp.");

        // 5. ENVIAR A WHATSAPP
        const resWhats = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: telefono, text: respuestaIA })
        });

        if (resWhats.ok) {
            console.log("🎯 [LOG] Mensaje enviado con éxito.");
        } else {
            console.error("❌ [LOG ERROR WhatsApp] Status:", resWhats.status);
        }

        // Actualizamos la última interacción en la memoria
        await supabase.from('memoria_clientes').update({ ultima_interaccion: new Date() }).eq('telefono', telefono);

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 [CRASH LOG]:", error.message);
        return response.status(200).send("OK");
    }
}

async function llamarGrok(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [
                { role: "system", content: "Eres Fiorella, asistente cálida y persuasiva de JRJMarket. Usas emoticons, validas logística y aplicas neuromarketing." },
                { role: "user", content: prompt }
            ]
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "Disculpe, ¿me podría repetir? 😊";
}
