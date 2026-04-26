const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const { 
        EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
        GROK_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, IA_PROVIDER,
        KV_REST_API_URL, KV_REST_API_TOKEN
    } = process.env;

    const NUMERO_ADMIN = "593992668002";

    if (!req.body?.data?.message || req.body.data.key?.fromMe) return res.status(200).send('OK');

    const data = req.body.data;
    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const msgId = data.key?.id;
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
    const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";
    const provider = (IA_PROVIDER || 'grok').trim().toLowerCase();

    const dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
    const hoy = new Date();
    const mañana = dias[(hoy.getDay() + 1) % 5];
    const pasado = dias[(hoy.getDay() + 2) % 5];

    // --- HELPERS REDIS ---
    const redisGet = async (key) => {
        const r = await fetch(`${KV_REST_API_URL}/get/${key}`, {
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
        });
        const d = await r.json();
        return d.result || null;
    };

    const redisSetex = async (key, seconds, value) => {
        await fetch(`${KV_REST_API_URL}/setex/${key}/${seconds}/${encodeURIComponent(value)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
        });
    };

    // --- ANTI-DUPLICADOS ---
    try {
        const existe = await redisGet(`dd:${msgId}`);
        if (existe) return res.status(200).send('OK');
        await redisSetex(`dd:${msgId}`, 60, "1");
    } catch (e) {
        console.error("Dedup error:", e.message);
    }

    // --- HISTORIAL DESDE REDIS ---
    let historialConversacion_arr = [];
    const memoriaKey = `chat:${remoteJid.replace(/[^a-zA-Z0-9]/g, '_')}`;
    try {
        const guardado = await redisGet(memoriaKey);
        if (guardado) historialConversacion_arr = JSON.parse(decodeURIComponent(guardado));
    } catch (e) {
        console.error("Error leyendo historial:", e.message);
        historialConversacion_arr = [];
    }

    const esPrimerMensaje = historialConversacion_arr.length === 0;
    historialConversacion_arr.push({ role: "user", content: clienteMsg });
    if (historialConversacion_arr.length > 10) historialConversacion_arr = historialConversacion_arr.slice(-10);

    const contextoMemoria = historialConversacion_arr
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Fiorella'}: ${h.content}`)
        .join('\n');

    // --- BUSCAR PRODUCTO (CON MEMORIA PERSISTENTE EN REDIS) ---
    let infoEspecifica = "";
    let nombreProducto = "";
    let baseConocimiento = "";

    // Creamos una llave única en Redis para guardar el producto de este cliente
    const productoKey = `prod:${remoteJid.replace(/[^a-zA-Z0-9]/g, '_')}`;

    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        console.log("==> Intentando acceder a:", productosPath);

        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            const msgLower = clienteMsg.toLowerCase().trim();

            // 1. Buscamos si el mensaje ACTUAL tiene una palabra clave
            let productoEncontrado = dataProductos.PRODUCTOS.find(p => 
                p.keywords && p.keywords.some(k => msgLower.includes(k.toLowerCase()))
            );
            
            // 2. Si el cliente mencionó una keyword, la guardamos en Redis por 24 horas (86400s)
            if (productoEncontrado) {
                await redisSetex(productoKey, 86400, JSON.stringify(productoEncontrado));
            } 
            // 3. Si NO mencionó keyword (Ej: dijo "Sí" o "Precio"), buscamos qué producto tenía guardado
            else {
                const productoGuardado = await redisGet(productoKey);
                if (productoGuardado) {
                    productoEncontrado = JSON.parse(decodeURIComponent(productoGuardado));
                }
            }

            // 4. Si tenemos producto (ya sea nuevo o desde Redis), leemos su .txt
            if (productoEncontrado) {
                nombreProducto = productoEncontrado.nombre;
                const txtPath = path.join(process.cwd(), 'api', productoEncontrado.archivo);
                console.log("==> Producto activo:", nombreProducto, "| Leyendo:", txtPath);

                if (fs.existsSync(txtPath)) {
                    const buffer = fs.readFileSync(txtPath);
                    infoEspecifica = buffer.toString('utf-8');
                    if (infoEspecifica.length > 10) {
                        console.log("==> ÉXITO TOTAL: Caracteres leídos:", infoEspecifica.length);
                    } else {
                        console.log("==> AVISO: El archivo está vacío o es muy corto");
                    } 
                } else {
                    console.log("==> ERROR: El archivo no existe en la ruta física");
                }
            }
        }            
    } catch (e) {
        console.error("Error en el enrutador de productos:", e.message);
    }

    baseConocimiento = infoEspecifica 
        ? `EL CLIENTE ESTÁ INTERESADO EN: ${nombreProducto.toUpperCase()}.\nUSA ESTA INFO TÉCNICA Y PRECIOS:\n${infoEspecifica}`
        : "El cliente está saludando o no menciona un producto. Sé amable, indaga qué malestar quiere tratar y no pidas datos personales todavía.";
         
    const masterPrompt = `
    IDENTIDAD Y FILOSOFÍA (AIDA + NEUROVENTAS):
    Eres Fiorella de JRJMarket, asesora experta en bienestar y salud. No eres una vendedora común, eres una amiga empática que ayuda. Trato de USTED siempre.
    - EMPATÍA: Si el cliente tiene un dolor, valídalo. "Le entiendo, es muy frustrante sentirse así...".
    - PERSUASIÓN Y SEGURIDAD: Usa prueba social ("Muchos han notado mejoras..."). Recuerda que el Pago contra entrega protege al cliente.
    
    TU OBJETIVO SUPREMO: Mantener viva la conversación, descubrir la necesidad y ofrecer la solución exacta para cerrar la venta. Nunca despaches al cliente.

    ESTADO DE LA CONVERSACIÓN:
    ES PRIMER MENSAJE: ${esPrimerMensaje ? 'SÍ - Saluda UNA sola vez ("¡Hola! Muy buenas (días/tardes/noches)... Un gusto saludarle 😊").' : 'NO - PROHIBIDO saludar de nuevo, continúa el hilo de la conversación directamente.'}.
    CONOCIMIENTO ACTUAL DEL PRODUCTO: ${baseConocimiento}

    REGLAS DE ORO PARA LA VENTA:
    1. SI NO SABES EL PRODUCTO: NO inventes nombres ni precios. Di: "Con gusto le ayudo, ¿me podría decir en qué producto está interesado o qué malestar quiere tratar? ✨".
    2. SI YA SABES EL PRODUCTO: Da la información de forma humana (no como lista). Menciona un beneficio real enfocado en el dolor del cliente. 
    3. CERRAR VENTA: Si el cliente dice "Comprar", "Quiero" o confirma que lo desea, inicia la fase de cierre inmediatamente pidiendo dirección y nombre.
    4. LOGÍSTICA: Envío GRATIS 1ra compra. Llega entre ${mañana} o ${pasado}. Pago contra entrega 🛡️. -$2 por transferencia.

    REGLAS ANTI-BUCLES Y MEMORIA DE ACERO (¡ESTRICTO!):
    - NO REPITAS PREGUNTAS: Lee el HISTORIAL RECIENTE. Si el cliente YA expresó su necesidad (Ej: "está pequeño", "crecer", "dolor de espalda"), TIENES PROHIBIDO volver a preguntar "¿qué busca?" o "¿qué le preocupa?". Avanza directamente a dar la solución, el precio y pide los datos de envío.
    - PRUEBA DE MEMORIA: Si el cliente te pone a prueba ("¿Qué te dije hace rato?"), LEE EL HISTORIAL INMEDIATAMENTE. Responde con naturalidad demostrando que recuerdas su dolor exacto (Ej: "Me comentó que su niño está pequeño y quiere ayudarlo a crecer... le pido disculpas si me distraje, ¿me confirma su dirección?"). NO pidas disculpas robóticas.

    ESTILO, FORMATO Y BREVEDAD:
    - Humana, usa puntos suspensivos (...) para pausas.
    - Salto de línea tras cada punto, exclamación o pregunta. NO bloques largos.
    - Brevedad: Máximo 3 a 4 mensajes por respuesta. Ve al grano con calidez.
    - Emojis sutiles (máximo 1 o 2 por mensaje): 👋, 😊, ✨, ❤️, 🌿, 📦, 🚚, ✅, 🛡️.

    REGLA CRÍTICA Y OBLIGATORIA DE CIERRE:
    Tu ÚLTIMO mensaje de cada respuesta DEBE terminar con una pregunta abierta corta (?). SIN EXCEPCIÓN. Si no sabes el dolor, indágalo. Si ya diste el precio o la solución, la pregunta debe ser para pedir la dirección o coordinar el envío.

    HISTORIAL RECIENTE:
    ${contextoMemoria}`;

    try {
        let textoFinal = "";

        if (provider === 'grok') {
            const respIA = await fetch('https://api.x.ai/v1/responses', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    "model": "grok-4.20-reasoning", 
                    "input": masterPrompt + `\nCliente dice: "${clienteMsg}"\nResponde como Fiorella:` 
                })
            });
            const jsonIA = await respIA.json();
            const msgObj = jsonIA.output?.find(o => o.type === 'message');
            textoFinal = msgObj?.content?.find(c => c.type === 'output_text')?.text || "";
        } else {
            const respIA = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: masterPrompt }, ...historialConversacion_arr],
                    temperature: 0.7
                })
            });
            const jsonIA = await respIA.json();
            textoFinal = jsonIA.choices?.[0]?.message?.content || "";
        }

        if (textoFinal) {
            textoFinal = textoFinal.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();

            // 1. EL SALVAVIDAS DE NEUROVENTAS: Si por algún motivo la IA no generó el '?',
            // inyectamos una pregunta de cierre genérica y poderosa al instante, SIN usar más APIs.
            if (!textoFinal.includes('?')) {
                textoFinal += " Para poder asesorarle correctamente, ¿me podría contar un poquito qué es lo que más le preocupa o qué resultados busca? ✨";
            }

            // GUARDAR HISTORIAL EN REDIS
            historialConversacion_arr.push({ role: "assistant", content: textoFinal });
            try {
                await redisSetex(memoriaKey, 86400, JSON.stringify(historialConversacion_arr));
            } catch (e) {
                console.error("Error guardando historial:", e.message);
            }

            // NOTIFICACIÓN DE VENTA O DATOS (Se activa SOLO si el cliente dice los datos)
            const keywords = ["confirmado", "registrado", "agendado", "dirección", "nombre", "calle", "ciudad", "barrio", "provincia", "sector"];
            if (keywords.some(k => clienteMsg.toLowerCase().includes(k)) && clienteMsg.length > 5) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: NUMERO_ADMIN, text: `📢 *NUEVA POSIBLE VENTA O DATO RECIBIDO*\nDe: ${remoteJid}\nCliente dijo: ${clienteMsg}` })
                });
            }

            // CASCADA DE MENSAJES (Optimizada para NUNCA borrar la pregunta)
            let partes = textoFinal
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "");

            // REGLA ANTI-HACHAZO: Si hay más de 5 mensajes, asegurarnos de que la última línea (la pregunta) se conserve.
            if (partes.length > 5) {
                const preguntaFinal = partes.pop(); // Extraemos la pregunta
                partes = partes.slice(0, 4);        // Cortamos el exceso del medio
                partes.push(preguntaFinal);         // Volvemos a pegar la pregunta al final
            }

            // Si el primer mensaje es muy corto (ej: "¡Hola!"), lo pegamos con el segundo
            if (partes.length > 1 && partes[0].length < 30) {
                partes[1] = partes[0] + " " + partes[1];
                partes.shift();
            }
            
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                if (partes.length > 1) await new Promise(r => setTimeout(r, 1000));
            }
        } // Fin del if (textoFinal)

    } catch (error) { 
        // ESTE ES EL CATCH QUE FALTABA
        console.error("Error flujo general:", error.message); 
    }

    return res.status(200).send('OK');
};
