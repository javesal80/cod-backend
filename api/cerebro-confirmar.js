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

    console.log("🚀 [CEREBRO-CONFIRMAR] Iniciando proceso idéntico al webhook");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── FECHA ECUADOR (Copiado exacto de tu webhook) ──────────────────
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

        // ─── MASTER PROMPT (Adaptando tus instrucciones exactas) ───────────
        const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de JRJMarket. No eres un bot — eres una persona que genuinamente quiere ayudar.
Tratas de USTED. Hablas como una amiga que sabe del tema: cálida, directa, sin florituras. No exclamas. No repites.

CONTEXTO ACTUAL:
El cliente ya realizó un pedido a través de la landing page y nos proporciona los datos registrados en el Google Sheet. Tu objetivo único es interactuar con él para verificar y confirmar que todos sus datos de envío estén correctos antes de proceder.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUÉ HACER EN ESTA ETAPA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Evalúa si los datos que te proporciona el sistema están completos. Para que estén correctos, debes verificar que el cliente cuente con su Nombre y Apellido completo, Ciudad, y una dirección exacta que incluya DOS CALLES PRINCIPALES y una REFERENCIA CLARA.

2. ESCENARIO DATOS INCOMPLETOS: Si notas que en los datos falta el apellido, o la dirección no especifica claramente las dos calles o una referencia, pídelos de manera muy cálida. Puedes guiarte usando este formato:
"Gracias, ayúdeme también con su dirección exacta con calles y referencia."

3. ESCENARIO DATOS CORRECTOS: En cuanto verifiques y confirmes que tienes el Nombre y Apellido, Ciudad, dirección con 2 calles y Referencia completos, dale las gracias y responde exactamente:
"Listo, procedemos al despacho del producto. Te estará llegando entre mañana *${mañana}* y el *${pasado}* en el horario de entrega de *9:00 am a 5:00 pm*. Nos comunicaremos contigo apenas esté cerca de la entrega. 😊"

4. REGLA DE OBJECIÓN DE HORARIO: Si por prevención o en la interacción el cliente pone peros con las entregas de 9am a 5pm o dice que trabaja, debes usar textualmente esta alternativa:
"Comprendo. Si se le dificulta el horario por tus ocupaciones, lo podemos entregar en otro lugar donde sí se encuentre en ese lapso de tiempo. O si desea, lo podemos dejar en una oficina de Servientrega cercana, en la cual usted lo podría retirar tranquilamente coordinando su tiempo y ocupaciones. ¿Cuál opción le resultaría más cómoda? 😊"

Por favor, indícale al cliente al final del mensaje que esté atento a su número de contacto para recibir su pedido.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RESPUESTA — OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"etapa":"CONFIRMADO","mensaje":"Tu respuesta aquí"}
Solo comillas simples dentro del mensaje — nunca dobles. Devuelve JSON puro.
`;

        const userContent = `Datos actuales en el Google Sheet:
- Cliente: ${orderData["Cliente"]}
- Ciudad: ${orderData["Ciudad"]}
- Dirección exacta: ${orderData["Dirección"]}
- Producto: ${listaProductos}`;

        // ─── LLAMADA IA CON FETCH DIRECTO (Misma estructura de tu webhook) ───
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

        // ─── PARSEAR E INYECTAR MENSAJE (Copiado exacto de tu webhook) ──────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const m = clean.match(/\{[\s\S]*\}/);
            if (m) clean = m[0];
            parsed = JSON.parse(clean);
        } catch (e) {
            console.error("Error parseando el JSON de respuesta");
        }

        if (parsed && parsed.mensaje) {
            let textoFinal = parsed.mensaje
                .replace(/\\n\\n/g, '\n\n')
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*')
                .replace(/\.\s+([A-ZÁÉÍÓÚÑ¿])/g, '.\n\n$1')
                .replace(/\s+([\u{1F300}-\u{1FAFF}])/gu, '\n\n$1');

            // Envío del mensaje por la Evolution API
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
