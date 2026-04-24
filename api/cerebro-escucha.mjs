import { createClient } from '@supabase/supabase-js';

export default async function handler(request, response) {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    console.log("🚀 [LOG] Petición recibida en Cerebro-Escucha (MJS)");

    if (!body.data || !body.data.message || body.data.key.fromMe) {
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").toLowerCase();

    try {
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();

        if (!cliente) return response.status(200).send("No es cliente");

        const datos = cliente.datos_excel;
        const direccionActual = datos.Dirección || "";
        const tieneEstructuraVálida = /( y | entre | junto a | frente a | mz | villa | casa | lote | piso )/i.test(direccionActual);

        let promptIA = "";

        if (mensajeCliente.includes("si") || mensajeCliente.includes("correcto") || mensajeCliente.includes("ok")) {
            if (!tieneEstructuraVálida) {
                promptIA = `Eres Fiorella. El cliente confirmó el pedido, pero su dirección "${direccionActual}" está incompleta. Pide calle secundaria o referencia detallada con calidez y emojis.`;
            } else {
                promptIA = `Eres Fiorella. El cliente confirmó y la dirección está OK. Agradece y confirma despacho inmediato con emojis.`;
            }
        } 
        else if (mensajeCliente.includes("no") || mensajeCliente.includes("cancela") || mensajeCliente.includes("deseo")) {
            promptIA = `Eres Fiorella. El cliente ya no desea ${datos.Productos}. Usa neuromarketing: pregunta qué pasó con empatía, recuerda beneficios de salud y trata de salvar la venta.`;
        }
        else {
            promptIA = `Eres Fiorella. Responde a: "${mensajeCliente}" sobre su compra de ${datos.Productos} con calidez.`;
        }

        const resIA = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "grok-beta", 
                messages: [{ role: "system", content: "Eres Fiorella, asistente cálida y persuasiva." }, { role: "user", content: promptIA }]
            })
        });

        const dataIA = await resIA.json();
        const textoFinal = dataIA.choices?.[0]?.message?.content;

        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: telefono, text: textoFinal })
        });

        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 [ERROR]:", error.message);
        return response.status(200).send("OK");
    }
}
