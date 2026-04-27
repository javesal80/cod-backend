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
    
    try {
        const existe = await redisGet(`dd:${msgId}`);
        if (existe) return res.status(200).send('OK');
        await redisSetex(`dd:${msgId}`, 60, "1");
    } catch (e) {
        console.error("Dedup error:", e.message);
    }

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
            let memoriaLimpia = guardado;
            try { memoriaLimpia = decodeURIComponent(guardado); } catch(e) {}
            historialConversacion_arr = JSON.parse(memoriaLimpia);
        }
        if (etapaGuardada) etapaActual = etapaGuardada;
    } catch (e) {
        console.error("Error leyendo memoria:", e.message);
    }
    
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
                if (productoGuardado) {
                    let prodLimpio = productoGuardado;
                    try { prodLimpio = decodeURIComponent(productoGuardado); } catch(e) {}
                    productoEncontrado = JSON.parse(prodLimpio);
                }
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
        : "⚠️ ALERTA: EL CLIENTE NO HA MENCIONADO NINGÚN PRODUCTO. Si el cliente está pidiendo precio o saluda, dile amablemente: 'Con gusto le ayudo con la información, ¿me podría indicar en qué producto está interesado o qué malestar quiere tratar? ✨'";

    const ultimoMsgCliente = historialConversacion_arr.filter(h => h.role === 'user').pop()?.content || "";
    const msgParaIntencion = (ultimoMsgCliente + " " + msgLower).toLowerCase();

    if (etapaActual !== "CIERRE" && etapaActual !== "POSTVENTA") {
        const intencionCompra = /precio|valor|cuanto cuesta|promocion|promo|comprar|quiero uno|costo/i.test(msgParaIntencion);
        if (intencionCompra && nombreProducto !== "") {
            etapaActual = "CALIENTE";
        }
    }

    if (etapaActual === "CALIENTE" && /primera|segunda|promo|unidad|1|2|combo|uno|dos/i.test(msgLower)) {
        etapaActual = "CIERRE";
    }

    const ultimoMsgIA = historialConversacion_arr.filter(h => h.role === 'assistant').pop()?.content || "";
    if (/precios|promociones|promoción/i.test(ultimoMsgIA) && /si|sí|claro|por supuesto|dale/i.test(msgLower)) {
        etapaActual = "CALIENTE";
    }
       
    const esPrimerMensaje = historialConversacion_arr.length === 0;
    historialConversacion_arr.push({ role: "user", content: clienteMsg });
    if (historialConversacion_arr.length > 20) historialConversacion_arr = historialConversacion_arr.slice(-20);

    const contextoMemoria = historialConversacion_arr
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Fiorella'}: ${h.content}`)
        .join('\n');

    let instruccionesEtapa = "";
    if (etapaActual === "FRIO") {
        instruccionesEtapa = `OBJETIVO: Estás en la etapa de Indagación Inicial...`;
    } else if (etapaActual === "TIBIO") {
        instruccionesEtapa = `OBJETIVO: Estás en la etapa de Educación...`;
    } else if (etapaActual === "CALIENTE") {
        instruccionesEtapa = `OBJETIVO: Estás en la etapa de Venta Directa (Precios)...`;
    } else if (etapaActual === "CIERRE") {
        instruccionesEtapa = `OBJETIVO: Estás en la etapa de Recolección de Datos...`;
    } else if (etapaActual === "POSTVENTA") {
        instruccionesEtapa = `OBJETIVO: Despedida.`;
    }

    const masterPrompt = `IDENTIDAD Y FILOSOFÍA: Fiorella... ETAPA: ${etapaActual}. INFO: ${baseConocimiento}. HISTORIAL: ${contextoMemoria}`;

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
            
            let nuevaEtapa = etapaActual;
            
            // --- CORRECCIÓN DE LLAVES AQUÍ ---
            if (textoFinal.toLowerCase().includes("nombre y apellido") || 
                textoFinal.toLowerCase().includes("dirección exacta") || 
                textoFinal.toLowerCase().includes("ayúdeme con los siguientes datos")) {
                nuevaEtapa = "CIERRE";
            } else if (textoFinal.includes("registrados con éxito")) {
                nuevaEtapa = "POSTVENTA";
            } else if (etapaActual === "CIERRE" || textoFinal.toLowerCase().includes("nombre y apellido")) {
                nuevaEtapa = "CIERRE";
            } else if (textoFinal.includes("Cuál de las opciones desearía")) {
                nuevaEtapa = "CALIENTE";
            }

            const esDespedida = /hasta luego|excelente día|no dude en contactarme|órdenes/i.test(textoFinal) || nuevaEtapa === "POSTVENTA";
            const esConfirmacionFinal = /registrados con éxito/i.test(textoFinal);
            const yaTieneFormulario = /Nombre y Apellido:/i.test(textoFinal);

            if (!esDespedida && !esConfirmacionFinal) {
                if (nuevaEtapa === "CIERRE" && !yaTieneFormulario) {
                    textoFinal += `\n\nListo, ayúdeme con los siguientes datos por favor:\n*Nombre y Apellido:*\n*Ciudad:*\n*Dirección exacta:* (Especifique 2 calles y una referencia clara, ej: Amazonas y Veintimilla frente a farmacia Cruz Azul).`;
                } else if (nuevaEtapa === "CALIENTE" && !textoFinal.includes('?')) {
                    textoFinal += " Le recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨";
                } else if (nuevaEtapa === "FRIO" && !textoFinal.includes('?')) {
                    textoFinal += " ¿Tiene alguna otra inquietud o le gustaría conocer nuestros precios y promociones? ✨";
                }
            }

            await redisSetex(memoriaKey, 86400, JSON.stringify(historialConversacion_arr.concat({ role: "assistant", content: textoFinal })));
            await redisSetex(stageKey, 86400, nuevaEtapa);

            const keysAdmin = ["confirmado", "registrado", "dirección", "nombre", "calle", "ciudad", "provincia", "sector"];
            if (keysAdmin.some(k => clienteMsg.toLowerCase().includes(k)) && clienteMsg.length > 5) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: NUMERO_ADMIN, text: `📢 *NUEVA VENTA/DATO*\nDe: ${remoteJid}\nMsg: ${clienteMsg}` })
                });
            }

            let partes = textoFinal.replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n").split('\n').map(l => l.trim()).filter(l => l !== "");
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
