const { createClient } = require('@supabase/supabase-js');

module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO, 
        SUPABASE_URL, SUPABASE_KEY 
    } = process.env;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const orderData = request.body;

        console.log("🚀 [CONFIRMAR] Datos recibidos");

        // --- LÓGICA DE FECHAS DINÁMICAS (ECUADOR) ---
        const hoy = new Date();
        
        // Calcular Mañana
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);
        const opcionesFecha = { weekday: 'long', day: 'numeric', month: 'long' };
        const diaManana = manana.toLocaleDateString('es-EC', opcionesFecha); // Ej: "martes, 2 de junio"
        
        // Calcular Pasado Mañana
        const pasadoManana = new Date(hoy);
        pasadoManana.setDate(hoy.getDate() + 2);
        const diaPasado = pasadoManana.toLocaleDateString('es-EC', opcionesFecha); // Ej: "miércoles, 3 de junio"
    
    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // --- LÓGICA DE FECHAS DINÁMICAS PARA EL PROMPT ---
        const hoy = new Date();
        const opcionesFecha = { weekday: 'long', day: 'numeric', month: 'long' };
        
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);
        const diaManana = manana.toLocaleDateString('es-EC', opcionesFecha);
        
        const pasadoManana = new Date(hoy);
        pasadoManana.setDate(hoy.getDate() + 2);
        const diaPasado = pasadoManana.toLocaleDateString('es-EC', opcionesFecha);

        
       // Guardar en Supabase con instrucciones de flujo e instrucciones de calidez comerciales
        await supabase.from('memoria_clientes').upsert({
            telefono: cleanPhone,
            nombre: orderData["Cliente"],
            datos_excel: orderData,
            estado_pedido: 'esperando_confirmacion',
            ultima_interaccion: new Date(),
            // Guardamos el Prompt de comportamiento comercial para que el bot de WhatsApp lo lea
            instrucciones_bot: {
                tono: "Cálido, servicial, educado y extremadamente profesional. Saluda con entusiasmo y usa emojis de forma sutil (😊, 👋, 📦, 🚚). Evita sonar robótico.",
                fechas_entrega: `Entre mañana ${diaManana} y el ${diaPasado}.`,
                horario_entrega: "9:00 am a 5:00 pm",
                reglas_flujo: [
                    "1. El cliente debe validar su Nombre, Apellido, Ciudad, y Dirección.",
                    "2. SIEMPRE verifica que la dirección tenga 2 calles principales y una referencia clara (color de casa o negocio cercano). Si falta algo de esto, pídelo amablemente antes de confirmar el despacho.",
                    `3. Cuando los datos estén 100% completos, responde exactamente: 'Listo, procedemos al despacho del producto. Te estará llegando entre mañana ${diaManana} y el ${diaPasado} en el horario de entrega de 9:00 am a 5:00 pm. Nos comunicaremos contigo apenas esté cerca de la entrega.'`,
                    "4. OBJECIÓN DE HORARIO: Si el cliente dice que no pasa en casa en ese horario o trabaja, respóndele textualmente: 'Comprendo. Si se le dificulta el horario por tus ocupaciones, lo podemos entregar en otro lugar donde sí se encuentre en ese lapso de tiempo. O si desea, lo podemos dejar en una oficina de Servientrega cercana, en la cual usted lo podría retirar tranquilamente coordinando su tiempo y ocupaciones.'"
                ]
            }
        });
        

       // Formatear Lista de Productos limpia (Separados por guion)
        let productosRaw = orderData["Productos"] || "";
        let listaProductos = productosRaw.split(',').map(item => item.trim()).join(' - ');

        // ARMAR MENSAJE ÚNICO CON LÓGICA DE NEGOCIO
        const mensajeUnico = `¡Hola! ${orderData["Cliente"]}. ¡Qué gusto saludarle! 👋`,
                             `Nos comunicamos por confirmar el pedido de *${listaProductos}*.\n\n` +
                             `Por favor, ayúdanos *verificando* si sus datos son correctos:\n\n` +
                             `👤 *Nombre:* ${orderData["Cliente"]}\n` +
                             `📍 *Ciudad:* ${orderData["Ciudad"]}\n` +
                             `🏠 *Dirección:* ${orderData["Dirección"]}\n` +
                             `📌 *Referencia:* _(Respóndenos indicando una calle principal, color de casa o negocio cercano)_\n\n` +
                            `¿Nos confirma si todo está correcto para proceder al despacho por fvor? 😊`;

       // Enviar un único mensaje de WhatsApp
        await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
            body: JSON.stringify({ number: cleanPhone, text: mensajeInicial })
        });

        return response.status(200).json({ success: true });
    }
};
