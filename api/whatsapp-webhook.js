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
        : "⚠️ ALERTA: EL CLIENTE NO HA MENCIONADO NINGÚN PRODUCTO. Si el cliente está pidiendo precio o saluda, dile amablemente: 'Con gusto le ayudo con la información, ¿me podría indicar en qué producto está interesado o qué malestar quiere tratar? ✨'";

    // --- 2. DETECCIÓN DE INTENCIÓN Y ESTADOS HÍBRIDA ---
    const ultimoMsgCliente = historialConversacion_arr.filter(h => h.role === 'user').pop()?.content || "";
    const msgParaIntencion = (ultimoMsgCliente + " " + msgLower).toLowerCase();

    if (etapaActual !== "CIERRE" && etapaActual !== "POSTVENTA") {
        const intencionCompra = /precio|valor|cuanto cuesta|promocion|promo|comprar|quiero uno|costo/i.test(msgParaIntencion);
        if (intencionCompra && nombreProducto !== "") {
            etapaActual = "CALIENTE";
        }
    }
  
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

   REGLA DE ORO DE ETAPAS:
    - Si el sistema dice que estás en ETAPA CALIENTE, TIENES ESTRICTAMENTE PROHIBIDO preguntar si quiere saber sobre beneficios, ingredientes o si tiene dudas. Tu prioridad es cerrar la venta. Tu pregunta FINAL debe ser obligatoriamente una doble alternativa. NO puedes preguntar solo si desea el envío. Debes preguntar qué opción prefiere..
   
   FLUJO DEL FUNNEL (DINÁMICO Y ESCUCHA ACTIVA):
    1. ETAPA FRIO: 
       - SI NO HAY PRODUCTO IDENTIFICADO: Saluda (si aplica) y pregunta directamente: "¿En qué producto está interesado o qué malestar le gustaría tratar hoy? ✨". PROHIBIDO inventar información.
       - SI YA HAY PRODUCTO IDENTIFICADO: Lanza el gancho emocional obligatorio conectando con el producto. Y cierra preguntando: "¿Le gustaría conocer más del producto, sus beneficios, ingredientes o tiene alguna duda en particular? ✨"
       
    2. ETAPA TIBIO: 
       - Acción: Conecta ingredientes con su dolor. Si tiene dudas técnicas, responde con paciencia como humana.
       - Transición: Solo cuando resolvió dudas: "¿Le gustaría que le comparta nuestras opciones de precios y promociones? 🌿✨".
       

    3. ETAPA CALIENTE (Momento Decisivo):
       - Acción: Presenta los precios leyendo estrictamente la información del producto. Vende el combo o promoción usando persuasión ("Aproveche nuestra súper oferta, se la recomiendo muchísimo..."). PROHIBIDO PREGUNTAR SI TIENE DUDAS AQUÍ. No enfríes la venta ni repitas precios si el cliente ya eligió.
       - EVALUACIÓN SEMÁNTICA (¡TÚ DECIDES!): Analiza lo que responde el cliente. Si el cliente elige UNA de las opciones usando sus propias palabras (Ej: "la primera", "la de $xx", "la promo", "uno solo", "el combo", etc...), ¡LA VENTA AVANZA! Ignora la Etapa 3, salta inmediatamente a la ETAPA 4 (Paso B) y envíale el formulario de datos.
       - Pregunta obligatoria de cierre: EXACTAMENTE ESTA: "Le recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨" (¡PROHIBIDO AÑADIR OTRA PREGUNTA!).

         
    4. ETAPA CIERRE (La Recolección): 
       - PASO A (Dijo "Sí" pero falta cantidad): Si el cliente respondió "Sí" a la pregunta anterior pero NO eligió su opción, pregúntale: "¡Excelente! Para preparar su paquete, ¿cuál opción desearía? Le aconsejo la promoción. 😊" Y DETENTE AQUÍ.
       - PASO B (Enviar Formulario): Si el cliente ya eligió su opción, envía EXACTAMENTE este texto Y DETENTE:
         "Listo, ayúdeme con los siguientes datos por favor:
         *Nombre y Apellido:*
         *Ciudad:*
         *Dirección exacta (domicilio, trabajo u oficina servientrega):* (Especifique 2 calles y una referencia clara, ej: Amazonas y Veintimilla frente a farmacia Cruz Azul)."
       - PASO DE VALIDACIÓN  del PASO B (¡LEE EL MENSAJE COMPLETO! o LOS MENSAJES): Los clientes suelen enviar todos sus datos en un solo mensaje con varias líneas. Evalúa la información con LÓGICA COMÚN:
         1. Nombre: Si el cliente escribe dos palabras, es NOMBRE Y APELLIDO VÁLIDO.
         2. Ciudad: Si menciona una ciudad, es VÁLIDO.
         3. Dirección: Si menciona dos calles y cualquier dato extra de referencia, es DIRECCIÓN VÁLIDA.
        - PASO C (Recolección Flexible - ¡SÚPER IMPORTANTE!): Evalúa CÓMO responde el cliente:
         * CASO 1 (Todo de golpe): Si el cliente te manda su nombre, ciudad y dirección en UN SOLO MENSAJE (usando comas o saltos de línea), ¡PERFECTO! Pasa INMEDIATAMENTE al PASO D. Tienes prohibido validar pieza por pieza.
         * CASO 2 (Mensajes por partes): Si el cliente te envía la información de a poco (ej: manda solo el nombre en un mensaje), NO lo regañes ni repitas el formulario. Chatea natural: "Anotado 📝. ¿De qué ciudad nos escribe?". Si da la ciudad: "Perfecto. ¿Me ayuda con su dirección exacta por favor?".
       - PASO D (Aprobación Inmediata y Cierre): Revisa el historial constantemente. En el instante en que confirmes que ya tienes Nombre, Ciudad y Dirección (ya sea porque lo mandó todo junto o lo reuniste por partes), ¡LA VENTA ESTÁ CERRADA! Lanza DIRECTAMENTE sin pedir más confirmaciones: "¡Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras seguras (Servientrega, Gintracon, Veloces o Laar). Las entregas son de 9am a 5pm. Pago contra entrega 🛡️."
    
    5. ETAPA POSTVENTA (¡CUIDADO AQUI!):
       - Si la Etapa Actual es POSTVENTA, significa que el cliente ya compró y se despidió.
       - TIENES ESTRICTAMENTE PROHIBIDO SALUDAR DE NUEVO, REINICIAR LA VENTA O PREGUNTAR ALGO.
       - Tu ÚNICA respuesta debe ser exacta y literalmente esta: "¡De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊".

    ESTILO, FORMATO Y BREVEDAD:
    - Usa puntos suspensivos (...) para pausas humanas. NUNCA bloques largos.
    - Emojis sutiles: 👋, 😊, ✨, ❤️, 🌿, 📦, 🚚, 🛡️.

    REGLA CRÍTICA Y OBLIGATORIA:
    Tu ÚLTIMO mensaje DEBE terminar con una pregunta abierta corta (?), EXCEPTO en la confirmación final y en la ETAPA POSTVENTA, donde está estrictamente prohibido hacer preguntas.
    
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
            
            // --- ACTUALIZACIÓN DE ETAPA BASADA EN LAS DECISIONES DE LA IA ---
            let nuevaEtapa = etapaActual;
            if (textoFinal.includes("procediéramos con el despacho") || textoFinal.includes("Desea que se lo enviemos")) nuevaEtapa = "CALIENTE";
            if (textoFinal.includes("Nombre y Apellido") || textoFinal.includes("Dirección exacta")) nuevaEtapa = "CIERRE";
            if (etapaActual === "CIERRE" && (textoFinal.includes("excelente día") || textoFinal.includes("las órdenes"))) nuevaEtapa = "POSTVENTA";

            // --- SALVAVIDAS FIORELLA INTELIGENTE ---
            const esDespedida = /hasta luego|excelente día|no dude en contactarme|órdenes/i.test(textoFinal) || etapaActual === "POSTVENTA";
            const esCierreActivo = /dirección|nombre|apellido|ciudad|calle|referenvío|llegará|despachar/i.test(textoFinal);
            
            if (!textoFinal.includes('?') && !esDespedida && !esCierreActivo) {
                if (etapaActual === "CALIENTE") {
                    // Texto genérico para cualquier promoción
                    textoFinal += " Le recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨";
                } else {
                    textoFinal += " ¿Tiene alguna otra inquietud o le gustaría conocer nuestros precios y promociones? ✨";
                }
            } else if (etapaActual === "CALIENTE" && !textoFinal.toLowerCase().includes("cuál") && !textoFinal.toLowerCase().includes("cual")) {
                // Refuerzo si la IA hace la pregunta de envío pero olvida la de elección
                textoFinal = textoFinal.replace("¿Desea que se lo enviemos", "¿Cuál desearía? Le recomiendo la promoción... ¿Desea que se lo enviemos");
                }
                       
             else if (!textoFinal.includes('?') && esCierreActivo && !esDespedida && etapaActual !== "CIERRE") {
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
