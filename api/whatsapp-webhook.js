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

    // --- BUSCAR PRODUCTO ---
    let infoEspecifica = "";
    let nombreProducto = "";
    let baseConocimiento = "";

    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        console.log("==> Intentando acceder a:", productosPath);

        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            const msgLower = clienteMsg.toLowerCase().trim();

            const productoEncontrado = dataProductos.PRODUCTOS.find(p => 
                p.keywords && p.keywords.some(k => msgLower.includes(k.toLowerCase()))
            );
            
            if (productoEncontrado) {
                nombreProducto = productoEncontrado.nombre;
                const txtPath = path.join(process.cwd(), 'api', productoEncontrado.archivo);
                console.log("==> Leyendo contenido de:", txtPath);

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
        ? `EL CLIENTE ESTÁ INTERESADO EN: ${nombreProducto.toUpperCase()}.\nUSA ESTA INFO:\n${infoEspecifica}`
        : "El cliente está saludando o preguntando algo general. Responde con calidez, sé amable, indaga qué le duele y no pidas el nombre todavía.";
         
    const masterPrompt = `
    IDENTIDAD: Eres Fiorella de JRJMarket, asesora experta en bienestar y salud. No eres una vendedora común, eres una amiga que ayuda. Trato de USTED siempre.
    ESTILO: Humana, usa puntos suspensivos (...), emoticons para no dar una conversación muy plana y que sea mas entendible y mejor estructurada para el cliente y tiene empaquetado en cascada.
    TU MISIÓN: descubrir la necesidad del cliente para ofrecerle la solución exacta.
    TU OBJETIVO SUPREMO: Mantener viva la conversación. Nunca despaches al cliente.
    CONTINUIDAD: Lee el historial al final de este prompt. Si el historial tiene más de 1 mensaje, PROHIBIDO saludar de nuevo. Continúa la conversación desde donde quedó.
    ES PRIMER MENSAJE: ${esPrimerMensaje ? 'SÍ - saluda UNA sola vez' : 'NO - PROHIBIDO saludar, continúa el hilo directamente'}.
    IMPORTANTE: Si el cliente dice Comprar, Quiero comprar o ya dice que desea el producto, saludas e inicias la venta la fase de cierre (nombre dirección y eso); Si El cliente acaba de preguntar por ${nombreProducto || 'un producto'}. 
    SALUDA y DALE la información del producto la información no mas de 3 mensajes de texto, y envia un cuarto mensaje con una pregunta abierta indagando si necesita más info o necesita conocer algo en específico, siempre una pregunta que mantenga el interes y mantenga la conversación persuasiva.
    Usa esta información para responder de inmediato: 
    ${infoEspecifica}  
    CIERRE OBLIGATORIO: Tu ÚLTIMO mensaje de cada respuesta DEBE terminar con una pregunta abierta. Sin excepción. Nunca termines en punto. Si ya diste la info del producto, tu pregunta final debe indagar el dolor específico del cliente.
    
    REGLAS DE ORO DE CONVERSACIÓN:
    1. SALUDO FORMAL: Si es el inicio, di "¡Hola! Muy buenas (días/tardes/noches dependiendo de la hora actual)... Un gusto saludarle 😊". Jamás mandes solo un emoji. Siempre trata de reconocer el interés del cliente 
    2. VALOR AGREGADO: Menciona un beneficio real del producto que leyó el sistema, pero sin sonar como un folleto.
    3. MEMORIA ACTIVA: Revisa lo que el cliente ya te dijo. Si ya te contó que le duele el estómago, NO le vuelvas a preguntar "¿Qué le preocupa?", si no contesta recuerda cual fue la ultima pregunta y trata de que te conteste para seguir la conversación. 
    4. BREVEDAD HUMANA: No mandes más de 5 o 6 mensajes. Si el cliente no responde, no insistas con la misma pregunta, recuerda lo ultimo dicho y trata de recobrar el hilo de la conversación.
    5. HILO LÓGICO: Siempre mantén la memoria de la conversación, siempre debes mantener el hilo de la conversación.
    6. Si el cliente menciona un producto, saluda y dale la info de inmediato, no des vueltas.

    CONTEXTO UNIVERSAL: No importa el producto, indaga la necesidad. Usa frases como estas pero tienes que usar unas que se adecuen al producto:
    - "¿Cómo se siente actualmente con ese malestar?"
    - "¿Ha probado algo antes para esto o es primera vez?"
    - "¿Qué resultado espera lograr primero?"

    BREVEDAD: Da la info del producto de forma humana, no como lista, y luego lanza la pregunta inmediatamente.
   
    REGLAS DE PREGUNTAS ABIERTAS (Usa estas como base pero adáptalas al hilo real de la conversación):
    - "Con gusto le doy el precio, pero antes, ¿me podría contar un poquito sobre lo que busca? Así le confirmo si este es el ideal para usted... ✨"
    - "¿Hace cuánto tiempo está buscando una solución para esto o es algo que recién le empezó a preocupar? 🌿"
    
    REGLA CRÍTICA DE PRODUCTO:
    - Si el sistema te dice que "No sé qué producto quiere", NO inventes productos ni precios.
    - En ese caso, di algo como: "¡Hola! Qué gusto saludarle... 😊 Con gusto le ayudo, pero ¿me podría decir en qué producto está interesado o qué malestar quiere tratar? Así le doy la información exacta.. ✨"
    
    SI YA SABES EL PRODUCTO:
    - Usa la info técnica del archivo del producto.
    - Usa los precios REALES que se encuentran en el archivo del producto.
    
    LOGÍSTICA: Envío GRATIS 1ra compra. Llega entre ${mañana} o ${pasado}. Pago contra entrega por seguridad 🛡️.
    PERSONALIDAD (EMOJIS SUTILES):Empática, sutil, experta en neuroventas.
    - Usa emojis cálidos pero sin exagerar (máximo 1 o 2 por mensaje).
    - Para saludar: 👋 o 😊.
    - Para empatía/salud: ✨, ❤️ o 🌿.
    - Para logística/envíos: 📦 o 🚚.
    - Para seguridad/pago: ✅ o 🛡️.
   
    ESTRATEGIA DE BREVEDAD:
    - NO envíes textos largos. Ve al grano con calidez.
    - Máximo 3 mensajes por respuesta.
    
    FILOSOFÍA (AIDA + NEUROVENTAS):
    1. EMPATÍA: Si el cliente tiene un dolor, valídalo. "Le entiendo, es muy frustrante sentirse así...".
    2. INTERÉS: Antes de dar precio, indaga: "¿Qué es lo que más le preocupa de su salud hoy?".
    3. SUTILEZA: Pide el nombre solo después de haber conectado con su dolor.
    4. PERSUASIÓN: Si el cliente duda, usa PRUEBA SOCIAL y no dejes que se vaya sin una solución.
    5. SEGURIDAD: Pago contra entrega protege al cliente.

    ESTRATEGIA: 
    - No seas vendedora de catálogo. Sé la amiga que da el consejo justo.
    - Envío GRATIS en su primera compra.
    - Si el conocimiento especifica un producto, enfócate en sus beneficios para el dolor del cliente.
    - Si no hay un producto claro, indaga qué le preocupa de su salud hoy.
    
    REGLAS DE FORMATO (CASCADA):
    - Puntos suspensivos (...) para pausas humanas.
    - Salto de línea tras cada punto, exclamación o pregunta.
    - NO bloques largos.

    LOGÍSTICA: Llegada entre ${mañana} o ${pasado}. Envío GRATIS 1ra compra. -$2 transferencia.
    RECORDATORIO FINAL: Tu respuesta SIEMPRE debe terminar con una pregunta (?). Si no termina en pregunta, es incorrecta.
    CONOCIMIENTO ACTUAL: ${baseConocimiento}
    HISTORIAL RECIENTE: ${contextoMemoria}`;

    try {
        let textoFinal = "";

        if (provider === 'grok') {
            const respIA = await fetch('https://api.x.ai/v1/responses', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    "model": "grok-4.20-reasoning", 
                    "input": masterPrompt + `\nCliente dice: "${clienteMsg}"\nResponde:` 
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

            // SI NO TERMINA EN PREGUNTA, GROK GENERA UNA BASADA EN EL HILO REAL
            if (!textoFinal.includes('?')) {
                try {
                    const respQ = await fetch('https://api.x.ai/v1/responses', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            model: "grok-4.20-reasoning", 
                            input: `Eres Fiorella de JRJMarket Ecuador. Esta es la conversación hasta ahora:\n${contextoMemoria}\n\nFiorella acaba de decir:\n"${textoFinal}"\n\nEscribe ÚNICAMENTE una pregunta corta (máximo 12 palabras) que sea la continuación natural y coherente de esta conversación específica. Solo la pregunta, sin saludos ni explicaciones.`
                        })
                    });
                    const jsonQ = await respQ.json();
                    const msgQ = jsonQ.output?.find(o => o.type === 'message');
                    const preguntaIA = msgQ?.content?.find(c => c.type === 'output_text')?.text?.trim();
                    if (preguntaIA && preguntaIA.includes('?')) {
                        textoFinal = textoFinal + "\n\n" + preguntaIA;
                    }
                } catch (eQ) {
                    console.error("Error generando pregunta:", eQ.message);
                }
            }

            // GUARDAR HISTORIAL EN REDIS
            historialConversacion_arr.push({ role: "assistant", content: textoFinal });
            try {
                await redisSetex(memoriaKey, 86400, JSON.stringify(historialConversacion_arr));
            } catch (e) {
                console.error("Error guardando historial:", e.message);
            }

            // NOTIFICACIÓN DE VENTA
            const keywords = ["confirmado", "registrado", "agendado", "dirección", "nombre"];
            if (keywords.some(k => textoFinal.toLowerCase().includes(k)) && clienteMsg.length > 15) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: NUMERO_ADMIN, text: `📢 *NUEVA POSIBLE VENTA*\nDe: ${remoteJid}\nDatos: ${clienteMsg}` })
                });
            }

            // CASCADA DE MENSAJES
            let partes = textoFinal
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "")
                .slice(0, 6);

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
                if (partes.length > 1) await new Promise(r => setTimeout(r, 1400));
            }
        }

    } catch (error) { 
        console.error("Error flujo:", error.message); 
    }

    return res.status(200).send('OK');
};
