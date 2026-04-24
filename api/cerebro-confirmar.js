const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const orderData = request.body;

    console.log("🚀 [CONFIRMAR] Datos recibidos");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // Guardar en Supabase
        await supabase.from('memoria_clientes').upsert({
            telefono: cleanPhone,
            nombre: orderData["Cliente"],
            datos_excel: orderData,
            estado_pedido: 'esperando_confirmacion',
            ultima_interaccion: new Date()
        });

        // Formatear Lista
        let productosRaw = orderData["Productos"] || "";
        let listaVertical = productosRaw.split(',').map(item => `✅ ${item.trim()}`).join('\n');

        const mensajes = [
            `¡Hola! ${orderData["Cliente"]}. ¡Qué gusto saludarte! 👋`,
            `Resumen de tu pedido: 📦\n\n${listaVertical}`,
            `📍 *Para:* ${orderData["Cliente"]}\n🏠 *Dirección:* ${orderData["Dirección"]}`,
            `¿Los datos son correctos para proceder? 😊`
        ];

        // Enviar WhatsApp
        for (const msg of mensajes) {
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                body: JSON.stringify({ number: cleanPhone, text: msg })
            });
            await new Promise(r => setTimeout(r, 1500));
        }

        return response.status(200).json({ success: true });
    } catch (e) {
        console.log("🔥 Error:", e.message);
        return response.status(200).json({ error: e.message });
    }
};
