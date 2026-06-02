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

    console.log("🚀 [CEREBRO-CONFIRMAR] Procesando confirmación aislada de 3 mensajes con IA");

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

        let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        // ─── FECHA ECUADOR ──────────────────────────────────────────────────
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

        // ─── MASTER PROMPT DE COMPORTAMIENTO PARA LA IA ─────────────────────────
        const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de VitaeLAB. Tratas de USTED. Eres una persona cálida y profesional.

CONTEXTO: El cliente acaba de comprar en la landing page. Debes armar el primer contacto para iniciar la CONFIRMACIÓN del pedido.

⚠️ REGLA CRUCIAL DE FORMATO (TRES MENSAJES SEPARADOS):
Para evitar que el texto vaya amontonado, debes separar obligatoriamente tu respuesta en 3 bloques independientes usando el separador exacto "|||".

⚠️ REGLA CRUCIAL DE PRODUCTOS (DESGLOSE VERTICAL CON PRECIO):
En el segundo mensaje, la sección "📦 Producto:" NO debe ir amontonada en una sola línea. Debes listar CADA producto que el cliente compró en su propia línea de forma ordenada, mostrando la cantidad, el nombre del producto y su precio correspondiente según los datos recibidos (ejemplo: "1 KIDGROW CRECIMIENTO por $35"). Sigue esta plantilla exacta:

Hola, muy buenas... Un gusto saludarle 😊
|||
Nos comunicamos de *VitaeLAB* para confirmar el siguiente pedido:

👤 *Cliente:* ${orderData["Cliente"] || ""}
📍 *Ciudad:* ${orderData["Ciudad"] || ""}
🏠 *Dirección:* ${orderData["Dirección"] || ""}
📦 *Producto:* [Lista vertical desglosada uno por uno con su respectivo precio aquí]
|||
¿Nos confirma si todos sus datos están correctos para proceder? 😊

REGLAS DE COMPORTAMIENTO PARA LAS SIGUIENTES INTERACCIONES:
- Tu misión es evaluar que tengamos el Nombre y Apellido completo, Ciudad, y dirección con DOS CALLES PRINCIPALES y una REFERENCIA CLARA.
- Si el cliente responde que "Sí" pero los datos están incompletos (ej: dirección vaga como 'sOLANADA'), en el siguiente turno se le debe pedir amablemente: "Gracias, ayúdeme también con su dirección exacta con calles y referencia."
- Una vez que todo esté validado y correcto, se le confirmará el envío diciendo exactamente: "Listo, procedemos al despacho del producto. Te estará llegando entre mañana *${mañana}* y el *${pasado}* en el horario de entrega de *9:00 am a 5:00 pm*. Nos comunicaremos contigo apenas esté cerca de la entrega. 😊" e indicando que esté atento a su número de contacto.
- REGLA DE HORARIO: Si el cliente pone peros con la hora o trabaja, usa textualmente esta alternativa de Servientrega: "Comprendo. Si se le dificulta el horario por tus ocupaciones, lo podemos entregar en otro lugar donde sí se encuentre en ese lapso de tiempo. O si desea, lo podemos dejar en una oficina de Servientrega cercana, en la cual usted lo podría retirar tranquilamente coordinando su tiempo y ocupaciones. ¿Cuál opción le resultaría más cómoda? 😊"

FORMATO DE RESPUESTA — OBLIGATORIO:
{"etapa":"CONFIRMADO","mensaje":"[Escribe aquí los 3 mensajes separados por |||]"}
Usa solo comillas simples dentro de mensaje. Devuelve JSON puro sin bloques de código markdown.
`;

        // Le pasamos el request.body completo para que la IA extraiga los campos de productos, precios y totales que envía la landing
        const userContent = `Datos completos recibidos del pedido:\n${JSON.stringify(orderData, null, 2)}`;

        // ─── LLAMADA A LA IA CON FETCH DIRECTO ───────────────────────────────
        const openAiResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: masterPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.3,
                max_tokens: 1000
            })
        });

        const openAiJson = await openAiResp.json();
        const respuestaRaw = openAiJson.choices?.[0]?.message?.content || "";
        console.log("[IA RAW CONFIRMAR]", respuestaRaw);

        // ─── PARSEAR ENVIAR CADA MENSAJE POR SEPARADO ───────────────────────
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
            const bloquesMensajes = parsed.mensaje.split('|||');

            for (let bloque of bloquesMensajes) {
                let textoMensaje = bloque.trim()
                    .replace(/\\n\\n/g, '\n\n')
                    .replace(/\\n/g, '\n')
                    .replace(/\*\*(.*?)\*\*/g, '*$1*');

                if (textoMensaje.length > 0) {
                    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                        body: JSON.stringify({ number: cleanPhone, text: textoMensaje })
                    });
                    
                    // Retraso para simular flujo humano de mensajes independientes
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
