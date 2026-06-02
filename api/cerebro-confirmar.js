module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { 
        EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO, 
        OPENAI_API_KEY 
    } = process.env;

    const orderData = request.body;

    console.log("🚀 [CEREBRO-CONFIRMAR] Ejecutando IA con Prompt Comercial");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── FECHA ECUADOR (Misma lógica exacta de tu webhook) ──────────────────
        const utc  = new Date().getTime() + (new Date().getTimezoneOffset() * 60000);
        const hoy  = new Date(utc + (3600000 * -5));
        const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
        let d1 = new Date(hoy); d1.setDate(hoy.getDate() + 1);
        if (d1.getDay() === 0) d1.setDate(d1.getDate() + 1);
        if (d1.getDay() === 6) d1.setDate(d1.getDate() + 2);
        let d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
        if (d2.getDay() === 0) d2.setDate(d2.getDate() + 1);
        if (d2.getDay() === 6) d2.setDate(d2.getDate() + 2);
        const mañana = dias[d1.getDay()];
        const pasado  = dias[d2.getDay()];

        // Formatear Lista de Productos
        let productosRaw = orderData["Productos"] || "";
        let listaProductos = productosRaw.split(',').map(item => item.trim()).join(' - ');

        // ─── MASTER PROMPT DE COMPORTAMIENTO PARA LA IA ─────────────────────────
        const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de VitaeLAB (JRJMarket). No eres un bot — eres una persona cálida, directa, sumamente educada y profesional. Tratas de USTED.

CONTEXTO: El cliente acaba de hacer un pedido en la landing page y sus datos se guardaron en la hoja de Google Sheets. Tu único objetivo en este paso es redactar el primer mensaje de WhatsApp para iniciar el proceso de CONFIRMACIÓN del pedido.

ESTRUCTURA DEL MENSAJE INICIAL OBLIGATORIA (Sigue este orden exacto):
1. Saludo inicial: "Buenos dias"
2. Introducción: "Disculpe nos comunicamos de VitaeLAB por el pedido de ${listaProductos}"
3. Mostrar datos del cliente: Indicar para quién es el pedido, la dirección ingresada y la ciudad.
4. Pregunta de cierre clara: "¿Nos confirma si todos sus datos están correctos para proceder? 😊"

REGLAS DE COMPORTAMIENTO (CÓMO DEBES ACTUAR EN ADELANTE):
- Tu misión es validar que tengamos el Nombre y Apellido completo, Ciudad, y una dirección que incluya obligatoriamente DOS CALLES PRINCIPALES y una REFERENCIA CLARA.
- Si el cliente te responde confirmando que "Sí", pero tú notas que a la dirección le faltan las dos calles o la referencia (ej: solo dice 'sOLANADA'), en el siguiente mensaje deberás decirle amablemente: "Gracias, ayúdeme también con su dirección exacta con calles y referencia."
- Una vez que verifiques que el Nombre, Apellido, Ciudad, dirección con 2 calles y Referencia estén completos, le dirás exactamente: "Listo, procedemos al despacho del producto. Te estará llegando entre mañana *${mañana}* y el *${pasado}* en el horario de entrega de *9:00 am a 5:00 pm*. Nos comunicaremos contigo apenas esté cerca de la entrega. 😊" e indícale que esté atento a su número de contacto.
- REGLA DE HORARIO: Si el cliente objeta el horario de 9am a 5pm o dice que trabaja, debes ofrecerle textualmente la alternativa: "Comprendo. Si se le dificulta el horario por tus ocupaciones, lo podemos entregar en otro lugar donde sí se encuentre en ese lapso de tiempo. O si desea, lo podemos dejar en una oficina de Servientrega cercana, en la cual usted lo podría retirar tranquilamente coordinando su tiempo y ocupaciones. ¿Cuál opción le resultaría más cómoda? 😊"

FORMATO DE RESPUESTA — OBLIGATORIO:
{"etapa":"CONFIRMADO","mensaje":"Tu mensaje aquí"}
Solo comillas simples dentro de la propiedad mensaje — nunca dobles. Devuelve JSON puro sin bloques markdown.
`;

        const userContent = `Datos capturados en el Google Sheet:
- Cliente: ${orderData["Cliente"]}
- Ciudad: ${orderData["Ciudad"]}
- Dirección exacta: ${orderData["Dirección"]}
- Producto pedido: ${listaProductos}`;

        // ─── LLAMADA A LA IA CON FETCH DIRECTO ───────────────────────────────
        const openAiResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: masterPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.5,
                max_tokens: 1000
            })
        });

        const openAiJson = await openAiResp.json();
        const respuestaRaw = openAiJson.choices?.[0]?.message?.content || "";
        console.log("[IA RAW CONFIRMAR]", respuestaRaw);

        // ─── PARSEAR E INYECTAR MENSAJE ─────────────────────────────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const m = clean.match(/\{[\s\S]*\}/);
            if (m) clean = m[0];
            parsed = JSON.parse(clean);
        } catch (e) {
            console.error("Error parseando el JSON de la IA");
        }

        if (parsed && parsed.mensaje) {
            let textoFinal = parsed.mensaje
                .replace(/\\n\\n/g, '\n\n')
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*')
                .replace(/\.\s+([A-ZÁÉÍÓÚÑ¿])/g, '.\n\n$1')
                .replace(/\s+([\u{1F300}-\u{1FAFF}])/gu, '\n\n$1');

            // Envío del mensaje limpio a través de la Evolution API
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
