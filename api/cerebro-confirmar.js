const { createClient } = require('@supabase/supabase-js');

export default async function handler(request, response) {
    // --- CONFIGURACIÓN DE CORS (MANTENIDO) ---
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, TOKEN_DESPACHO, EVOLUTION_TOKEN, 
        SUPABASE_URL, SUPABASE_KEY 
    } = process.env;

    const apikeyFinal = TOKEN_DESPACHO || EVOLUTION_TOKEN;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const orderData = request.body;

    // --- LOG 1: LLEGADA DESDE LA WEB ---
    console.log("🚀 [INICIO] Datos recibidos del Excel/Landing");

    try {
        if (!orderData || !orderData["Teléfono"]) {
            console.log("⚠️ [ERROR] No se recibió teléfono en el body");
            return response.status(200).json({ success: false });
        }

        // 1. Limpieza de Teléfono y Saludo (MANTENIDO)
        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const hora = new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil", hour: 'numeric', hour12: false});
        let saludo = (hora >= 5 && hora < 12) ? "¡Muy buenos días! ☀️" : (hora >= 12 && hora < 19) ? "¡Buenas tardes! ✨" : "¡Hola, muy buenas noches! 🌙";

        // --- LOG 2: GUARDADO EN MEMORIA ---
        console.log(`💾 [SUPABASE] Intentando guardar memoria para: ${cleanPhone}`);
        
        const { error: errorSupa } = await supabase.from('memoria_clientes').upsert({
            telefono: cleanPhone,
            nombre: orderData["Cliente"],
            datos_excel: orderData,
            estado_pedido: 'esperando_confirmacion',
            ultima_interaccion: new Date()
        });

        if (errorSupa) {
            console.error("❌ [SUPABASE ERROR]:", errorSupa.message);
        } else {
            console.log("✅ [SUPABASE] Datos guardados correctamente en la tabla.");
        }

        // 2. Formateo de Lista Vertical (MANTENIDO)
        let productosRaw = orderData["Productos"] || "";
        let listaVertical = productosRaw.split(',')
            .map(item => {
                let nombre = item.trim();
                if (nombre.toLowerCase().includes("kidgrow")) return `✅ ${nombre} (Crecimiento) 🚀`;
                if (nombre.toLowerCase().includes("magnesio")) return `✅ ${nombre} (Bienestar) ✨`;
                if (nombre.toLowerCase().includes("shilajit")) return `✅ ${nombre} (Vitalidad) 🏔️`;
                return `✅ ${nombre}`;
            }).join('\n');

        // 3. Los 4 Mensajes (MANTENIDO)
        const mensajes = [
            `${saludo} ${orderData["Cliente"]}. ¡Qué gusto saludarte! 👋`,
            `Estamos felices de procesar tu compra. Aquí tienes el resumen de tu pedido: 📦\n\n${listaVertical}`,
            `Lo estaremos enviando a estos datos:\n\n📍 *Para:* ${orderData["Cliente"]}\n📱 *Celular:* ${cleanPhone}\n🏠 *Dirección:* ${orderData["Dirección"]}\n🏙️ *Ciudad:* ${orderData["Ciudad"]}`,
            `¿Los datos son correctos para proceder con tu despacho? 😊`
        ];

        // --- LOG 3: ENVÍO WHATSAPP ---
        console.log(`📤 [WHATSAPP] Iniciando envío de los 4 mensajes a ${cleanPhone}...`);

        for (const msg of mensajes) {
            const res = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': apikeyFinal },
                body: JSON.stringify({ number: cleanPhone, text: msg })
            });
            
            if (res.ok) {
                console.log(`✅ Mensaje enviado OK`);
            } else {
                console.log(`❌ Error enviando mensaje: ${res.status}`);
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log("🏁 [FIN] Proceso de confirmación terminado.");
        return response.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 [CRASH CEREBRO-CONFIRMAR]:", error.message);
        return response.status(200).json({ error: error.message });
    }
}
