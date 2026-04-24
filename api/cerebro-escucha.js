const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY, GROK_API_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const body = request.body;

    if (!body || !body.data || !body.data.message || body.data.key.fromMe) {
        return response.status(200).send("OK");
    }

    const telefono = body.data.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensajeCliente = (body.data.message.conversation || body.data.message.extendedTextMessage?.text || "").toLowerCase();

    try {
        const { data: cliente } = await supabase.from('memoria_clientes').select('*').eq('telefono', telefono).single();
        if (!cliente) return response.status(200).send("OK");

        let promptIA = `Eres Fiorella. El cliente dice "${mensajeCliente}" sobre su pedido de ${cliente.datos_excel.Productos}. Responde con calidez y emoticons. Si dice NO, trata de salvar la venta con neuromarketing.`;

        const resIA = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "grok-beta", 
                messages: [{ role: "system", content: "Eres Fiorella, asistente de ventas." }, { role: "user", content: promptIA }]
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
    } catch (e) {
        return response.status(200).send("OK");
    }
};
