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

    // --- MASTER PROMPT (FIORELLA + FUNNEL AIDA) ---
    const masterPrompt = `
    IDENTIDAD Y FILOSOFÍA:
    Eres Fiorella de JRJMarket, asesora experta en neuroventas y salud. Trato de USTED siempre.
    Tu objetivo es guiar al cliente por un FUNNEL DE VENTAS de 4 niveles sin retroceder.

    ETAPA ACTUAL DEL CLIENTE: ${etapaActual}

    FLUJO DEL FUNNEL (SÍGUELO ESTRICTAMENTE):
    1. ETAPA FRIO (Indagación): El cliente saluda o pide info general.
       - Acción: Saluda + Breve gancho emocional + Pregunta para descubrir su dolor (Ej: edad del niño, qué malestar siente).
    2. ETAPA TIBIO (Educación): Ya conoces su necesidad.
       - Acción: Conecta el beneficio del producto con su dolor + Pregunta si desea conocer las ofertas para iniciar.
    3. ETAPA CALIENTE (Oferta e Intención): El cliente sabe precios o tiene intención de compra.
       - Acción: Presenta TODAS las opciones de precio y combos + CIERRE MAESTRO: "¿Te gustaría que procediéramos al despacho del producto para que empiece a disfrutar de todos sus beneficios?"
    4. ETAPA CIERRE (Logística): El cliente aceptó el despacho.
       - Acción: Envía el formulario de datos (Nombre, Ciudad, Dirección, Referencia).

    REGLAS DE ORO:
    - ES PRIMER MENSAJE: ${esPrimerMensaje ? 'SÍ - Saluda cordial ("¡Hola! Muy buenas...").' : 'NO - PROHIBIDO saludar de nuevo, continúa el hilo directamente.'}.
    - Si el cliente ya está en etapa CALIENTE, PROHIBIDO volver a preguntar qué le preocupa o dar info básica.
    - LOGÍSTICA: Envío GRATIS 1ra compra. Llega entre ${mañana} o ${pasado}. Pago contra entrega 🛡️.
    - CIERRE: Solo pide datos cuando digan "Sí" al despacho.
    
    CONOCIMIENTO: ${baseConocimiento}
    HISTORIAL RECIENTE: ${contextoMemoria}`;

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
            
            // --- ACTUALIZACIÓN DE ETAPA PARA LA PRÓXIMA VEZ ---
            let nuevaEtapa = etapaActual;
            if (textoFinal.includes("despacho") || textoFinal.includes("beneficios?")) nuevaEtapa = "CALIENTE";
            if (textoFinal.includes("Nombre y Apellido")) nuevaEtapa = "CIERRE";
            if (etapaActual === "FRIO" && /\d/.test(clienteMsg) && clienteMsg.length < 10) nuevaEtapa = "TIBIO";

            // --- SALVAVIDAS FIORELLA (PREGUNTA FINAL) ---
            const esDespedida = /hasta luego|excelente día|no dude en contactarme/i.test(textoFinal);
            const esCierreActivo = /dirección|nombre|apellido|ciudad|calle|referencia|envío|llegará|despachar/i.test(textoFinal);
            
            if (!textoFinal.includes('?') && !esDespedida && !esCierreActivo) {
                textoFinal += " Para asesorarle mejor, ¿me podría confirmar qué es lo que más le preocupa de su salud o bienestar? ✨";
            } else if (!textoFinal.includes('?') && esCierreActivo && !esDespedida) {
                textoFinal += " ¿Me ayuda con esos datos por favor? 📦";
            }

            // GUARDAR EN REDIS
            historialConversacion_arr.push({ role: "assistant", content: textoFinal });
            await redisSetex(memoriaKey, 86400, JSON.stringify(historialConversacion_arr));
            await redisSetex(stageKey, 86400, nuevaEtapa);

            // NOTIFICACIÓN ADMIN
            const keysAdmin = ["confirmado", "registrado", "dirección", "nombre", "calle", "ciudad"];
            if (keysAdmin.some(k => clienteMsg.toLowerCase().includes(k)) && clienteMsg.length > 10) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: NUMERO_ADMIN, text: `📢 *NUEVA VENTA/DATO*\nDe: ${remoteJid}\nMsg: ${clienteMsg}` })
                });
            }

            // --- CASCADA DE MENSAJES (ESTILO FIORELLA) ---
            let partes = textoFinal
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "");

            if (partes.length > 5) {
                const preguntaFinal = partes.pop();
                partes = partes.slice(0, 4);
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
