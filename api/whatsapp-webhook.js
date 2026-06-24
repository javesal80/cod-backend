const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    console.log("[WEBHOOK] Petición recibida. Método:", req.method);

    if (req.method !== 'POST') {
        console.log("[WEBHOOK] Método no permitido, enviando OK.");
        return res.status(200).send('OK');
    }

    const {
        EVOLUTION_URL, EVOLUTION_TOKEN_WHATSAPI, INSTANCE_WHATSAPI,
        OPENAI_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN, GEMINI_API_KEY
    } = process.env;

    const NUMERO_ADMIN = "593992668002";

    if (!req.body?.data?.message) {
        console.log("[WEBHOOK] Estructura de mensaje inválida u omitida.");
        return res.status(200).send('OK');
    }

    // ─── COMANDOS ADMIN ───────────────────────────────────────────────
    if (req.body.data.key?.fromMe) {
        const msgAdmin = (req.body.data.message?.conversation || "").trim().toLowerCase();
        const cleanJidAdmin = req.body.data.key?.remoteJid?.replace(/[^a-zA-Z0-9]/g, '_');
        console.log("[ADMIN] Mensaje propio detectado:", msgAdmin);
        
        if (msgAdmin === '#pausa') {
            console.log("[ADMIN] Ejecutando #pausa para:", cleanJidAdmin);
            await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["SETEX", `pausa:${cleanJidAdmin}`, 86400, "1"])
            }).catch((e) => console.error("[ADMIN ERROR] Al pausar:", e.message));
        }
        if (msgAdmin === '#activar') {
            console.log("[ADMIN] Ejecutando #activar para:", cleanJidAdmin);
            await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["DEL", `pausa:${cleanJidAdmin}`])
            }).catch((e) => console.error("[ADMIN ERROR] Al activar:", e.message));
        }
        return res.status(200).send('OK');
    }

    const data       = req.body.data;
    const remoteJid  = data.key?.remoteJid;
    const msgId      = data.key?.id;
    const baseUrl    = EVOLUTION_URL?.replace(/\/$/, "");
    const instName   = req.body.instance || INSTANCE_WHATSAPI || "VitaeLAB";

    let clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const cleanJid = remoteJid?.replace(/[^a-zA-Z0-9]/g, '_');

    console.log(`[INFO] MsgId: ${msgId} | Jid: ${remoteJid} | Mensaje: "${clienteMsg}"`);

    // ─── TRANSCRIPCIÓN DE AUDIO (Whisper API) ─────────────────────────
    if (!clienteMsg && data.message?.audioMessage && OPENAI_API_KEY) {
        console.log("[AUDIO] Detectado mensaje de voz. Intentando transcripción...");
        try {
            const mediaResp = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
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
                console.log("[AUDIO] Transcripción exitosa:", clienteMsg);
            }
        } catch (e) { console.error("[AUDIO ERROR]", e.message); }
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

    // ─── REDIS HELPERS SEGUROS ────────────────────────────────────────
    const redisGet = async (key) => {
        console.log(`[REDIS] Consultando llave: ${key}`);
        try {
            const r = await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["GET", key])
            });
            const d = await r.json();
            return d.result || null;
        } catch (e) { 
            console.error(`[REDIS ERROR] Fallo al leer ${key}:`, e.message);
            return null; 
        }
    };

    const redisSetex = async (key, seconds, value) => {
        console.log(`[REDIS] Guardando llave: ${key} por ${seconds}s`);
        try {
            await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["SETEX", key, seconds, value])
            });
        } catch (e) {
            console.error(`[REDIS ERROR] Fallo al guardar ${key}:`, e.message);
        }
    };

    // ─── ANTI-DUPLICADOS SIMPLIFICADO EFECTIVO ────────────────────────
    try {
        const dup = await redisGet(`dd:${msgId}`);
        if (dup) {
            console.log("[DEDUP] Mensaje repetido detectado e ignorado:", msgId);
            return res.status(200).send('OK');
        }
        await redisSetex(`dd:${msgId}`, 45, "1");
    } catch (e) {}

    const tsActual = Date.now().toString();
    await redisSetex(`lastmsg:${cleanJid}`, 300, tsActual).catch(() => {});
    
    // ─── CONTROL DE PAUSA ACTIVA ──────────────────────────────────────
    try { 
        const isPaused = await redisGet(`pausa:${cleanJid}`);
        if (isPaused) {
            console.log("[PAUSA] El bot está pausado para este chat. Abortando flujo.");
            return res.status(200).send('OK');
        }
    } catch (e) {}

    // ─── RECUPERACIÓN DE ESTADO DESDE REDIS ───────────────────────────
    const memoriaKey  = `chat:${cleanJid}`;
    const stageKey    = `stage:${cleanJid}`;
    const productoKey = `prod:${cleanJid}`;
    const fotosKey    = `fotos:${cleanJid}`;

    let historial      = [];
    let etapaActual    = "BIENVENIDA";
    let productoActivo = null;
    let fotosEnviadas  = {};

    console.log("[REDIS] Cargando estados conversacionales...");
    try {
        const [g, e, p, f] = await Promise.all([
            redisGet(memoriaKey), redisGet(stageKey),
            redisGet(productoKey), redisGet(fotosKey)
        ]);
        if (g) { try { historial      = JSON.parse(decodeURIComponent(g)); } catch { historial      = JSON.parse(g); } }
        if (e) etapaActual = e;
        if (p) { try { productoActivo = JSON.parse(decodeURIComponent(p)); } catch { productoActivo = JSON.parse(p); } }
        if (f) { try { fotosEnviadas  = JSON.parse(decodeURIComponent(f)); } catch { fotosEnviadas  = JSON.parse(f); } }
        console.log(`[REDIS] Carga lista. Etapa actual: ${etapaActual} | Prod Activo: ${productoActivo?.nombre || "Ninguno"}`);
    } catch (e) { console.error("[REDIS ERROR] Error en Promise.all de carga:", e.message); }

    // ─── LEER CATÁLOGO DE PRODUCTOS DISPONIBLES ───────────────────────
    let catalogo = [], resumenCatalogo = "";
    console.log("[SISTEMA] Leyendo archivo productos.json...");
    try {
        const pp = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(pp)) {
            catalogo = JSON.parse(fs.readFileSync(pp, 'utf8')).PRODUCTOS || [];
            resumenCatalogo = catalogo.map(p =>
                `- ${p.nombre}: ${p.descripcion_corta || ''} | keywords: [${(p.keywords || []).join(', ')}]`
            ).join('\n');
            console.log("[SISTEMA] Catálogo estructurado leído con éxito.");
        } else {
            console.log("[SISTEMA ALERTA] No se encontró productos.json en la ruta esperada.");
        }
    } catch (e) { console.error("[SISTEMA ERROR] Al leer catálogo:", e.message); }

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
    console.log("[SISTEMA] AdID Detectado en Payload:", adIdCapturado || "Ninguno");

    if (!productoActivo) {
        if (adIdCapturado) {
            const productoDesdeRef = catalogo.find(p =>
                p.ad_ids && p.ad_ids.some(id => id.toString().trim() === adIdCapturado)
            );
            if (productoDesdeRef) {
                productoActivo = productoDesdeRef;
                console.log("[SISTEMA] Producto asignado por AdID:", productoActivo.nombre);
                await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
                if (!fotosEnviadas) fotosEnviadas = {};
            }
        }
        if (!productoActivo && productoDetectadoPorKeyword) {
            productoActivo = productoDetectadoPorKeyword;
            console.log("[SISTEMA] Producto asignado por Keyword:", productoActivo.nombre);
            await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
            if (!fotosEnviadas) fotosEnviadas = {};
        }
    } 

    // ─── EXTRACTORES DE DATOS EN TXT DE PRODUCTOS ─────────────────────
    let infoProducto = "", imgProducto = "", imgBeneficios = "", imgTestimonios = "";
    if (productoActivo) {
        console.log(`[SISTEMA] Cargando base de conocimiento para: ${productoActivo.archivo}`);
        try {
            const tp = path.join(process.cwd(), 'api', productoActivo.archivo);
            if (fs.existsSync(tp)) infoProducto = fs.readFileSync(tp, 'utf-8');
            imgProducto    = productoActivo.img_producto    || "";
            imgBeneficios  = productoActivo.img_beneficios  || "";
            imgTestimonios = productoActivo.img_testimonios || "";
        } catch (e) { console.error("[SISTEMA ERROR] Fallo al leer TXT de producto:", e.message); }
    }

    let infoGeneral = "";
    try {
        const gp = path.join(process.cwd(), 'api', 'info-general.txt');
        if (fs.existsSync(gp)) infoGeneral = fs.readFileSync(gp, 'utf-8');
    } catch (e) {}

    historial.push({ role: "user", content: clienteMsg });
    if (historial.length > 40) historial = historial.slice(-40);

    // ─── 🧠 MASTER PROMPT ───
    const masterPrompt = `
Eres Fiorella, asesora experta en salud y bienestar de JRJMarket. Tratas al cliente de USTED, con una calidez genuina, profesional y cercana. Quedan prohibidas las muletillas e inicio de mensajes idénticos ("¡Perfecto!", "¡Claro!", "Entiendo...").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 REGLA DE ORO DE ESCUCHA ACTIVA (PROHIBIDO AVANZAR A CIEGAS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de generar cualquier respuesta, lee el último mensaje del cliente y compáralo con el historial. Debes validar de forma obligatoria lo que te acaba de decir:
- Si el cliente te cuenta un síntoma o un dolor: DETENTE. Valida su dolor con empatía humana real. Urga sutilmente en esa herida.
- Si el cliente cambia de tema o hace una pregunta técnica sobre ingredientes, responde con autoridad médica simple. ESTÁ PROHIBIDO pasar a la etapa de precios o pedir datos en estos escenarios.
- Solo si el cliente te da luz verde explícita o una señal clara de compra ("¿Cuánto cuesta?", "Quiero pedirlo"), avanzarás a la estructura de cotización o cierre.

INFORMACIÓN CORPORATIVA Y DE RESPALDO:
${infoGeneral}

CATÁLOGO DE PRODUCTOS DISPONIBLES:
${resumenCatalogo || "No disponible."}

${infoProducto ? `PRODUCTO IDENTIFICADO Y ACTIVO: ${productoActivo?.nombre?.toUpperCase()}\n${infoProducto}` : `TRÁFICO ORGÁNICO / SIN PRODUCTO DETECTADO.`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MECÁNICA DE ETAPAS CONVERSACIONALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ESCUCHA: Recepción, saludo dinámico e indagación del malestar.
- SOLUCIÓN: Explicación persuasiva basada en alivio. Lanza el gancho: "¿Le gustaría que le detalle las promociones y opciones que tenemos hoy para iniciar su tratamiento? 📦"
- DECISIÓN (Precios): *REGLA DE ORO OBLIGATORIA:* Enumera las opciones comerciales exactamente así:
  "📦 *Opción 1:* X unidad — $XX.XX
  📦 *Opción 2:* X unidades — $XX.XX
  📦 *Opción 3:* X unidades — $XX.XX"
  Justo después del listado, añade tu recomendación personalizada conectada a sus síntomas.
- CIERRE (Formulario): Explica la logística de Pago Contra Entrega y pide los datos:
  "Para ayudarle a asegurar su producto y coordinar el despacho, ayúdeme por favor con los siguientes datos:\\n*Nombre y Apellido:*\\n*Provincia-Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
- CONFIRMADO: "¡Gracias! Su pedido ha sido registrado con éxito. 🎉\\n\\nSu entrega llegará entre ${mañana} o ${pasado}.\\n\\nLe agradecemos su confianza."

🚨 REGLAS INQUEBRANTABLES DE DISEÑO PARA WHATSAPP:
1. Párrafos cortos de máximo 2 líneas. Ideas separadas por salto de línea doble (\\n\\n). Usa de 1 a 3 emojis sutiles por mensaje.
2. Todo mensaje debe terminar estrictamente con una única pregunta al final.

⚠️ FORMATO DE SALIDA COMPULSORIO OBLIGATORIO:
Tu respuesta debe seguir este formato exacto en texto plano, usando tres barras verticales como separador:
ETAPA_CORRESPONDIENTE|||Texto del mensaje listo para enviarse a WhatsApp

No uses marcas markdown de bloques, no uses objetos JSON, no envíes nada fuera de esta estructura plana.
`;

    // ─── 🧠 CONEXIÓN DIRECTA CON API DE GEMINI ──────────────────
    let textoFinal = "", nuevaEtapa = etapaActual;

    console.log("[GEMINI] Solicitando respuesta a la API...");
    try {
        const geminiContents = historial.map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
        }));

        const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY.trim()}`;

        const r = await fetch(urlGemini, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: geminiContents,
                systemInstruction: { parts: [{ text: masterPrompt }] },
                generationConfig: { temperature: 0.35, maxOutputTokens: 1000 }
            })
        });

        const resJson = await r.json();
        let respuestaRaw = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
        console.log("[GEMINI] Respuesta cruda recibida con éxito.");

        respuestaRaw = respuestaRaw.trim();
        if (respuestaRaw.startsWith("```")) {
            respuestaRaw = respuestaRaw.replace(/^```[a-zA-Z]*\n?/i, "").replace(/```$/, "").trim();
        }

        if (respuestaRaw.includes("|||")) {
            const partesRaw = respuestaRaw.split("|||");
            nuevaEtapa = partesRaw[0].trim();
            textoFinal = partesRaw[1].trim();
            console.log(`[GEMINI] Clasificado exitosamente. Etapa inferida: ${nuevaEtapa}`);
        } else {
            textoFinal = respuestaRaw;
            console.log("[GEMINI ALERTA] No se encontró el delimitador ||| en la respuesta.");
        }

        if (textoFinal) {
            textoFinal = textoFinal
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*');

            if (nuevaEtapa === 'DECISIÓN') {
                const marcadorCierre = '✨';
                const idxMarcador = textoFinal.indexOf(marcadorCierre);
                if (idxMarcador !== -1) {
                    let bloquePrecios = textoFinal.substring(0, idxMarcador).replace(/\n\n/g, '\n').trim();
                    bloquePrecios = bloquePrecios.replace(/((?:A continuaci[oó]n|Claro)[^\n]+)\n(📦)/gi, '$1\n\n$2');
                    bloquePrecios = bloquePrecios.replace(/\n?(📦)/g, '\n \n$1');
                    const bloquePregunta = textoFinal.substring(idxMarcador).replace(/\n\n/g, '\n');
                    textoFinal = bloquePrecios.trim() + '\n\n' + bloquePregunta;
                }
            }

            // Persistencia inmediata de estados
            historial.push({ role: "assistant", content: textoFinal });
            console.log("[SISTEMA] Guardando el nuevo historial en Redis...");
            await Promise.all([
                redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
                redisSetex(stageKey,   86400 * 7, nuevaEtapa)
            ]);

            // Envío secuencial simulando tipeo humano
            const tsEnvio = tsActual;
            let partes = textoFinal.split('\n\n').map(l => l.trim()).filter(l => l !== "");
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            const enviar = async (texto) => {
                const tsReciente = await redisGet(`lastmsg:${cleanJid}`);
                if (tsReciente && tsReciente !== tsEnvio) {
                    console.log("[SISTEMA] El usuario envió otro mensaje durante el delay. Cancelando cola vieja.");
                    return false;
                }
                
                const delay = Math.min(texto.length * 28, 3800); 
                console.log(`[EVOLUTION] Enviando simulación de tipeo ("composing") por ${delay}ms`);
                try {
                    await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                        body: JSON.stringify({ number: remoteJid, presence: "composing", delay })
                    });
                } catch(te) {}
                
                await new Promise(r => setTimeout(r, delay + 300));
                
                console.log("[EVOLUTION] Despachando bloque de texto...");
                const evResp = await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, text: texto })
                });
                console.log("[EVOLUTION] Respuesta de envío de texto (Status):", evResp.status);
                return true;
            };

            for (const parte of partes) {
                if ((await enviar(parte)) === false) break;
            }

            // Envío de imágenes lógicas por etapa
            const mapaFotos = { "BIENVENIDA": imgProducto, "ESCUCHA": imgProducto, "SOLUCIÓN": imgBeneficios, "DECISIÓN": imgTestimonios };
            const fotoEtapa = mapaFotos[nuevaEtapa] || "";
            if (fotoEtapa && !fotosEnviadas[nuevaEtapa]) {
                console.log(`[EVOLUTION] Enviando archivo multimedia adjunto para la etapa: ${nuevaEtapa}`);
                await new Promise(r => setTimeout(r, 1200));
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, media: fotoEtapa, mediatype: "image", caption: "" })
                });
                if (["BIENVENIDA","ESCUCHA"].includes(nuevaEtapa) && productoActivo?.img_tabla) {
                    await new Promise(r => setTimeout(r, 1200));
                    await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
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
    } catch (error) { 
        console.error("[CRÍTICO GLOBAL] Ocurrió un fallo en el proceso principal:", error); 
    }

    console.log("[WEBHOOK] Proceso finalizado. Retornando 200 OK.");
    return res.status(200).send('OK');
};
