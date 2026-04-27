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
    
   // --- HELPERS REDIS (CORREGIDOS PARA MEMORIA INFINITA) ---
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
        if (guardado) {
            let memoriaLimpia = guardado;
            try { memoriaLimpia = decodeURIComponent(guardado); } catch(e) {}
            historialConversacion_arr = JSON.parse(memoriaLimpia);
        }
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

    // --- 2. DETECCIÓN DE INTENCIÓN Y ESTADOS HÍBRIDA ---
    const ultimoMsgCliente = historialConversacion_arr.filter(h => h.role === 'user').pop()?.content || "";
    const msgParaIntencion = (ultimoMsgCliente + " " + msgLower).toLowerCase();

    // Si ya estamos en CALIENTE y el cliente elige una opción (1, 2, primera, etc.)
    const eligioOpcion = /primera|segunda|promo|unidad|1|2|combo|uno|dos|esa|la de/i.test(msgLower);
    
    if (etapaActual === "CALIENTE" && eligioOpcion) {
        etapaActual = "CIERRE";
        console.log(`[LOG] ¡SALTO DETECTADO! El cliente eligió opción. Nueva Etapa: CIERRE`);
    } else if (etapaActual !== "CIERRE" && etapaActual !== "POSTVENTA") {
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

    // --- CONSTRUCCIÓN DINÁMICA DEL PROMPT (USANDO LÓGICA IF/ELSE) ---
    let instruccionesEtapa = "";

    if (etapaActual === "FRIO") {
        instruccionesEtapa = `
        OBJETIVO: Estás en la etapa de Indagación Inicial.
        - Si en tu CONOCIMIENTO hay una "ALERTA": Tu ÚNICA respuesta debe ser: "¿En qué producto está interesado o qué malestar le gustaría tratar hoy? ✨"
        - Si en tu CONOCIMIENTO hay información de un producto: Redacta un párrafo corto maximo 3 mensjaes, explicando qué es y para qué sirve. Cierra OBLIGATORIAMENTE con: "¿Le gustaría conocer más del producto, sus beneficios, ingredientes o tiene alguna duda en particular? ✨"
        `;
    } else if (etapaActual === "TIBIO") {
        instruccionesEtapa = `
        OBJETIVO: Estás en la etapa de Educación.
        - Conecta los ingredientes del producto con el dolor del cliente. Resuelve sus dudas.
        - Cuando ya no tenga dudas, cierra con: "¿Le gustaría que le comparta nuestras opciones de precios y promociones? 🌿✨"
        `;
    } else if (etapaActual === "CALIENTE") {
        instruccionesEtapa = `
        OBJETIVO: Estás en la etapa de Venta Directa (Precios).
        - Si el cliente aún no sabe qué hace el producto, dale una breve descripción de 1 línea.
        - Presenta los precios estrictamente desde tu conocimiento.
        - TIENES ESTRICTAMENTE PROHIBIDO preguntar si tiene dudas o si quiere conocer beneficios.
        - CIERRE OBLIGATORIO: Termina tu mensaje ÚNICAMENTE con: "Le recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨"
        `;
    } else if (etapaActual === "CIERRE") {
        instruccionesEtapa = `
        OBJETIVO: Estás en la etapa de Recolección de Datos. Eres amable pero técnica aquí.

        CHECKLIST OBLIGATORIO (Revisa historial y mensaje actual):
        1. [NOMBRE]: ¿Tengo Nombre y Apellido?
        2. [CIUDAD]: ¿Sé a qué Ciudad o Provincia va el pedido?
        3. [DIRECCIÓN]: ¿Tengo la calle principal, la calle secundaria y una referencia (ej: frente a, color de casa, edificio), o debo tener por lo menos nombre de urbanización, con numero de lote, numero de manzana y departamento o casa?

        REGLAS DE RESPUESTA:
        - Si el mensaje está VACÍO de datos: Envía el formulario del PASO A.
        - Si los datos están INCOMPLETOS: Menciona lo que YA tienes y pide específicamente lo que FALTA para completar los 3 puntos del checklist. 
          (Ejemplo: "¡Listo! Ya tengo su nombre y ciudad. Para agendar, por favor dígame las *dos calles* de su dirección y una *referencia clara*.")
        - Si los datos están COMPLETOS (cumple los 3 puntos del checklist): Pasa directamente al PASO C.

        PASO A (Formulario Inicial):
          "Listo, ayúdeme con los siguientes datos por favor:
       1. PROCESAMIENTO GENÉRICO:
           - Analiza el mensaje actual y el historial buscando: [Nombre del destinatario], [Ciudad de destino] y [Dirección/Referencia].
           - No busques palabras exactas; busca el contexto. Si el cliente menciona un lugar, asúmelo como Ciudad o Sector.
        
        2. VALIDACIÓN DINÁMICA:
           - Si el cliente ya proporcionó información que razonablemente identifica su ubicación (aunque sea solo el nombre de un barrio o ciudad), NO vuelvas a preguntar por ello.

        - PASO A: Si el historial está vacío de datos, pedir los datos del cliente, DEBES usar EXACTAMENTE el siguiente bloque de texto, sin añadir ni quitar una sola palabra. Es una orden técnica:
          "Listo, ayúdeme con los siguientes datos por favor:
          *Nombre y Apellido:*
          *Ciudad:*
          *Dirección exacta:* (Especifique 2 calles y una referencia clara)."

        - PASO B (Recolección Flexible): Si envía datos por partes, chatea natural: "Anotado 📝. ¿De qué ciudad nos escribe?"
        - PASO C (CIERRE DE VENTA): Si ya tienes Nombre, Ciudad y Dirección, lanza: "¡Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracon, velosces, Urbano o Laar) por su seguras. Las entregas son de 9am a 5pm. Pago contra entrega 🛡️."
        - REGLA ANTI-DESPEDIDA: No digas "gracias por su compra" ni te despidas hasta haber enviado el mensaje de "Datos registrados con éxito".
        `;
  
    } else if (etapaActual === "POSTVENTA") {
        instruccionesEtapa = `
        OBJETIVO: Despedida.
        - Respuesta ÚNICA: "¡De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊".
        `;
    }

    const masterPrompt = `
    IDENTIDAD Y FILOSOFÍA:
    Eres Fiorella de JRJMarket, asesora en neuromarketing. Humana y empática. Trato de USTED.
    
    ESTADO DE LA CONVERSACIÓN:
    - ES PRIMER MENSAJE: ${esPrimerMensaje ? 'SÍ - Inicia diciendo: "¡Hola! Muy buenas... Un gusto saludarle 😊".' : 'NO - Continúa la charla natural.'}

    INSTRUCCIONES ESTRICTAS PARA TU ETAPA ACTUAL (${etapaActual}):
    ${instruccionesEtapa}

    REGLAS GENERALES:
    - Usa puntos suspensivos (...) para pausas humanas.
    - Tu ÚLTIMO mensaje DEBE terminar con una pregunta (?), EXCEPTO cuando envías el formulario, confirmas el envío, o en Postventa.
    
    CONOCIMIENTO ACTUAL DEL PRODUCTO: 
    ${baseConocimiento}
    
    HISTORIAL RECIENTE: 
    ${contextoMemoria}
    `;

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

            // Verificamos si la IA detectó que debe cerrar
            const detectoDatos = textoFinal.toLowerCase().includes("nombre y apellido");
            console.log(`[LOG] ¿IA incluyó Formulario?: ${detectoDatos}`);
            
            // Si la IA menciona datos del formulario, FORZAMOS etapa CIERRE
            if (textoFinal.toLowerCase().includes("nombre y apellido") || 
                textoFinal.toLowerCase().includes("dirección exacta") || 
                textoFinal.toLowerCase().includes("ayúdeme con los siguientes datos")) {
                nuevaEtapa = "CIERRE";
            } 
            // Si ya confirmó el registro, pasamos a POSTVENTA
            else if (textoFinal.includes("registrados con éxito")) {
                nuevaEtapa = "POSTVENTA";
            }
            // Si ofrece opciones pero no pide datos, se queda en CALIENTE
            else if (textoFinal.includes("Cuál de las opciones desearía")) {
                nuevaEtapa = "CALIENTE";
            }

           // --- SALVAVIDAS FIORELLA INTELIGENTE (SIN CONFLICTOS) ---
            const esDespedida = /hasta luego|excelente día|no dude en contactarme|órdenes/i.test(textoFinal) || nuevaEtapa === "POSTVENTA";
            const esCierreActivo = /dirección|nombre|apellido|ciudad|calle|referencia|datos/i.test(textoFinal.toLowerCase());

    console.log(`[LOG] Salvavidas Check -> Etapa: ${nuevaEtapa} | Tiene ?: ${textoFinal.includes('?')} | Es Cierre Activo: ${esCierreActivo}`);

            
            // Solo agregamos preguntas si NO estamos en CIERRE y NO estamos despidiendo
            if (!textoFinal.includes('?') && !esDespedida && !esCierreActivo) {
                if (nuevaEtapa === "CALIENTE") {
                    textoFinal += " Le recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨";
                } else if (nuevaEtapa === "FRIO") {
                    textoFinal += " ¿Tiene alguna otra inquietud o le gustaría conocer nuestros precios y promociones? ✨";
                }
            } 
            // Si la IA mandó el formulario pero olvidó la pregunta técnica de cierre, le ponemos una suave
            else if (!textoFinal.includes('?') && esCierreActivo && nuevaEtapa === "CIERRE" && !esDespedida) {
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
            if (partes.length > 8) {
                const preguntaFinal = partes.pop();
                partes = partes.slice(0, 7);
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
