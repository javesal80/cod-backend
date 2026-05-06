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
    let imgProducto = "";      
    let imgBeneficios = "";    
    let imgTestimonios = "";   
    const productoKey = `prod:${cleanJid}`;
console.log("🔍 [DIAG] Mensaje para buscar:", msgLower);
    
    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            console.log("📂 [DIAG] productos.json cargado.");
            
             let productoEncontrado = dataProductos.PRODUCTOS.find(p => 
                p.keywords && p.keywords.some(k => {
                    const detectado = msgLower.includes(k.toLowerCase());
                    if (detectado) {
                        // El log DEBE ir aquí adentro para que reconozca a 'k' y a 'p'
                        console.log(`🎯 [DIAG] Keyword detectada: "${k}" en producto: ${p.nombre}`);
                    }
                    return detectado;
                })
            );
            
            if (productoEncontrado) {
                await redisSetex(productoKey, 86400, JSON.stringify(productoEncontrado));
            } else {
                console.log("❓ [DIAG] No hay keyword en mensaje. Buscando en Redis...");
                const productoGuardado = await redisGet(productoKey);
                if (productoGuardado) {
                    let prodLimpio = productoGuardado;
                    try { prodLimpio = decodeURIComponent(productoGuardado); } catch(e) {}
                    productoEncontrado = JSON.parse(prodLimpio);
                    console.log("🧠 [DIAG] Recuperado de Redis:", productoEncontrado.nombre);
                }
            }

           if (productoEncontrado) {
                console.log("💾 [DIAG] Guardando en Redis:", productoEncontrado.nombre);
                nombreProducto = productoEncontrado.nombre;
                
                // Capturamos las 3 posibles imágenes
                imgProducto = productoEncontrado.img_producto || "";
                imgBeneficios = productoEncontrado.img_beneficios || "";
                imgTestimonios = productoEncontrado.img_testimonios || "";
                
                const txtPath = path.join(process.cwd(), 'api', productoEncontrado.archivo);
                console.log("📄 [DIAG] Buscando archivo físico en:", txtPath);
                
                if (fs.existsSync(txtPath)) infoEspecifica = fs.readFileSync(txtPath).toString('utf-8');
                console.log("✅ [DIAG] TXT cargado. Caracteres:", infoEspecifica.length);
            }
        }            
    } catch (e) {
        console.error("Error en productos:", e.message);
    }

    const baseConocimiento = infoEspecifica 
        
        ? `EL CLIENTE ESTÁ INTERESADO EN: ${nombreProducto.toUpperCase()}.\nUSA ESTA INFO TÉCNICA Y PRECIOS:\n${infoEspecifica}`
        : "⚠️ ALERTA: EL CLIENTE NO HA MENCIONADO NINGÚN PRODUCTO. Si el cliente está pidiendo precio o saluda, dile amablemente: 'Con gusto le ayudo con información, ¿me podría indicar en qué producto está interesado o qué malestar desearia tratar? ✨'";

// --- 2. DETECCIÓN DE INTENCIÓN Y ESTADOS HÍBRIDA ---
    let etapaPrevia = etapaActual; // GUARDAMOS ESTADO PARA NO REPETIR LA MISMA FOTO EN CADA MENSAJE

    const ultimoMsgCliente = historialConversacion_arr.filter(h => h.role === 'user').pop()?.content || "";
    const msgParaIntencion = (ultimoMsgCliente + " " + msgLower).toLowerCase();

    const eligioOpcion = /primera|segunda|promo|unidad|1|2|combo|uno|dos|esa|la de/i.test(msgLower);
    const intencionCompra = /precio|valor|cuanto cuesta|promocion|promo|comprar|quiero uno|costo/i.test(msgParaIntencion);
    const afirmacionBasica = /^(si|sí|claro|por supuesto|dale|ok|okay|bueno|ya)$/i.test(msgLower);
    const negacionBasica = /^(no|nop|nada|ninguna|no gracias|no necesito)$/i.test(msgLower);
    
    if (etapaActual === "CALIENTE" && eligioOpcion) {
        etapaActual = "CIERRE";
    } else if (etapaActual !== "CIERRE" && etapaActual !== "POSTVENTA") {
        if (intencionCompra && nombreProducto !== "") {
            etapaActual = "CALIENTE";
        } else if (etapaActual === "FRIO" && afirmacionBasica) {
            etapaActual = "TIBIO"; 
        } else if ((etapaActual === "TIBIO" || etapaActual === "FRIO") && negacionBasica) {
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

    // --- CONSTRUCCIÓN DINÁMICA DEL PROMPT ---
    let instruccionesEtapa = "";

    if (etapaActual === "FRIO") {
        instruccionesEtapa = `
        ETAPA: Indagación Inicial.
        - Eres una experta humana. Tienes control de la conversación.
        - "Urga en la herida" sutilmente usando la información del producto.
        - NO des precios.
        - Continúa la charla de forma natural.
        `;
    } else if (etapaActual === "TIBIO") {
        instruccionesEtapa = `
        ETAPA: Educación y Precierre.
        - Eres la dueña de la conversación. Analiza todo el historial.
        - Si el cliente tiene dudas, resuélvelas conectando ingredientes con su dolor.
        - Si notas que el cliente ya entendió o que quiere avanzar, guíalo tú misma hacia la venta de forma natural.
        - USA TUS PROPIAS PALABRAS, sé empática y adapta tus respuestas a lo que él diga. No actúes como robot.
        `;
    } else if (etapaActual === "CALIENTE") {
        instruccionesEtapa = `
        ETAPA: Venta Directa (Precios).
        - Presenta los precios estrictamente desde tu conocimiento.
        - CIERRE OBLIGATORIO: Termina tu mensaje ÚNICAMENTE con: "Le recomiendo la promoción para obtener mejores resultados. ¿Cuál de las opciones desearía que le enviemos? 📦✨"
        `;
    } else if (etapaActual === "CIERRE") {
        instruccionesEtapa = `
        OBJETIVO: Estás en la etapa de Recolección de Datos. Eres amable pero técnica aquí.

        CHECKLIST OBLIGATORIO (Revisa historial y mensaje actual):
        1. [NOMBRE y APELLIDO]: ¿Tengo Nombre y Apellido?
        2. [CIUDAD]: ¿Sé a qué Ciudad o Provincia va el pedido?
        3. [DIRECCIÓN]: ¿Tengo la calle principal, la calle secundaria y una referencia (ej: frente a, color de casa, edificio), o debo tener por lo menos nombre de urbanización, con numero de lote, numero de manzana y departamento o casa?

        REGLAS DE RESPUESTA:
        - Si el mensaje está VACÍO de datos: Envía el formulario del PASO A.
        - Si los datos están INCOMPLETOS: Menciona lo que YA tienes y pide específicamente lo que FALTA para completar los 3 puntos del checklist. 
          (Ejemplo: "¡Listo! Ya tengo su nombre y ciudad. Para agendar, por favor dígame las *dos calles* de su dirección y una *referencia clara*.")
        - Si los datos están COMPLETOS (cumple los 3 puntos del checklist): Pasa directamente al PASO C.
        
        REGLA DE NO INTERFERENCIA (Cédula y Correo):
        - NO pidas Cédula ni Correo. 
        - Si el cliente los incluye por iniciativa propia en su mensaje, simplemente regístralos en el historial.
        - Bajo ninguna circunstancia detengas el proceso o preguntes por estos datos si el cliente no los envió.
        - No valides rígidamente el formato de estos datos opcionales para no atascar la conversación.
              
        PASO A (Formulario Inicial):
          "Listo, ayúdeme con los siguientes datos por favor:
                      
       1. PROCESAMIENTO GENÉRICO:
           - Analiza el mensaje actual y el historial buscando: [Nombre y Apellido del destinatario], [Ciudad de destino] y [Dirección/Referencia].
           - No busques palabras exactas; busca el contexto. Si el cliente menciona un lugar, asúmelo como Ciudad o Sector.
        
        2. VALIDACIÓN DINÁMICA:
           - Si el cliente ya proporcionó información que razonablemente identifica su ubicación (aunque sea solo el nombre de un barrio o ciudad), NO vuelvas a preguntar por ello.

        - PASO A: Si el historial está vacío de datos, pedir los datos del cliente, DEBES usar EXACTAMENTE el siguiente bloque de texto, sin añadir ni quitar una sola palabra. Es una orden técnica:
          "Listo, ayúdeme con los siguientes datos por favor:
          *Nombre y Apellido:*
          *Ciudad:*
          *Dirección exacta:* (Especifique 2 calles y una referencia clara)."

        - PASO B (Recolección Flexible): Si envía datos por partes, chatea natural: "Anotado 📝. ¿De qué ciudad nos escribe?"
        - PASO C (CIERRE DE VENTA): Si ya tienes Nombre, Ciudad y Dirección, lanza: "¡Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar) por su seguridad. Las entregas son de 9am a 5pm, si tiene inconveninetes en ese horario le podemos ofrecer tambien entrega en una oficina servientrega cercana asi lo retira coordinando su tiempo y ocupaciones🛡️."
        - REGLA DE FORMATO: No aceptes direcciones genéricas como "Mi casa" o "El centro". Exige siempre las calles.
        - REGLA ANTI-DESPEDIDA: No digas "gracias por su compra" ni te despidas hasta haber enviado el mensaje de "Datos registrados con éxito".
        `;

    } else if (etapaActual === "POSTVENTA") {
        instruccionesEtapa = `
        OBJETIVO: Despedida.
        - Respuesta ÚNICA: "¡De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊".
        `;
    }

// --- REGLAS DE PERSUASIÓN Y MANEJO DE OBJECIONES ---
    const reglasPersuasion = `
    FILOSOFÍA DE VENTA:
    - No eres una vendedora, eres una asesora que cuida de la salud de las personas. 
    - Si el cliente duda o dice "no gracias", "está caro" o "luego le aviso", NO te despidas de inmediato. 
    - Eres una asesora de salud y bienestar de alto nivel.
    - Si el cliente tiene dudas reales, usa la EMPATÍA y el COSTO DE OPORTUNIDAD.
       
    MANEJO DE OBJECIONES (Sutil):
    1. Si el cliente se queja del precio: Enfócate en el beneficio diario versus el costo a largo plazo de no tratar su problema de salud. (No uses frases de centavos o caramelos, adáptalo al producto actual).
    2. Si dice "Lo voy a pensar": Dale un consejo de salud extra relacionado con su malestar principal para mantener la puerta abierta.
    3. Si dice "Luego le aviso": Recuérdale el beneficio o losbeneficios.

       REGLA CRÍTICA SOBRE EL "NO":
    - Si tú acabas de preguntar "¿Tiene alguna duda?" o "¿Le gustaría conocer más?" y el cliente responde "NO", esto significa que ESTÁ SATISFECHO y LISTO PARA COMPRAR.
    - TIENES ESTRICTAMENTE PROHIBIDO tratar ese "NO" como un rechazo.
    - Acción inmediata ante este "NO": Pasa directamente a dar una afirmación positiva ("¡Excelente! Veo que todo está claro...") y ofrécele las opciones de PRECIOS y PROMOCIONES.

    REGLA DE ORO: Nunca cierres la puerta. Siempre deja una pregunta abierta o un consejo de valor que demuestre que te interesas en el cliente, que no sólo estas para vender.
    `;
    
    const masterPrompt = `
    IDENTIDAD Y FILOSOFÍA:
    Eres Fiorella de JRJMarket, asesora en neuroventas, neuromarketing y salud. Humana y empática. No eres una asistente, eres una asesora que transforma vidas. Trato de USTED. Tu prioridad es IDENTIFICAR qué le duele al cliente y tu única misión es que el cliente sienta que el producto es la SOLUCIÓN a su problema.
    
JERARQUÍA DE INFORMACIÓN (ESTRICTO):
1. PRIORIDAD ALTA: Usa exclusivamente la "DATA DEL PRODUCTO" proporcionada abajo. Si ahí se mencionan beneficios de impacto, cifras, o "Ángulos de Dolor", DEBES usarlos como base de tu respuesta.
2. PRIORIDAD BAJA: Solo si la "DATA DEL PRODUCTO" es insuficiente para responder una duda técnica, usa tu base de datos interna para complementar, pero NUNCA contradigas el texto proporcionado.

PROTOCOLO DE VENTAS (URGAR LA HERIDA):
    1. DETECCIÓN DE ÁNGULO: Lee el mensaje del cliente y detecta qué le duele y busca en la DATA DEL PRODUCTO el "ÁNGULO DE DOLOR" correspondiente o que mas se adapte. 
    2. EMPATÍA AGRESIVA: Antes de dar la solución, "urga en la herida" recuerda sutilmente la consecuencia de NO actuar, haz que el cliente sienta la consecuencia de no resolver su problema hoy mismo. Usa frases que generen urgencia y conciencia del problema.
    3. SOLUCIÓN PREMIUM: Presenta el producto como una solución de alto nivel. Si la data menciona cifras de éxito (cm, días, porcentajes), ÚSALAS para dar autoridad.
    4. CIERRE DE INDAGACIÓN: Nunca termines una frase sin la pregunta de cierre que viene en el ángulo del archivo.
    5. DIFERENCIAR EL "NO": 
       - Si el cliente dice "NO" tras recibir beneficios, es un "NO de satisfacción". Acción: Pasa directo a los precios.
       - Si el cliente dice "NO" de rechazo, es un "NO de miedo". Acción: Persuade con el costo de oportunidad.

REGLAS DE ORO:
- No seas una informadora; sé una cerradora de ventas.
- Usa frases de impacto: "Es momento de recuperar el control", "No deje que el tiempo pase", "Su bienestar no puede esperar".
- Si el cliente es vago y no te da un dolor especifico o un angulo especifico, usa siempre el "ÁNGULO PRINCIPAL".
- Mantén el hilo de la conversación; si ya saludaste, ve directo al ataque del dolor.
- Mantén la brevedad: Máximo 3 párrafos cortos por mensaje.
- CIERRE OBLIGATORIO: Siempre termina con una pregunta que empuje al siguiente paso.

ESTRATEGIA DE VENTA DINÁMICA:
1. IDENTIFICACIÓN DE INTENCIÓN: Analiza el mensaje del cliente y busca en la DATA DEL PRODUCTO qué "ÁNGULO DE DOLOR" coincide con su necesidad actual.
2. ATAQUE PRIORITARIO: 
   - Si el cliente menciona un problema específico: Responde usando ÚNICAMENTE el ángulo que resuelve ese problema.
   - Si el cliente es vago (ej: "info", "precio", "me interesa"): Ataca con el "ÁNGULO PRINCIPAL" definido en el archivo.
3. PROHIBIDO: No seas una enciclopedia. No listes ingredientes de forma robótica. No uses frases pasivas como "es un buen suplemento" o "ayuda a la dieta". Usa frases de IMPACTO que conecten el producto con el resultado deseado.

REGLAS DE ORO DE CONVERSACIÓN:
- CONTINUIDAD: No repitas saludos si ya hay un hilo. Ve directo al grano del dolor.
- BREVEDAD: Máximo 2 mensajes cortos. 
- CIERRE DE INDAGACIÓN: Cada respuesta DEBE terminar con la PREGUNTA DE CIERRE que corresponde al ángulo utilizado. Si no hay una específica, lanza una pregunta abierta para conocer más el caso del cliente.

ESTRUCTURA DE RESPUESTA:
[Empatía con el Dolor detectado] + [Solución basada en el beneficio clave del Ángulo] + [Pregunta de Cierre de ese Ángulo].

    ${reglasPersuasion}
    
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

           // --- NOTIFICACIÓN ADMIN (RESUMEN DE VENTA) ---
            const esVentaExitosa = textoFinal.includes("registrados con éxito");

            if (esVentaExitosa) {
                // Extraemos el producto del historial o variable
                const productoVendido = nombreProducto || "Producto no especificado";
                
                // Creamos el resumen para el administrador
                const resumenVenta = `📦 *NUEVA VENTA FINALIZADA*
--------------------------------
👤 *Cliente:* ${clienteMsg.split('\n')[0] || 'Ver historial'}
📦 *Producto:* ${productoVendido}
📍 *Detalles de Envío:* ${clienteMsg}
--------------------------------
📱 *WhatsApp:* https://wa.me/${remoteJid.split('@')[0]}
--------------------------------
_Fiorella ha cerrado esta venta automáticamente._`;

                // Enviamos al número del administrador
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ 
                        number: NUMERO_ADMIN, 
                        text: resumenVenta 
                    })
                });
                
                console.log(`[LOG] Notificación enviada al Admin para el JID: ${remoteJid}`);
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

            // SEPARAMOS LA PREGUNTA PARA QUE QUEDE AL FINAL
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            // 1. ENVIAMOS LOS PÁRRAFOS DE TEXTO
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                if (partes.length > 1) await new Promise(r => setTimeout(r, 1200));
            }

            // 2. LÓGICA DE LAS 3 FOTOS SEGÚN LA ETAPA (Variables ya existentes)
            let fotoAEnviar = "";
            
            if (nombreProducto !== "") {
                if (etapaActual === "FRIO" && imgProducto) {
                    fotoAEnviar = imgProducto;
                } else if (etapaActual === "TIBIO" && imgBeneficios) {
                    fotoAEnviar = imgBeneficios;
                } else if (etapaActual === "CALIENTE" && imgTestimonios) {
                    fotoAEnviar = imgTestimonios;
                }
            }

            // 3. ENVIAMOS LA FOTO QUE CORRESPONDA A LA ETAPA
            if (fotoAEnviar !== "") {
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({
                        number: remoteJid,
                        media: fotoAEnviar,
                        mediatype: "image",
                        caption: "" 
                    })
                });
                await new Promise(r => setTimeout(r, 1500));
            }

            // 4. ENVIAMOS LA PREGUNTA DE CIERRE AL FINAL
            if (preguntaCierre) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: preguntaCierre })
                });
            }
        } 
    } catch (error) { 
        console.error("Error flujo general:", error.message); 
    }
    return res.status(200).send('OK');
};
