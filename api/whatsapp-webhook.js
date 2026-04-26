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

    // --- HISTORIAL Y ETAPA DESDE REDIS ---
    let historialConversacion_arr = [];
    const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');
    const memoriaKey = `chat:${cleanJid}`;
    const stageKey = `stage:${cleanJid}`; 

    let etapaActual = "FRIO";
    try {
        const [guardado, etapaGuardada] = await Promise.all([
            redisGet(memoriaKey),
            redisGet(stageKey)
        ]);
        if (guardado) historialConversacion_arr = JSON.parse(decodeURIComponent(guardado));
        if (etapaGuardada) etapaActual = etapaGuardada;
    } catch (e) {
        console.error("Error leyendo memoria:", e.message);
    }

// --- 1. BUSCAR PRODUCTO (PERSISTENTE) ---
    // (Lo hacemos primero para saber si tenemos un producto cargado antes de evaluar la intención)
    const msgLower = clienteMsg.toLowerCase().trim();
    let infoEspecifica = "";
    let nombreProducto = "";
    const productoKey = `prod:${cleanJid}`;

    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            let productoEncontrado = dataProductos.PRODUCTOS.find(p => 
                p.keywords && p.keywords.some(k => msgLower.includes(k.toLowerCase()))
            );
            if (productoEncontrado) {
                await redisSetex(productoKey, 86400, JSON.stringify(productoEncontrado));
            } else {
                const productoGuardado = await redisGet(productoKey);
                if (productoGuardado) productoEncontrado = JSON.parse(decodeURIComponent(productoGuardado));
            }
            if (productoEncontrado) {
                nombreProducto = productoEncontrado.nombre;
                const txtPath = path.join(process.cwd(), 'api', productoEncontrado.archivo);
                if (fs.existsSync(txtPath)) infoEspecifica = fs.readFileSync(txtPath).toString('utf-8');
            }
        }            
    } catch (e) {
        console.error("Error en productos:", e.message);
    }

    const baseConocimiento = infoEspecifica 
        ? `EL CLIENTE ESTÁ INTERESADO EN: ${nombreProducto.toUpperCase()}.\nUSA ESTA INFO TÉCNICA Y PRECIOS:\n${infoEspecifica}`
        : "⚠️ ALERTA: EL CLIENTE NO HA MENCIONADO NINGÚN PRODUCTO. Si el cliente está pidiendo precio, dile amablemente: 'Con gusto le ayudo con la información y precios, ¿me podría indicar en qué producto está interesado? ✨'";

    // --- 2. DETECCIÓN DE INTENCIÓN Y ESTADOS ---
    if (etapaActual !== "CIERRE" && etapaActual !== "POSTVENTA") {
        const intencionCompra = /precio|valor|cuanto cuesta|promocion|promo|comprar|quiero uno|costo/i.test(msgLower);
        // EL FIX: Solo salta a CALIENTE si ya sabemos de qué producto está hablando
        if (intencionCompra && nombreProducto !== "") {
            etapaActual = "CALIENTE";
        }
    }
    
    // De Caliente a Cierre
    if (etapaActual === "CALIENTE" && /si|sí|claro|quiero|despacho|enviar/i.test(msgLower)) etapaActual = "CIERRE";
    
    // De Cierre a Postventa (El Fix del Bucle)
    if (etapaActual === "CIERRE" && /gracias|listo|ok|perfecto|muy amable/i.test(msgLower)) etapaActual = "POSTVENTA";

    // --- 3. GUARDADO DE HISTORIAL ---
    const esPrimerMensaje = historialConversacion_arr.length === 0;
    historialConversacion_arr.push({ role: "user", content: clienteMsg });
    if (historialConversacion_arr.length > 20) historialConversacion_arr = historialConversacion_arr.slice(-20);

    const contextoMemoria = historialConversacion_arr
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Fiorella'}: ${h.content}`)
        .join('\n');

    
    // --- MASTER PROMPT (FUNNEL INTELIGENTE Y HUMANO) ---
    const masterPrompt = `
    IDENTIDAD Y FILOSOFÍA (NEUROVENTAS Y NATURALIDAD):
    Eres Fiorella de JRJMarket, asesora experta en neuromarketing. ¡NO ERES UN ROBOT! Eres humana, empática. Trato de USTED siempre.
    - EL ARTE DE VENDER: Escúchalo, evalúa sus respuestas, caliéntalo poco a poco.

    ETAPA ACTUAL APLICABLE: ${etapaActual}

    ESTADO DE LA CONVERSACIÓN:
    - ES PRIMER MENSAJE: ${esPrimerMensaje ? 'SÍ - OBLIGATORIO: Tu PRIMERA LÍNEA debe ser exactamente ("¡Hola! Muy buenas... Un gusto saludarle 😊").' : 'NO - PROHIBIDO saludar de nuevo, continúa el hilo directamente.'}.

    FLUJO DEL FUNNEL (DINÁMICO Y ESCUCHA ACTIVA):
    1. ETAPA FRIO: 
       - SI NO HAY PRODUCTO IDENTIFICADO: Saluda (si aplica) y pregunta directamente: "¿En qué producto está interesado o qué malestar le gustaría tratar hoy? ✨". PROHIBIDO inventar información.
       - SI YA HAY PRODUCTO IDENTIFICADO: Saluda (si aplica) y lanza el gancho emocional obligatorio conectando con el producto . Y cierra preguntando: "¿Le gustaría conocer más del producto, sus beneficios, ingredientes o tiene alguna duda en particular? ✨"
       
    2. ETAPA TIBIO: 
       - Acción: Conecta ingredientes con su dolor. Si tiene dudas técnicas, responde con paciencia como humana.
       - Transición: Solo cuando resolvió dudas: "¿Le gustaría que le comparta nuestras opciones de precios y promociones? 🌿✨".
    3. ETAPA CALIENTE: 
       - Acción: Presenta 1 unidad y vende el combo ("Aproveche la súper oferta del segundo a mitad de precio, se la recomiendo..."). PROHIBIDO PREGUNTAR SI TIENE DUDAS AQUÍ.
       - Pregunta obligatoria de cierre: EXACTAMENTE ESTA: "¿Desea que se lo enviemos y empiece a disfrutar de todos sus beneficios? 📦✨"
    4. ETAPA CIERRE: 
       - Acción 1: Si aceptó el envío, envía EXACTAMENTE este texto (respeta saltos):
         "Listo, ayúdeme con los siguientes datos por favor:
         *Nombre y Apellido:*
         *Ciudad:*
         *Dirección exacta:* (Especifique 2 calles y una referencia clara, ej: Amazonas y Veintimilla frente a farmacia Cruz Azul)."
       - Acción 2: Si ya dio 2 calles y referencia, ¡NO PIDAS MÁS DETALLES! Valídalo correcto.
       - Acción 3: Confirmación: "Su pedido llegará entre ${mañana} o ${pasado}. Transportadoras seguras (Servientrega, Gintracon, Veloces o Laar). Entregas 9am a 5pm. Pago contra entrega 🛡️."
    5. ETAPA POSTVENTA (¡CUIDADO AQUI!):
       - Si la Etapa Actual es POSTVENTA, significa que el cliente ya compró y se despidió.
       - TIENES ESTRICTAMENTE PROHIBIDO SALUDAR DE NUEVO, REINICIAR LA VENTA O PREGUNTAR ALGO.
       - Tu ÚNICA respuesta debe ser exacta y literalmente esta: "¡De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊".

    ESTILO, FORMATO Y BREVEDAD:
    - Usa puntos suspensivos (...) para pausas humanas. NUNCA bloques largos.
    - Emojis sutiles: 👋, 😊, ✨, ❤️, 🌿, 📦, 🚚, 🛡️.

    REGLA CRÍTICA Y OBLIGATORIA:
    Tu ÚLTIMO mensaje DEBE terminar con una pregunta abierta corta (?), EXCEPTO en la ETAPA POSTVENTA, donde está estrictamente prohibido hacer preguntas.
    
    CONOCIMIENTO ACTUAL DEL PRODUCTO: 
    ${baseConocimiento}
    
    HISTORIAL RECIENTE: 
    ${contextoMemoria}`;

    try {
        let textoFinal = "";
        const bodyIA = {
            messages: [{ role: "system", content: masterPrompt }, ...historialConversacion_arr],
            temperature: 0.7
        };

        if (provider === 'grok') {
            const respIA = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bodyIA, model: "grok-2-latest" })
            });
            const jsonIA = await respIA.json();
            textoFinal = jsonIA.choices?.[0]?.message?.content || "";
        } else {
            const respIA = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bodyIA, model: "gpt-4o-mini" })
            });
            const jsonIA = await respIA.json();
            textoFinal = jsonIA.choices?.[0]?.message?.content || "";
        }

        if (textoFinal) {
            textoFinal = textoFinal.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();
            
            // --- ACTUALIZACIÓN DE ETAPA PARA LOS PRÓXIMOS TURNOS ---
            let nuevaEtapa = etapaActual;
            if (textoFinal.includes("procediéramos con el despacho") || textoFinal.includes("opciones de precios")) nuevaEtapa = "CALIENTE";
            if (textoFinal.includes("Nombre y Apellido") || textoFinal.includes("Dirección exacta")) nuevaEtapa = "CIERRE";
            
            // --- SALVAVIDAS FIORELLA INTELIGENTE ---
            const esDespedida = /hasta luego|excelente día|no dude en contactarme|órdenes/i.test(textoFinal) || etapaActual === "POSTVENTA";
            const esCierreActivo = /dirección|nombre|apellido|ciudad|calle|referencia|envío|llegará|despachar/i.test(textoFinal);
            
            if (!textoFinal.includes('?') && !esDespedida && !esCierreActivo) {
                if (etapaActual === "CALIENTE") {
                    textoFinal += " ¿Desea que se lo enviemos y empiece a disfrutar de todos sus beneficios? 📦✨";
                } else {
                    textoFinal += " ¿Tiene alguna otra inquietud o le gustaría conocer nuestros precios y promociones? ✨";
                }
            } else if (!textoFinal.includes('?') && esCierreActivo && !esDespedida && etapaActual !== "CIERRE") {
                textoFinal += " ¿Me ayuda con esos datos por favor? 📝";
            }

            // GUARDAR EN REDIS
            historialConversacion_arr.push({ role: "assistant", content: textoFinal });
            await redisSetex(memoriaKey, 86400, JSON.stringify(historialConversacion_arr));
            await redisSetex(stageKey, 86400, nuevaEtapa);

            // NOTIFICACIÓN ADMIN
            const keysAdmin = ["confirmado", "registrado", "dirección", "nombre", "calle", "ciudad", "provincia", "sector"];
            if (keysAdmin.some(k => clienteMsg.toLowerCase().includes(k)) && clienteMsg.length > 5) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: NUMERO_ADMIN, text: `📢 *NUEVA VENTA/DATO*\nDe: ${remoteJid}\nMsg: ${clienteMsg}` })
                });
            }

            // --- CASCADA DE MENSAJES ---
            let partes = textoFinal
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "");

            // REGLA ANTI-HACHAZO
            if (partes.length > 6) {
                const preguntaFinal = partes.pop();
                partes = partes.slice(0, 5);
                partes.push(preguntaFinal);
            }

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
                if (partes.length > 1) await new Promise(r => setTimeout(r, 1200));
            }
        } 
    } catch (error) { 
        console.error("Error flujo general:", error.message); 
    }
    return res.status(200).send('OK');
};
