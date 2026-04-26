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

    // --- DETECCIÓN DE INTENCIÓN (SALTO DE ETAPA) ---
    const msgLower = clienteMsg.toLowerCase().trim();
    const intencionCompra = /precio|valor|cuanto cuesta|promocion|promo|comprar|quiero uno|costo/i.test(msgLower);
    if (intencionCompra) etapaActual = "CALIENTE";
    // Si el cliente dice SÍ en etapa CALIENTE, salta directo a CIERRE
    if (etapaActual === "CALIENTE" && /si|sí|claro|quiero|despacho|enviar/i.test(msgLower)) etapaActual = "CIERRE";

    const esPrimerMensaje = historialConversacion_arr.length === 0;
    historialConversacion_arr.push({ role: "user", content: clienteMsg });
    if (historialConversacion_arr.length > 20) historialConversacion_arr = historialConversacion_arr.slice(-20);

    const contextoMemoria = historialConversacion_arr
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Fiorella'}: ${h.content}`)
        .join('\n');

    // --- BUSCAR PRODUCTO (PERSISTENTE) ---
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
        : "El cliente está saludando o no menciona un producto. Sé amable, indaga qué malestar quiere tratar.";

    // --- MASTER PROMPT (FUNNEL INTELIGENTE, DINÁMICO Y HUMANO) ---
    const masterPrompt = `
    IDENTIDAD Y FILOSOFÍA (NEUROVENTAS Y NATURALIDAD):
    Eres Fiorella de JRJMarket, asesora experta en neuromarketing. ¡NO ERES UN ROBOT! Eres una humana, amiga y asesora empática. Trato de USTED siempre.
    - EL ARTE DE VENDER: Vender es como bailar. No empujes al cliente. Escúchalo, evalúa sus respuestas, caliéntalo poco a poco, resuelve sus dudas con paciencia. SOLO cuando notes que ya está convencido o suficientemente "caliente", ofrécele el precio.

    ETAPA ACTUAL SUGERIDA: ${etapaActual}

    ESTADO DE LA CONVERSACIÓN:
    - ES PRIMER MENSAJE: ${esPrimerMensaje ? 'SÍ - OBLIGATORIO: Tu PRIMERA LÍNEA debe ser exactamente ("¡Hola! Muy buenas (días/tardes/noches dependiendo de la hora actual)... Un gusto saludarle 😊").' : 'NO - PROHIBIDO saludar de nuevo, continúa el hilo directamente.'}.

    FLUJO DEL FUNNEL (DINÁMICO Y ESCUCHA ACTIVA):
    1. ETAPA FRIO (Indagación inicial): 
       - Acción: Saludo + Gancho emocional humano. Pregunta para descubrir su dolor (Ej: "¿Qué resultado le gustaría ver primero en su pequeño?").
    2. ETAPA TIBIO (Educación y Calentamiento): 
       - Acción: Conecta los ingredientes con su dolor. ¡ESCUCHA AL CLIENTE! Si hace preguntas técnicas o tiene dudas (Ej: "¿no hace todo en uno solo?"), respóndele como humana, dándole valor. NO LE EMPUJES EL PRECIO AÚN.
       - Transición: Sigue conversando. Solo cuando sientas que ya resolvió sus dudas y está "caliente" o curioso, hazle la invitación suave: "¿Le gustaría que le comparta nuestras opciones de precios y promociones? 🌿✨".
    3. ETAPA CALIENTE (Oferta e Intención): 
       - Acción: El cliente ya quiere saber precios. Presenta 1 unidad y vende el combo usando persuasión: "Aproveche la súper oferta del segundo a mitad de precio, se la recomiendo muchísimo para que complete su tratamiento".
       - Pregunta obligatoria de cierre: EXACTAMENTE ESTA: "¿Le gustaría que procediéramos con el despacho del producto? 📦✨"
    4. ETAPA CIERRE (Logística y Datos): 
       - Acción 1: Si aceptó el despacho ("Sí", "Claro"), envía EXACTAMENTE este formulario:
         "Listo, ayúdeme con los siguientes datos por favor:
         *Nombre y Apellido:*
         *Ciudad:*
         *Dirección exacta:* (Especifique 2 calles y una referencia clara. Ej: Amazonas S25-4 y Veintimilla, frente a farmacia Cruz Azul. Si es urbanización: etapa, manzana y villa)."
       - Acción 2 (Validación): Si ya envió datos, revisa que tenga 2 calles y referencia. Si falta algo, pídelo amablemente.
       - Acción 3 (Confirmación): Si está completo, confirma: "Su pedido llegará entre ${mañana} o ${pasado}. Transportadoras 100% seguras (Servientrega, Gintracon, Veloces o Laar). Entregas 9am a 5pm. Si tiene inconvenientes, podemos dejarlo en la oficina Servientrega más cercana. Pago contra entrega 🛡️."

    ESTILO, FORMATO Y BREVEDAD (¡REGLAS INTOCABLES!):
    - Usa puntos suspensivos (...) para pausas humanas.
    - Salto de línea tras cada frase. NUNCA bloques largos.
    - Emojis sutiles y cálidos: 👋, 😊, ✨, ❤️, 🌿, 📦, 🚚, 🛡️.
    - Brevedad: Máximo 3 a 4 mensajes cortos por respuesta.

    REGLA CRÍTICA Y OBLIGATORIA DE CIERRE:
    Tu ÚLTIMO mensaje DEBE terminar con una pregunta abierta corta (?) que sea natural y coherente con lo que el cliente acaba de decir. Si está dudando, pregúntale por sus dudas ("¿Me explico bien?"). Si ya le explicaste todo, invítalo a conocer los precios.
    
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
            
            // --- ACTUALIZACIÓN DE ETAPA EN REDIS PARA LA PRÓXIMA VEZ ---
            let nuevaEtapa = etapaActual;
            if (textoFinal.includes("procediéramos con el despacho") || textoFinal.includes("opciones de precios")) nuevaEtapa = "CALIENTE";
            if (textoFinal.includes("Nombre y Apellido") || textoFinal.includes("Dirección exacta")) nuevaEtapa = "CIERRE";
            if (etapaActual === "FRIO" && /\d/.test(clienteMsg) && clienteMsg.length < 10) nuevaEtapa = "TIBIO";

            // --- SALVAVIDAS FIORELLA INTELIGENTE (PREGUNTA FINAL) ---
            const esDespedida = /hasta luego|excelente día|no dude en contactarme/i.test(textoFinal);
            const esCierreActivo = /dirección|nombre|apellido|ciudad|calle|referencia|envío|llegará|despachar/i.test(textoFinal);
            
            if (!textoFinal.includes('?') && !esDespedida && !esCierreActivo) {
                if (etapaActual === "CALIENTE") {
                    textoFinal += " ¿Le gustaría que procediéramos con el despacho del producto? 📦✨";
                } else {
                    textoFinal += " ¿Tiene alguna otra inquietud o le gustaría conocer nuestros precios y promociones? ✨";
                }
            } else if (!textoFinal.includes('?') && esCierreActivo && !esDespedida) {
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
