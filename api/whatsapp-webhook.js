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

    // --- LÓGICA DE DÍAS (HORA ECUADOR -5) ---
    const utc = new Date().getTime() + (new Date().getTimezoneOffset() * 60000);
    const hoy = new Date(utc + (3600000 * -5)); 
    const nombresDias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    
    let dia1 = new Date(hoy); dia1.setDate(hoy.getDate() + 1);
    if(dia1.getDay() === 0) dia1.setDate(dia1.getDate() + 1); 
    if(dia1.getDay() === 6) dia1.setDate(dia1.getDate() + 2); 
    
    let dia2 = new Date(dia1); dia2.setDate(dia1.getDate() + 1);
    if(dia2.getDay() === 0) dia2.setDate(dia2.getDate() + 1);
    if(dia2.getDay() === 6) dia2.setDate(dia2.getDate() + 2);

    const mañana = nombresDias[dia1.getDay()];
    const pasado = nombresDias[dia2.getDay()];
    
    // --- HELPERS REDIS ---
    const redisGet = async (key) => {
        const r = await fetch(`${KV_REST_API_URL}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["GET", key])
        });
        const d = await r.json();
        return d.result || null;
    };

    const redisSetex = async (key, seconds, value) => {
        await fetch(`${KV_REST_API_URL}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["SETEX", key, seconds, value])
        });
    };
    
    // --- 1. ANTI-DUPLICADOS (PROTECCIÓN DE SALDO) ---
    try {
        const existe = await redisGet(`dd:${msgId}`);
        if (existe) return res.status(200).send('OK');
        await redisSetex(`dd:${msgId}`, 60, "1");
    } catch (e) { console.error("Dedup error:", e.message); }

    // --- 2. HISTORIAL Y ETAPA ---
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
        if (guardado) {
            historialConversacion_arr = JSON.parse(decodeURIComponent(guardado));
        }
        if (etapaGuardada) etapaActual = etapaGuardada;
    } catch (e) { console.error("Error leyendo memoria:", e.message); }
    
    const msgLower = clienteMsg.toLowerCase().trim();
    let infoEspecifica = "";
    let nombreProducto = "";
    const productoKey = `prod:${cleanJid}`;

    // --- 3. BUSCAR PRODUCTO ---
    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
        let productoEncontrado = dataProductos.PRODUCTOS.find(p => p.keywords.some(k => msgLower.includes(k.toLowerCase())));
        
        if (productoEncontrado) {
            await redisSetex(productoKey, 86400, JSON.stringify(productoEncontrado));
        } else {
            const productoGuardado = await redisGet(productoKey);
            if (productoGuardado) productoEncontrado = JSON.parse(decodeURIComponent(productoGuardado));
        }
        
        if (productoEncontrado) {
            nombreProducto = productoEncontrado.nombre;
            infoEspecifica = fs.readFileSync(path.join(process.cwd(), 'api', productoEncontrado.archivo), 'utf8');
        }
    } catch (e) { console.error("Error productos:", e.message); }

    const baseConocimiento = infoEspecifica 
        ? `CLIENTE INTERESADO EN: ${nombreProducto.toUpperCase()}.\nINFO:\n${infoEspecifica}`
        : "⚠️ ALERTA: Preguntar qué producto o malestar desea tratar.";

    // --- 4. LÓGICA DE ETAPAS ---
    if (etapaActual === "CALIENTE" && /primera|segunda|promo|unidad|1|2|combo|uno|dos/i.test(msgLower)) {
        etapaActual = "CIERRE";
    } else if (etapaActual !== "CIERRE" && /precio|valor|cuanto|costo/i.test(msgLower) && nombreProducto !== "") {
        etapaActual = "CALIENTE";
    }

    const esPrimerMensaje = historialConversacion_arr.length === 0;
    historialConversacion_arr.push({ role: "user", content: clienteMsg });

    // --- 5. MASTER PROMPT INTEGRAL (RESTAURADO) ---
    let instruccionesEtapa = "";
    if (etapaActual === "FRIO") {
        instruccionesEtapa = `OBJETIVO: Indagación Inicial. Presenta el producto y pregunta si quiere saber más.`;
    } else if (etapaActual === "TIBIO") {
        instruccionesEtapa = `OBJETIVO: Educación. Resuelve dudas y ofrece ver precios.`;
    } else if (etapaActual === "CALIENTE") {
        instruccionesEtapa = `OBJETIVO: Venta Directa. Presenta precios. Cierra con: "¿Cuál de las opciones desearía que le enviemos? 📦✨"`;
    } else if (etapaActual === "CIERRE") {
        instruccionesEtapa = `OBJETIVO: Recolección de Datos. El sistema pedirá los datos. Si tienes todo, confirma con éxito.`;
    }

    const masterPrompt = `
    IDENTIDAD: Fiorella de JRJMarket, asesora en neuromarketing. Trato de USTED.
    ETAPA ACTUAL: [${etapaActual}]
    ESTADO: ${esPrimerMensaje ? 'Saludar primero.' : 'No saludar.'}
    INSTRUCCIONES: ${instruccionesEtapa}
    CONOCIMIENTO: ${baseConocimiento}
    HISTORIAL: ${historialConversacion_arr.map(h => `${h.role}: ${h.content}`).join('\n')}`;

    try {
        const bodyIA = {
            messages: [{ role: "system", content: masterPrompt }, ...historialConversacion_arr],
            temperature: 0.7,
            model: provider === 'grok' ? "grok-2-latest" : "gpt-4o-mini"
        };

        const respIA = await fetch(provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${(provider === 'grok' ? GROK_API_KEY : OPENAI_API_KEY).trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyIA)
        });
        const jsonIA = await respIA.json();
        let textoFinal = jsonIA.choices?.[0]?.message?.content || "";

        if (textoFinal) {
            textoFinal = textoFinal.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();
            
            let nuevaEtapa = etapaActual;
            if (textoFinal.includes("registrados con éxito")) nuevaEtapa = "POSTVENTA";

            // --- 6. SALVAVIDAS FIORELLA (INYECCIÓN DE FORMULARIO) ---
            const esDespedida = /excelente día|órdenes|éxito/i.test(textoFinal);
            const yaTieneForm = /Nombre y Apellido:/i.test(textoFinal);

            if (!textoFinal.includes('?') && !esDespedida) {
                if (nuevaEtapa === "CIERRE" && !yaTieneForm) {
                    textoFinal += "\n\nListo, ayúdeme con estos datos por favor:\n*Nombre y Apellido:*\n*Ciudad:*\n*Dirección exacta:* (2 calles y referencia).";
                } else if (nuevaEtapa === "CALIENTE") {
                    textoFinal += "\n\nLe recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨";
                }
            }

            // GUARDAR
            historialConversacion_arr.push({ role: "assistant", content: textoFinal });
            await redisSetex(memoriaKey, 86400, encodeURIComponent(JSON.stringify(historialConversacion_arr.slice(-15))));
            await redisSetex(stageKey, 86400, nuevaEtapa);

            // ENVÍO CASCADA
            const partes = textoFinal.split('\n\n').filter(p => p.trim());
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                await new Promise(r => setTimeout(r, 1000));
            }
        } 
    } catch (error) { console.error("Error flujo:", error.message); }
    return res.status(200).send('OK');
};
