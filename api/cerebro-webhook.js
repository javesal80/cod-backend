import { createClient } from '@supabase/supabase-js';

export default async function handler(request, response) {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    // Validar que sea un mensaje entrante y no una respuesta del bot
    if (!body.data || !body.data.message || body.data.key.fromMe) return response.status(200).send("OK");

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = body.data.message.conversation || body.data.message.extendedTextMessage?.text || "";

    try {
        // 1. Consultar la memoria de este cliente
        const { data: cliente, error } = await supabase
            .from('memoria_clientes')
            .select('*')
            .eq('telefono', telefono)
            .single();

        if (!cliente) return response.status(200).send("No es un cliente de despacho");

        // 2. Prompt con Memoria y Validación Logística
        const promptIA = `
            Eres Fiorella de JRJMarket. Estás confirmando un despacho.
            DATOS DEL PEDIDO ORIGINAL: ${JSON.stringify(cliente.datos_excel)}
            DIRECCIÓN ACTUAL: "${cliente.datos_excel.Dirección}"
            MENSAJE DEL CLIENTE: "${mensajeCliente}"

            TAREAS SEGÚN LA RESPUESTA:
            - Si dice "Si", "Correcto" o confirma: Analiza la dirección. Si le falta calle secundaria o referencia, dile: "¡Genial! Pero por favor ayúdenos con el lugar de entrega exacto, solo tengo esto: ${cliente.datos_excel.Dirección}. Para que Servientrega llegue rápido, ¿me confirma la calle secundaria o una referencia?"
            - Si dice "Ya no deseo" o cancela: Usa neuromarketing. No seas pesada, ofrece ayuda o pregunta si tiene dudas de salud para intentar salvar la venta.
            - Si da la dirección que faltaba: Agradece y confirma que procedes al despacho.
            
            Tono: Humano, cálido, modo WhatsApp, usa emojis.
        `;

        const respuestaIA = await llamarGrok(promptIA, GROK_API_KEY);

        // 3. Responder por WhatsApp
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: telefono, text: respuestaIA })
        });

        // 4. Actualizar historial en Supabase (Opcional pero recomendado)
        await supabase.from('memoria_clientes').update({ 
            ultima_interaccion: new Date() 
        }).eq('telefono', telefono);

        return response.status(200).json({ success: true });

    } catch (err) {
        console.error("Error en Webhook:", err.message);
        return response.status(200).send("Error");
    }
}

async function llamarGrok(prompt, key) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: "grok-beta", 
            messages: [
                { role: "system", content: "Eres Fiorella, asistente cálida y logística de JRJMarket." },
                { role: "user", content: prompt }
            ]
        })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "Disculpe, ¿me podría repetir eso? 😊";
}
