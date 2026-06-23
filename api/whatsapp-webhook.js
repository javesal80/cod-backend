const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

  if (req.method !== 'POST') return res.status(200).send('OK');

    const {
        EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME,
        OPENAI_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN, GEMINI_API_KEY
    } = process.env;

    const NUMERO_ADMIN = "593992668002";

   if (!req.body?.data?.message) return res.status(200).send('OK');

    // ─── COMANDOS ADMIN ───────────────────────────────────────────────
    if (req.body.data.key?.fromMe) {
        const msgAdmin = (req.body.data.message?.conversation || "").trim().toLowerCase();
        const cleanJidAdmin = req.body.data.key?.remoteJid?.replace(/[^a-zA-Z0-9]/g, '_');
        if (msgAdmin === '#pausa') {
            await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["SETEX", `pausa:${cleanJidAdmin}`, 86400, "1"])
            });
        }
        if (msgAdmin === '#activar') {
            await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["DEL", `pausa:${cleanJidAdmin}`])
            });
        }
        return res.status(200).send('OK');
    }

    const data       = req.body.data;
    const remoteJid  = data.key?.remoteJid;
    const msgId      = data.key?.id;
    const baseUrl    = EVOLUTION_URL?.replace(/\/$/, "");
    const instName   = req.body.instance || INSTANCE_NAME || "VitaeLAB";

    let clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();

    // ─── TRANSCRIPCIÓN DE AUDIO (Mantenida intacta con Whisper si se recibe voz) ───
    if (!clienteMsg && data.message?.audioMessage && OPENAI_API_KEY) {
        try {
            const mediaResp = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                body: JSON.stringify({ message: { key: data.key, message: data.message }, convertToMp4: false })
            });
            const mediaJson  = await mediaResp.json();
            const base64Audio = mediaJson.base64;
            if (base64Audio) {
                const buffer   = Buffer.from(base64Audio, 'base64');
                const formData = new FormData();
                formData.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'audio.ogg');
                formData.append('model', 'whisper-1');
                formData.append('language', 'es');
                const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}` },
                    body: formData
                });
                clienteMsg = (await whisperResp.json()).text || "";
                console.log("[WHISPER]", clienteMsg);
            }
        } catch (e) { console.error("[WHISPER ERROR]", e.message); }
    }

    // ─── FECHA Y LOGÍSTICA ECUADOR ────────────────────────────────────
    const utc  = new Date().getTime() + (new Date().getTimezoneOffset() * 60000);
    const hoy  = new Date(utc + (3600000 * -5));
    const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
    let d1 = new Date(hoy); d1.setDate(hoy.getDate() + 1);
    if (d1.getDay() === 0) d1.setDate(d1.getDate() + 1);
    if (d1.getDay() === 6) d1.setDate(d1.getDate() + 2);
    let d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
    if (d2.getDay() === 0) d2.setDate(d2.getDate() + 1);
    if (d2.getDay() === 6) d2.setDate(d2.getDate() + 2);
    const mañana = dias[d1.getDay()];
    const pasado  = dias[d2.getDay()];

    // ─── REDIS HELPERS ────────────────────────────────────────────────
    const redisGet = async (key) => {
        const r = await fetch(`${KV_REST_API_URL}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["GET", key])
        });
        return (await r.json()).result || null;
    };
    const redisSetex = async (key, seconds, value) => {
        await fetch(`${KV_REST_API_URL}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["SETEX", key, seconds, value])
        });
    };

    // ─── ANTI-DUPLICADOS RESTRUCTURADO ────────────────────────────────
    try {
        if (await redisGet(`dd:${msgId}`)) return res.status(200).send('OK');
        await redisSetex(`dd:${msgId}`, 60, "1");
    } catch (e) { console.error("Dedup error:", e.message); }

    const tsActual = Date.now().toString();
    const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

    // ─── LOCK ATÓMICO ANTI-PARALELO (CONTROL DE FLUJO) ────────────────
    const tieneReferral = !!(data?.contextInfo?.externalAdReply || data?.message?.referral);
    if (!tieneReferral) await new Promise(r => setTimeout(r, 600));

    const lockKey = `lock:${cleanJid}`;
    try {
        const lockResult = await fetch(`${KV_REST_API_URL}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["SET", lockKey, "1", "NX", "EX", "25"])
        });
        const lockJson = await lockResult.json();
        if (lockJson.result !== "OK") {
            console.log("[LOCK] Webhook paralelo cancelado:", cleanJid);
            return res.status(200).send('OK');
        }
    } catch(e) { console.error("[LOCK ERROR]", e.message); }

    await redisSetex(`lastmsg:${cleanJid}`, 300, tsActual).catch(() => {});
    
    // ─── CONTROL DE PAUSA ACTIVA ──────────────────────────────────────
    await new Promise(r => setTimeout(r, 500));
    try { if (await redisGet(`pausa:${cleanJid}`)) {
        await fetch(`${KV_REST_API_URL}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(["DEL", lockKey]) }).catch(() => {});
        return res.status(200).send('OK');
    }} catch (e) {}

    // ─── RECUPERACIÓN DE ESTADO DESDE REDIS ───────────────────────────
    const memoriaKey  = `chat:${cleanJid}`;
    const stageKey    = `stage:${cleanJid}`;
    const productoKey = `prod:${cleanJid}`;
    const fotosKey    = `fotos:${cleanJid}`;

    let historial      = [];
    let etapaActual    = "BIENVENIDA";
    let productoActivo = null;
    let fotosEnviadas  = {};

    try {
        const [g, e, p, f] = await Promise.all([
            redisGet(memoriaKey), redisGet(stageKey),
            redisGet(productoKey), redisGet(fotosKey)
        ]);
        if (g) { try { historial      = JSON.parse(decodeURIComponent(g)); } catch { historial      = JSON.parse(g); } }
        if (e) etapaActual = e;
        if (p) { try { productoActivo = JSON.parse(decodeURIComponent(p)); } catch { productoActivo = JSON.parse(p); } }
        if (f) { try { fotosEnviadas  = JSON.parse(decodeURIComponent(f)); } catch { fotosEnviadas  = JSON.parse(f); } }
    } catch (e) { console.error("Error leyendo Redis:", e.message); }

    // ─── LEER CATÁLOGO DE PRODUCTOS DISPONIBLES ───────────────────────
    let catalogo = [], resumenCatalogo = "";
    try {
        const pp = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(pp)) {
            catalogo = JSON.parse(fs.readFileSync(pp, 'utf8')).PRODUCTOS || [];
            resumenCatalogo = catalogo.map(p =>
                `- ${p.nombre}: ${p.descripcion_corta || ''} | keywords: [${(p.keywords || []).join(', ')}]`
            ).join('\n');
        }
    } catch (e) { console.error("Error catálogo:", e.message); }

    // ─── DETECCIÓN DE ENTRADA (ADS ID & KEYWORDS) ────────────────────
    const msgLower = clienteMsg.toLowerCase().trim();
    const productoDetectadoPorKeyword = catalogo.find(p =>
        p.keywords?.some(k => msgLower.includes(k.toLowerCase()))
    );

    const referral = data?.contextInfo?.externalAdReply 
        || data?.contextInfo 
        || data?.message?.referral 
        || null;

    const adIdCapturado = referral ? (referral.sourceId || referral.adId || "").toString().trim() : "";

    if (!productoActivo) {
        if (adIdCapturado) {
            const productoDesdeRef = catalogo.find(p =>
                p.ad_ids && p.ad_ids.some(id => id.toString().trim() === adIdCapturado)
            );
            if (productoDesdeRef) {
                productoActivo = productoDesdeRef;
                await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
                if (!fotosEnviadas) fotosEnviadas = {};
            }
        }
        if (!productoActivo && productoDetectadoPorKeyword) {
            productoActivo = productoDetectadoPorKeyword;
            await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
            if (!fotosEnviadas) fotosEnviadas = {};
        }
    } 

    const altaIntencion = /quiero (realizar |hacer )?(una )?compra|quiero (pedir|comprarlo|uno|pedirlo)|me lo llevo|d[oó]nde pago|c[oó]mo pago|quiero (el |los )?(\d+ )?(tarros?|unidades?|paquetes?)/i.test(clienteMsg);

    // ─── EXTRACTORES DE DATOS EN TXT DE PRODUCTOS ─────────────────────
    let infoProducto = "", imgProducto = "", imgBeneficios = "", imgTestimonios = "";
    if (productoActivo) {
        try {
            const tp = path.join(process.cwd(), 'api', productoActivo.archivo);
            if (fs.existsSync(tp)) infoProducto = fs.readFileSync(tp, 'utf-8');
            imgProducto    = productoActivo.img_producto    || "";
            imgBeneficios  = productoActivo.img_beneficios  || "";
            imgTestimonios = productoActivo.img_testimonios || "";
        } catch (e) { console.error("Error TXT:", e.message); }
    }

    let infoGeneral = "";
    try {
        const gp = path.join(process.cwd(), 'api', 'info-general.txt');
        if (fs.existsSync(gp)) infoGeneral = fs.readFileSync(gp, 'utf-8');
    } catch (e) {}

    historial.push({ role: "user", content: clienteMsg });
    if (historial.length > 40) historial = historial.slice(-40);

    // ─── 🧠 MASTER PROMPT: OPCIÓN B + MÁXIMA EMPATÍA NEURO-CONVERSACIONAL ───
    const masterPrompt = `
Eres Fiorella, asesora experta en salud y bienestar de JRJMarket. No actúes como un bot que solo escupe textos automáticos o que corre desesperada a empujar una venta. Tu superpoder es la empatía real, la escucha activa y la capacidad de analizar minuciosamente el historial de la conversación antes de dar una respuesta. Comprendes perfectamente la neuropsicología del consumidor: el cerebro huye y se defiende (genera cortisol) si detecta presión de compra, pero se abre y confía (genera dopamina y oxitocina) cuando se siente escuchado, comprendido y respaldado por una autoridad médica humana.

Tratas al cliente de USTED con absoluta cercanía, calidez y naturalidad, como una amiga experta. Quedan terminantemente prohibidas las exclamaciones robóticas falsas ("¡Excelente!", "¡Perfecto!", "¡Claro!").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 REVISIÓN DEL HILO Y ADAPTACIÓN PSICOLÓGICA (TRES PERFILES DE CLIENTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analiza minuciosamente el último mensaje del cliente y contrástalo con el historial para clasificar su nivel de consciencia actual:

1️⃣ CLIENTE DIRECTO (Alta Consciencia / Listo para actuar): Va al grano, pregunta precios de inmediato, dice cómo pagar o pide el producto.
   - Acción: No le des vueltas, no le metas pasos de calentamiento que no pidió. Responde su duda o despliega las opciones de precio de inmediato bajo el formato estricto de DECISIÓN.

2️⃣ CLIENTE EN EVALUACIÓN (Medio Consciencia / Busca seguridad): Te describe sus síntomas, pregunta ingredientes, si tiene contraindicaciones o cómo funciona.
   - Acción: Frena por completo cualquier intento de venta. Tu prioridad absoluta es validar su situación, explicarle con palabras supersimples (neurociencia: carga cognitiva baja) cómo el tratamiento actúa en su cuerpo para devolverle la salud y construir autoridad (Registro ARCSA o importado de EE.UU.). Pide permiso sutil antes de avanzar.

3️⃣ CLIENTE FRÍO (Bajo Consciencia / Curioso): Llega con un texto vago como "Más información" o "Vi el anuncio".
   - Acción: Conéctalo emocionalmente. Dale una bienvenida humana y personalizada, y lánzale la pregunta filtro inicial para descubrir cuál es la molestia específica que desea eliminar de su vida hoy.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORMACIÓN CORPORATIVA Y DE RESPALDO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${infoGeneral}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CATÁLOGO DE PRODUCTOS DISPONIBLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${resumenCatalogo || "No disponible."}

${infoProducto ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUCTO IDENTIFICADO Y ACTIVO: ${productoActivo?.nombre?.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Usa única y exclusivamente la información técnica de este archivo. Jamás inventes precios, promociones o componentes que no figuren aquí de forma explícita:

${infoProducto}` : `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRÁFICO ORGÁNICO / SIN PRODUCTO DETECTADO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
El cliente no viene de un anuncio específico. Pregúntale con total soltura qué afección o meta de bienestar busca solucionar para guiarle con el producto exacto de tu catálogo.`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MECÁNICA DE ETAPAS CONVERSACIONALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identifica la etapa y mantén la fluidez. Puedes retroceder de etapa si detectas que el cliente se asusta o presenta objeciones en lugar de forzar el cierre.

- ESCUCHA: Recepción, saludo dinámico integrado (sin muletillas) e indagación del malestar.
- SOLUCIÓN: Explicación persuasiva basada en alivio y transformación de vida diaria. Lanza el gancho: "¿Le gustaría que le detalle las promociones y opciones que tenemos hoy para iniciar su tratamiento? 📦"
- DECISIÓN (Precios): *REGLA DE ORO OBLIGATORIA:* Debes enumerar todas las opciones comerciales del archivo con este formato exacto:
  "📦 *Opción 1:* X unidad — $XX.XX
  📦 *Opción 2:* X unidades — $XX.XX
  📦 *Opción 3:* X unidades — $XX.XX"
  Justo después del listado, añade en un párrafo tu recomendación personalizada conectada a sus síntomas.
- CIERRE (Formulario): Confirmación de la promo elegida. Genera confianza explicando la logística de Pago Contra Entrega (cancela en efectivo al recibir) y pide los datos:
  "Para ayudarle a asegurar su producto y coordinar el despacho, ayúdeme por favor con los siguientes datos:\\n*Nombre y Apellido:*\\n*Provincia-Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
- CONFIRMADO: Texto exacto de protocolo de despacho: "¡Gracias! Su pedido ha sido registrado con éxito. 🎉\\n\\nSu entrega llegará entre ${mañana} o ${pasado}.\\n\\nLe agradecemos su confianza. En breve recibirá su producto."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 REGLAS INQUEBRANTABLES DE DISEÑO CONVERSACIONAL PARA WHATSAPP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. VARIACIÓN RADICAL: Nunca comiences dos mensajes consecutivos con las mismas palabras. Elimina muletillas automáticas de IA.
2. UNA SOLA PREGUNTA: Tus respuestas deben finalizar estrictamente con una única e interesante pregunta al final para mantener el control humano del chat. Quedan prohibidas las preguntas cruzadas o intermedias.
3. ESTÉTICA DE LECTURA RAPIDA: Párrafos cortos de máximo 2 líneas. Ideas separadas siempre por un salto de línea doble (\\n\\n). Usa entre 1 y 3 emojis estratégicos para dar calidez visual, jamás los amontones como viñetas.

Responde ÚNICAMENTE en el siguiente formato JSON puro y ejecutable:
{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta maquetada para WhatsApp aquí"}
`;

    // ─── 🧠 ARQUITECTURA DE CONEXIÓN NATIVA CON API DE GEMINI ──────────────────
    let textoFinal = "", nuevaEtapa = etapaActual;

    try {
        // Mapeo adaptado del historial al formato nativo estructurado de Gemini (contents)
        const geminiContents = historial.map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
        }));

        const requestBody = {
            contents: geminiContents,
            systemInstruction: {
                parts: [{ text: masterPrompt + `\n\nCRÍTICO: Responde exclusivamente con JSON estructurado: {"etapa":"ETAPA","mensaje":"texto"}. No agregues bloques markdown \`\`\`json ni decoradores extras. Analiza el contexto previo antes de responder.` }]
            },
            generationConfig: {
                temperature: 0.35, // Consistencia en el comportamiento y fidelidad de los datos del TXT
                maxOutputTokens: 1000,
                responseMimeType: "application/json" // Fuerza el output como objeto JSON real de API
            }
        };

        console.log("[GEMINI] Solicitando respuesta nativa estructurada para:", cleanJid);
        
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY.trim()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const resJson = await r.json();
        let respuestaRaw = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // ─── PARSEADOR E HIGIENIZACIÓN DE JSON CONTRA ERRORES DE LLAVES ─────────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const matchObjeto = clean.match(/\{[\s\S]*\}/);
            if (matchObjeto) clean = matchObjeto[0];
            parsed = JSON.parse(clean);
        } catch (e) {
            console.log("[FALLBACK REGEX] Error de parseo, extrayendo mensaje...");
            const matchMensaje = respuestaRaw.match(/"mensaje"\s*:\s*"([\s\S]*?)"\s*}/);
            if (matchMensaje) {
                textoFinal = matchMensaje[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
            } else {
                textoFinal = respuestaRaw.trim();
            }
            nuevaEtapa = etapaActual;
        }

        if (parsed) {
            nuevaEtapa = parsed.etapa || etapaActual;
            textoFinal = (parsed.mensaje || "")
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*') // Re-formateo dinámico de negritas nativas de IA a formato WhatsApp
                .trim();

            // ─── FORMATEADOR ESTÉTICO AVANZADO PARA LA ETAPA DE PRECIOS ─────────────────
            if (nuevaEtapa === 'DECISIÓN') {
                const marcadorCierre = '✨';
                const idxMarcador = textoFinal.indexOf(marcadorCierre);
                if (idxMarcador !== -1) {
                    let bloquePrecios = textoFinal.substring(0, idxMarcador).replace(/\n\n/g, '\n').trim();
                    bloquePrecios = bloquePrecios.replace(/((?:A continuaci[oó]n|Claro)[^\n]+)\n(📦)/gi, '$1\n\n$2');
                    bloquePrecios = bloquePrecios.replace(/([^\n]+)\n((?:A continuaci[oó]n|Claro)[^\n]+)/gi, '$1\n\n$2');
                    bloquePrecios = bloquePrecios.replace(/\n?(📦)/g, '\n \n$1');
                    bloquePrecios = bloquePrecios.replace(/(✅[^\n]*)\n?(Le (?:sugiero|recomiendo|indico|aconsejo))/g, '$1\n\n$2');

                    const bloquePregunta = textoFinal.substring(idxMarcador)
                        .replace(/\n\n/g, '\n')
                        .replace(/([\?])\s+(Su primera|Recuerde)/g, '$1\n \n$2');

                    textoFinal = bloquePrecios.trim() + '\n\n' + bloquePregunta;
                }
            }
        }

        // ─── PERSISTENCIA DEL HILO DE LA CONVERSACIÓN (CORAZÓN DEL JS) ─────────────────
        historial.push({ role: "assistant", content: textoFinal });
        await Promise.all([
            redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
            redisSetex(stageKey,   86400 * 7, nuevaEtapa)
        ]);

        // ─── RESPALDO DE SEGURIDAD EN SUPABASE (INTACTO) ───────────────────────────────────
        try {
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversaciones`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': process.env.SUPABASE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify({
                    jid: cleanJid, etapa_final: nuevaEtapa,
                    producto: productoActivo?.nombre || null,
                    vendido: nuevaEtapa === 'CONFIRMADO',
                    historial, updated_at: new Date().toISOString()
                })
            });
        } catch (e) { console.error("[SUPABASE ERROR]", e.message); }

        // ─── REPORTE AUTOMÁTICO DE VENTAS AL ADMIN ───────────────────────────────────
        if (nuevaEtapa === "CONFIRMADO" && etapaActual !== "CONFIRMADO") {
            const resumenVenta = `📦 *NUEVA VENTA FINALIZADA*\n--------------------------------\n📦 *Producto:* ${productoActivo?.nombre || "Catálogo General"}\n📱 *WhatsApp:* https://wa.me/${remoteJid.split('@')[0]}\n\n📋 *DATOS CAPTURADOS:*\n${historial[historial.length - 2]?.content || "Ver chat"}\n--------------------------------\n_Fiorella cerró esta venta automáticamente con Gemini._`;

            await fetch(`${baseUrl}/message/sendText/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                body: JSON.stringify({ number: NUMERO_ADMIN, text: resumenVenta })
            }).catch(e => console.log("Error enviando reporte:", e.message));
        }
      
        // ─── COLA DINÁMICA DE MENSAJES (SIMULACIÓN HUMANA ANTI-INTERRUPCIÓN) ───────────
        if (textoFinal) {
            const textoUnico = `${nuevaEtapa}_${textoFinal}`;
            const textoHash = Buffer.from(textoUnico).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 24);
            const hashKey   = `msghash:${cleanJid}:${textoHash}`;
            
            if (await redisGet(hashKey)) {
                console.log("[ANTI-DUP] Mensaje repetido mitigado.");
                await fetch(`${KV_REST_API_URL}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(["DEL", lockKey]) }).catch(() => {});
                return res.status(200).send('OK');
            }
            await redisSetex(hashKey, 180, "1");
            const tsEnvio = tsActual;
          
            let partes = textoFinal.split('\n\n').map(l => l.trim()).filter(l => l !== "");
            if (partes.length > 8) { const u = partes.pop(); partes = partes.slice(0, 7); partes.push(u); }
            if (partes.length > 1 && partes[0].length < 30) { partes[1] = partes[0] + " " + partes[1]; partes.shift(); }
            
            if (partes.length > 1 && partes[partes.length - 1].length < 10) {
                const ultimoElemento = partes.pop();
                partes[partes.length - 1] = partes[partes.length - 1] + " " + ultimoElemento;
            }
            
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            const enviar = async (texto) => {
                const tsReciente = await redisGet(`lastmsg:${cleanJid}`).catch(() => null);
                if (tsReciente && tsReciente !== tsEnvio) {
                    console.log("[ABORT] El cliente interrumpió el tipeo. Abortando cola.");
                    return false;
                }
                const delay = Math.min(texto.length * 32, 4500); 
                try {
                    await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, presence: "composing", delay })
                    });
                } catch(te) {}
                
                await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 600)));
                try {
                    await fetch(`${baseUrl}/message/sendText/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, text: texto })
                    });
                } catch(se) {}
            };

            for (const parte of partes) {
                const ok = await enviar(parte);
                if (ok === false) break;
            }

            // ─── CONTROL LOGÍSTICO DE CONTENIDO MULTIMEDIA (FOTOS DEL TXT) ───────────────
            const mapaFotos = {
                "BIENVENIDA": imgProducto, "ESCUCHA": imgProducto,
                "SOLUCIÓN":   imgBeneficios, "DECISIÓN": imgTestimonios
            };
            const fotoEtapa     = mapaFotos[nuevaEtapa] || "";
            const fotoYaEnviada = fotosEnviadas[nuevaEtapa] === true;
            const etapaCambio   = nuevaEtapa !== etapaActual;
            const esNuevoProducto = !fotosEnviadas["ESCUCHA"];
            
            const debeEnviarFoto = fotoEtapa && !fotoYaEnviada && (
                (nuevaEtapa === "DECISIÓN") ||
                (nuevaEtapa !== "DECISIÓN" && (etapaCambio || (nuevaEtapa === "ESCUCHA" && esNuevoProducto)))
            );

            if (debeEnviarFoto) {
                await new Promise(r => setTimeout(r, 1800 + Math.floor(Math.random() * 1000)));
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, media: fotoEtapa, mediatype: "image", caption: "" })
                });
                const esInicial = ["BIENVENIDA","ESCUCHA"].includes(nuevaEtapa);
                if (esInicial && productoActivo?.img_tabla) {
                    await new Promise(r => setTimeout(r, 1500));
                    await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, media: productoActivo.img_tabla, mediatype: "image", caption: "" })
                    });
                }
                fotosEnviadas[nuevaEtapa] = true;
                await redisSetex(fotosKey, 86400 * 7, JSON.stringify(fotosEnviadas));
            }

            if (preguntaCierre) {
                await enviar(preguntaCierre);
            }
        }

    } catch (error) { console.error("Error crítico en el flujo principal:", error.message); }

    // Liberación segura del lock atómico de Redis
    await fetch(`${KV_REST_API_URL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(["DEL", lockKey])
    }).catch(() => {});
    
    return res.status(200).send('OK');
};
