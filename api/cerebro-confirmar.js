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

    console.log("🚀 [CEREBRO-CONFIRMAR] Enviando ráfaga exacta con desglose vertical de productos y precios fijos");

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

        // ─── PROCESAMIENTO NATIVO DE PRODUCTOS Y PRECIOS (Línea por línea) ───
        let productosRaw = String(orderData["Productos"] || "");
        // Dividimos por comas en caso de que vengan varios productos juntos en la celda
        let itemsDeCompra = productosRaw.split(',');
        let lineasDesglosadas = [];

        for (let item of itemsDeCompra) {
            let textoLimpio = item.trim();
            if (!textoLimpio) continue;

            // Extraer la cantidad si viene en formato "1x" o "1 "
            let cantidadMatch = textoLimpio.match(/^(\d+)\s*x?|x\s*(\d+)/i);
            let cantidad = 1;
            if (cantidadMatch) {
                cantidad = parseInt(cantidadMatch[1] || cantidadMatch[2] || "1");
            }

            // Detectar el tipo de producto de forma limpia para asignar su precio real de catálogo
            let itemLower = textoLimpio.toLowerCase();
            let nombreFormateado = textoLimpio;
            let precioUnitario = 0;

            if (itemLower.includes("kidgrow")) {
                nombreFormateado = "KIDGROW CRECIMIENTO";
                precioUnitario = 35.00;
            } else if (itemLower.includes("colageno") || itemLower.includes("colágeno")) {
                nombreFormateado = "COLAGENO";
                precioUnitario = 14.99;
            } else if (itemLower.includes("oregano") || itemLower.includes("orégano")) {
                nombreFormateado = "OIL OREGANO";
                precioUnitario = 15.00; // O el precio exacto correspondiente a este producto
            }

            // Calcular el precio total de esa línea basado en la cantidad
            let precioTotalLinea = (precioUnitario * cantidad).toFixed(2).replace('.', ',');

            // Añadimos el producto con el formato vertical exacto que me pediste
            lineasDesglosadas.push(`   ${cantidad} ${nombreFormateado} por $${precioTotalLinea}`);
        }

        // Unimos todas las líneas con un salto de página para el mensaje
        let listaProductosFinal = lineasDesglosadas.join('\n');

        // ─── MASTER PROMPT PARA LA IA NATIVA DE EVOLUTION (Escucha de regreso) ───
        const masterPromptEvolution = `
Eres Fiorella, asesora de salud y bienestar de VitaeLAB. Tratas de USTED. Eres una persona cálida y profesional. Usa emojis de forma natural (😊, 👋, 📦).

Tu único objetivo es continuar la conversación que acabamos de iniciar con el cliente para CONFIRMAR su pedido de la landing page.

REGLAS DE INTERACCIÓN PARA LAS RESPUESTAS DEL CLIENTE:
- Debes evaluar que tengamos el Nombre y Apellido completo, Ciudad, y dirección con DOS CALLES PRINCIPALES y una REFERENCIA CLARA.
- Si el cliente te responde que "Sí, está correcto" pero notas que los datos están incompletos (ej: dirección vaga que no tiene intersecciones ni referencias como 'sOLANADA'), debes pedirle amablemente: "Gracias, ayúdeme también con su dirección exacta con calles y referencia."
- En cuanto verifiques que el Nombre, Apellido, Ciudad, dirección con 2 calles y Referencia estén completos, dile exactamente: "Listo, procedemos al despacho del producto. Te estará llegando entre mañana *${mañana}* y el *${pasado}* en el horario de entrega de *9:00 am a 5:00 pm*. Nos comunicaremos contigo apenas esté cerca de la entrega. 😊 Muchas gracias por tu confianza, por favor esté atento a su número de contacto."
- REGLA DE OBJECIÓN DE HORARIO: Si pone peros con el horario o trabaja, usa textualmente la alternativa de Servientrega: "Comprendo. Si se le dificulta el horario por tus ocupaciones, lo podemos entregar en otro lugar donde sí se encuentre en ese lapso de tiempo. O si desea, lo podemos dejar en una oficina de Servientrega cercana, en la cual usted lo podría retirar tranquilamente coordinando su tiempo y ocupaciones. ¿Cuál opción le resultaría más cómoda? 😊"

Responde siempre en formato de texto natural para WhatsApp, limpio, directo y sin inventar datos.
`;

        // ─── 1. CONFIGURAR E INICIAR LA IA NATIVA EN LA INSTANCIA DE EVOLUTION ───
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

        // ─── 2. ARMAR LOS TRES MENSAJES LITERALES DESDE EL CÓDIGO (100% PRECISO) ───
        const mensajesAEnviar = [
            `Hola, muy buenas... Un gusto saludarle 😊`,
            `Nos comunicamos de *VitaeLAB* para confirmar el siguiente pedido:\n\n👤 *Cliente:* ${orderData["Cliente"] || ""}\n📍 *Ciudad:* ${orderData["Ciudad"] || ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}\n📦 *Producto:*\n${listaProductosFinal}`,
            `¿Nos confirma si todos sus datos están correctos para proceder? 😊`
        ];

        // ─── 3. ENVIAR LA RÁFAGA DIRECTA A WHATSAPP ───────────────────────────
        for (const msgTexto of mensajesAEnviar) {
            await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                body: JSON.stringify({ number: cleanPhone, text: msgTexto })
            });
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
