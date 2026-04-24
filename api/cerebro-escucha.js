const { createClient } = require('@supabase/supabase-js');

export default async function handler(request, response) {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    // --- LOG DE ENTRADA ---
    console.log("📥 [WEBHOOK] Señal recibida de Evolution API");

    if (!body.data || !body.data.message || body.data.key.fromMe) {
        console.log("⏭️ [LOG] Mensaje omitido (es un mensaje saliente o sin texto)");
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").toLowerCase();

    console.log(`💬 [LOG] Mensaje de: ${telefono} | Texto: "${mensajeCliente}"`);

    try {
        // --- BUSCAR EN MEMORIA ---
        console.log(`🔍 [LOG] Buscando en Supabase al cliente: ${telefono}`);
        const { data: clientes, error: errSupabase } = await supabase
            .from('memoria_clientes')
            .select('*')
            .eq('telefono', telefono);

        if (errSupabase) {
            console.error("❌ [LOG ERROR Supabase]:", errSupabase.message);
            return response.status(200).send("Error");
        }

        const cliente = clientes && clientes.length > 0 ? clientes[0] : null;

        if (!cliente) {
            console.log("⚠️ [LOG] El número no existe en la tabla de despacho (memoria_clientes)");
            return response.status(200).send("No es despacho");
        }

        console.log("✅ [LOG] Cliente hallado en memoria. Pedido:", cliente.datos_excel.Productos);

        const datos = cliente.datos_excel;
        const direccionActual = datos.Dirección || "";
        const tieneEstructuraVálida = /( y | entre | junto a | frente a | mz | villa | casa | lote | piso )/i.test(direccionActual);

        let promptIA = "";

        // CASO A: EL CLIENTE CONFIRMA
        if (mensajeCliente.includes("si") || mensajeCliente.includes("correcto") || mensajeCliente.includes("ok")) {
            console.log("🤖 [LOG] Rama: Confirmación de datos");
            if (!tieneEstructuraVálida) {
                promptIA = `Eres Fiorella. El cliente confirmó el pedido, pero su dirección "${direccionActual}" está incompleta. Tu tarea es decirle exactamente esto: '¡Excelente! Por favor ayudenos con el lugar de entrega solo tengo esto: ${direccionActual}. Para una entrega más eficaz ayúdame con la calle secundaria o una referencia detallada de tu casa.' Usa emojis.`;
            } else {
                promptIA = `Eres Fiorella. El cliente confirmó y la dirección está completa. Agradece y confirma despacho inmediato con emojis de felicidad.`;
            }
        } 
        
        // CASO B: EL CLIENTE YA NO QUIERE (REVENDEDORA)
        else if (mensajeCliente.includes("no") || mensajeCliente.includes("cancela") || mensajeCliente.includes("deseo")) {
            console.log("🤖 [LOG] Rama: Intento de cancelación");
            promptIA = `Eres Fiorella. El cliente dice que ya no desea el pedido de ${datos.Productos}. Tu misión es NO rendirte pero sin ser pesada. Aplica neuromarketing, pregunta con empatía qué pasó, recuérdale los beneficios de salud de forma persuasiva y trata de salvar la venta.`;
        }

        // CASO C: SOPORTE / OTROS
        else {
            console.log("🤖 [LOG] Rama: Otros / Soporte");
            promptIA = `Eres Fiorella. Responde cálidamente a: "${mensajeCliente}" basándote en que compró ${datos.Productos}.`;
        }

        // --- LLAMADA A GROK ---
        console.log("🧠 [LOG] Solicitando respuesta a Grok...");
        const resIA = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "grok-beta", 
                messages: [
                    { role: "system", content: "Eres Fiorella, asistente de JRJMarket. Persuasiva, cálida y usas muchos emoticons." },
                    { role: "user", content: promptIA }
                ]
            })
        });

        const dataIA = await resIA.json();
        const textoFinal = dataIA.choices?.[0]?.message?.content;

        if (!textoFinal) {
            console.error("❌ [LOG ERROR IA]: Grok no devolvió texto.");
            return response.status(200).send("Error IA");
        }

        console.log("📤 [LOG] Enviando respuesta final a WhatsApp");

        // --- ENVÍO FINAL ---
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: telefono, text: textoFinal })
        });

        await supabase.from('memoria_clientes').update({ ultima_interaccion: new Date() }).eq('telefono', telefono);

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 [LOG CRASH]:", error.message);
        return response.status(200).send("OK");
    }
}
