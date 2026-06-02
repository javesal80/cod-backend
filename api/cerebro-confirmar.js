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

    console.log("🚀 [CEREBRO-CONFIRMAR] Sincronizando IA Nativa de Evolution API");

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

        // ─── MASTER PROMPT DE EVOLUTION API (Para mantener viva la IA interna) ───
        const masterPromptEvolution = `
Eres Fiorella, asesora de salud y bienestar de VitaeLAB. Tratas de USTED. Eres una persona cálida y profesional. Usa emojis de forma natural (😊, 👋, 📦, 🚚).

Tu único objetivo es continuar la conversación que acabamos de iniciar con el cliente para CONFIRMAR su pedido de la landing page.

REGLAS DE INTERACCIÓN PARA LAS RESPUESTAS DEL CLIENTE:
- Debes evaluar que tengamos el Nombre y Apellido completo, Ciudad, y dirección con DOS CALLES PRINCIPALES y una REFERENCIA CLARA.
- Si el cliente te responde que "Sí, está correcto" pero notas que los datos están incompletos (ej: dirección vaga que no tiene intersecciones ni referencias como 'sOLANADA'), debes pedirle amablemente: "Gracias, ayúdeme también con su dirección exacta con calles y referencia."
- En cuanto verifiques que el Nombre, Apellido, Ciudad, dirección con 2 calles y Referencia estén completos, dile exactamente: "Listo, procedemos al despacho del producto. Te estará llegando entre mañana *${mañana}* y el *${pasado}* en el horario de entrega de *9:00 am a 5:00 pm*. Nos comunicaremos contigo apenas esté cerca de la entrega. 😊 Muchas gracias por tu confianza, por favor esté atento a su número de contacto."
- REGLA DE OBJECIÓN DE HORARIO: Si pone peros con el horario o trabaja, usa textualmente la alternativa de Servientrega: "Comprendo. Si se le dificulta el horario por tus ocupaciones, lo podemos entregar en otro lugar donde sí se encuentre en ese lapso de tiempo. O si desea, lo podemos dejar en una oficina de Servientrega cercana, en la cual usted lo podría retirar tranquilamente coordinando su tiempo y ocupaciones. ¿Cuál opción le resultaría más cómoda? 😊"

Responde siempre en formato de texto natural para WhatsApp, limpio y directo.
`;

        // ─── 1. ACTIVAR EL PROMPT INTERNO EN LA EVOLUTION API PARA ESTE CHAT ───
        // (Esto deja a la IA de la instancia "despierta" y configurada para este cliente)
        await fetch(`${EVOLUTION_URL}/chatIe/settings/${INSTANCE_DESPACHO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
            body: JSON.stringify({
                enabled: true,
                botName: "Fiorella",
                systemPrompt: masterPromptEvolution,
                apiKey: OPENAI_API_KEY,
                model: "gpt-4o"
            })
        });

        // ─── 2. CREAR EL MENSAJE INICIAL FRAGMENTADO (Igual que antes) ───
        const promptInicial = `Genera un JSON con tres mensajes separados por "|||". Sigue esta plantilla exacta:\n\nHola, muy buenas... Un gusto saludarle 😊\n||\nNos comunicamos de *VitaeLAB* para confirmar el siguiente pedido:\n\n👤 *Cliente:* ${orderData["Cliente"] || ""}\n📍 *Ciudad:* ${orderData["Ciudad"] || ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}\n📦 *Producto:* [Desglosa aquí verticalmente con cantidad y precio]\n||\n¿Nos confirma si todos sus datos están correctos para proceder? 😊`;

        const openAiResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: "Devuelve solo un JSON con el formato: {\"mensaje\":\"\"}. Separa los 3 mensajes con |||" }, { role: "user", content: promptInicial }],
                temperature: 0.3
            })
        });

        const openAiJson = await openAiResp.json();
        const respuestaRaw = openAiJson.choices?.[0]?.message?.content || "";

        // ─── 3. PARSEAR Y ENVIAR LOS TRES MENSAJES ───────────────────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            parsed = JSON.parse(clean);
        } catch (e) { console.error("Error parseando"); }

        if (parsed && parsed.mensaje) {
            const bloquesMensajes = parsed.mensaje.split('|||');

            for (let bloque of bloquesMensajes) {
                let textoMensaje = bloque.trim().replace(/\\n\\n/g, '\n\n').replace(/\\n/g, '\n').replace(/\*\*(.*?)\*\*/g, '*$1*');

                if (textoMensaje.length > 0) {
                    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                        body: JSON.stringify({ number: cleanPhone, text: textoMensaje })
                    });
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
