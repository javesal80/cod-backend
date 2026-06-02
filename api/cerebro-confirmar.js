const { OpenAI } = require('openai'); // Usamos OpenAI como en tu webhook

module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO, 
        OPENAI_API_KEY 
    } = process.env;

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const orderData = request.body;

    console.log("🚀 [CEREBRO-CONFIRMAR] Procesando confirmación con IA");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── FECHA ECUADOR (Misma lógica exacta de tu webhook) ──────────────────
        const utc = new Date().getTime() + (new Date().getTimezoneOffset() * 60000);
        const hoy = new Date(utc + (3600000 * -5));
        const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
        
        let d1 = new Date(hoy); d1.setDate(hoy.getDate() + 1);
        if (d1.getDay() === 0) d1.setDate(d1.getDate() + 1);
        if (d1.getDay() === 6) d1.setDate(d1.getDate() + 2);
        
        let d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
        if (d2.getDay() === 0) d2.setDate(d2.getDate() + 1);
        if (d2.getDay() === 6) d2.setDate(d2.getDate() + 2);
        
        const mañana = dias[d1.getDay()];
        const pasado = dias[d2.getDay()];

        // Formatear Lista de Productos
        let productosRaw = orderData["Productos"] || "";
        let listaProductos = productosRaw.split(',').map(item => item.trim()).join(' - ');

        // ─── MASTER PROMPT PARA EL CEREBRO DE CONFIRMACIÓN ─────────────────────
        const masterPromptConfirmar = `
Eres Fiorella, asesora de servicio al cliente de VitaeLAB. Tu tono debe ser súper cálido, sumamente educado, servicial y profesional. Usa emojis (😊, 👋, 📦, 🚚). Tratamos de USTED.

A diferencia del canal de ventas, AQUÍ EL CLIENTE YA COMPRÓ. Ya dejó sus datos en la landing page y están registrados en nuestra hoja de Google Sheets. Tu única misión en este mensaje inicial es revisar esos datos y armar el mensaje de confirmación correcto.

REGLAS OBLIGATORIAS DE EVALUACIÓN:
1. Revisa si el cliente proporcionó su Nombre y Apellido completo, Ciudad, y una Dirección que incluya obligatoriamente DOS CALLES PRINCIPALES (una intersección clara con la letra 'y' o 'entre') y una REFERENCIA de su casa o negocio.

2. ESCENARIO DATOS CORRECTOS: Si consideras que la dirección está completa y tiene las dos calles con su referencia, confirma los datos de manera muy amable y dile EXACTAMENTE este speech de despacho:
"Listo, procedemos al despacho del producto. Te estará llegando entre mañana *${mañana}* y el *${pasado}* en el horario de entrega de *9:00 am a 5:00 pm*. Nos comunicaremos contigo apenas esté cerca de la entrega. 😊 Muchas gracias por tu confianza, por favor dale las gracias y dile que se procederá con el despacho del pedido y que esté atento a su número de contacto."

3. ESCENARIO DATOS INCOMPLETOS: Si notas que la dirección es vaga (solo puso una calle, no hay intersección clara 'y' o 'entre', o no dejó ninguna referencia), debes saludar amablemente por su pedido de *${listaProductos}*, mostrarle los datos que dejó y pedirle de favor que te ayude indicándote las 2 calles principales y una referencia clara para que el motorizado pueda llegar sin problemas.

⚠️ REGLA DE HORARIO/SERVIENTREGA: Deja siempre claro el horario de 9:00 am a 5:00 pm. Si de forma preventiva quieres ofrecer la alternativa por si trabaja, o si el contexto lo requiere, recuerda que si no puede en ese horario le podemos entregar en una oficina de Servientrega cercana para que lo retire tranquilamente coordinando su tiempo.

FORMATO DE RESPUESTA — OBLIGATORIO (Igual al Webhook):
{"etapa":"CONFIRMADO","mensaje":"Tu mensaje aquí"}
Solo devuelve JSON puro, sin introducciones ni bloques de código markdown.
`;

        const userContent = `Datos del cliente recuperados del Google Sheet:
- Cliente: ${orderData["Cliente"]}
- Ciudad: ${orderData["Ciudad"]}
- Dirección: ${orderData["Dirección"]}
- Producto pedido: ${listaProductos}`;

        // ─── LLAMADA A LA IA ───────────────────────────────────────────────
        const completion = await openai.chat.completions.create({
            model: "gpt-4o", // Usa gpt-4o igual que tu webhook en modo openai
            messages: [
                { role: "system", content: masterPromptConfirmar },
                { role: "user", content: userContent }
            ],
            temperature: 0.5
        });

        const respuestaRaw = completion.choices[0].message.content || "";
        console.log("[IA RAW CONFIRMAR]", respuestaRaw);

        // ─── PARSEAR E INYECTAR MENSAJE (Espejo de tu Webhook) ──────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            parsed = JSON.parse(clean);
        } catch (e) {
            console.error("Error parseando JSON de la IA");
        }

        if (parsed && parsed.mensaje) {
            const textoFinal = parsed.mensaje;

            // Enviar el mensaje único generado de forma inteligente por la Evolution API
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                body: JSON.stringify({ number: cleanPhone, text: textoFinal })
            });
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
