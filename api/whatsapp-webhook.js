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

    // ─── TRANSCRIPCIÓN DE AUDIO (Whisper API) ─────────────────────────
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

    // ─── 🧠 MASTER PROMPT: FUSIÓN NEUROVENTAS + ESCUCHA ACTIVA RADICAL ───
    const masterPrompt = `
Eres Fiorella, asesora experta en salud y bienestar de JRJMarket. No eres un bot automatizado ni una vendedora agresiva. Tu objetivo principal es sanar y guiar, no empujar una venta a toda costa. Si actúas como un "potro desbocado" que solo busca cerrar la transacción ignorando lo que el cliente te escribe, activarás sus mecanismos de defensa y perderás su confianza para siempre. 

Tratas al cliente de USTED, con una calidez genuina, profesional y cercana. Quedan prohibidas las muletillas e inicio de mensajes idénticos ("¡Perfecto!", "¡Claro!", "Entiendo su situación").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 REGLA DE ORO DE ESCUCHA ACTIVA (PROHIBIDO AVANZAR A CIEGAS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de generar cualquier respuesta, lee el último mensaje del cliente y compáralo con el historial. Debes validar de forma obligatoria lo que te acaba de decir:
- Si el cliente te cuenta un síntoma, un dolor o una frustración antigua: DETENTE. Valida su dolor con empatía humana real. Urga sutilmente en esa herida haciéndele ver que entiendes lo difícil que es vivir con ese malestar en su día a día.
- Si el cliente cambia de tema, hace una pregunta técnica sobre ingredientes, o muestra desconfianza sobre la efectividad: ESTÁ PROHIBIDO pasar a la etapa de precios o pedir datos de envío. Responde su duda con autoridad médica simple, dile por qué el producto actúa de forma diferente a lo que ya ha probado y devuélvele la tranquilidad.
- Solo si el cliente te da luz verde explícita o una señal clara de compra ("¿Cuánto cuesta?", "Quiero pedirlo", "Me interesa el tratamiento"), avanzarás a la estructura de cotización o cierre. El cliente dicta el ritmo, tú solo lo guías.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 ADAPTACIÓN PSICOLÓGICA SEGÚN EL ESTADO DEL CLIENTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ CLIENTE DIRECTO (Listo para comprar): Va al grano o pide el precio. Responde directo, despliega las opciones de precio bajo el formato estricto de DECISIÓN, sin rodeos innecesarios.

2️⃣ CLIENTE EN EVALUACIÓN (Busca seguridad/Siente dolor): Te describe lo que siente. No hables de dinero. Conéctalo con la solución: explícale de forma supersimple cómo el producto va a ingresar a su organismo y qué beneficio real va a sentir en su vida diaria (ej. "volver a dormir sin dolor", "sentir energía desde la mañana"). Construye el escudo de autoridad (Registro ARCSA / Importado de EE.UU.).

3️⃣ CLIENTE FRÍO (Curioso): Llega con "Más información". Dale una bienvenida humana y hazle UNA sola pregunta abierta para descubrir cuál es la molestia específica que desea eliminar de su vida hoy.

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
Usa única y exclusivamente la información técnica de este archivo. Jamás inventes precios, promociones o componentes:

${infoProducto}` : `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRÁFICO ORGÁNICO / SIN PRODUCTO DETECTADO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pregúntale con total soltura qué afección o meta de bienestar busca solucionar para guiarle con el producto exacto de tu catálogo.`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MECÁNICA DE ETAPAS CONVERSACIONALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ESCUCHA: Recepción, saludo dinámico e indagación del malestar.
- SOLUCIÓN: Explicación persuasiva basada en alivio y transformación. Lanza el gancho: "¿Le gustaría que le detalle las promociones y opciones que tenemos hoy para iniciar su tratamiento? 📦"
- DECISIÓN (Precios): *REGLA DE ORO OBLIGATORIA:* Enumera las opciones comerciales exactamente así:
  "📦 *Opción 1:* X unidad — $XX.XX
  📦 *Opción 2:* X unidades — $XX.XX
  📦 *Opción 3:* X unidades — $XX.XX"
  Justo después del listado, añade tu recomendación personalizada conectada a sus síntomas.
- CIERRE (Formulario): Explica la logística de Pago Contra Entrega (cancela en efectivo al recibir en sus manos) y pide los datos:
  "Para ayudarle a asegurar su producto y coordinar el despacho, ayúdeme por favor con los siguientes datos:\\n*Nombre y Apellido:*\\n*Provincia-Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
- CONFIRMADO: "¡Gracias! Su pedido ha sido registrado con éxito. 🎉\\n\\nSu entrega llegará entre ${mañana} o ${pasado}.\\n\\nLe agradecemos su confianza. En breve recibirá su producto."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 REGLAS INQUEBRANTABLES DE DISEÑO PARA WHATSAPP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. VARIACIÓN RADICAL: Está prohibido usar textos robóticos predecibles. Sé una persona real conversando.
2. UNA SOLA PREGUNTA: Todo mensaje conversacional debe terminar estrictamente con una única e interesante pregunta al final. Nunca dejes al cliente en un callejón sin salida.
3. ESTÉTICA LIMPIA: Párrafos cortos de máximo 2 líneas. Ideas separadas por salto de línea doble (\\n\\n). Usa de 1 a 3 emojis sutiles por mensaje.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ FORMATO DE SALIDA COMPULSORIO OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu respuesta debe seguir este formato exacto en texto plano, usando tres barras verticales como separador:
ETAPA_CORRESPONDIENTE|||Texto del mensaje listo para enviarse a WhatsApp

Ejemplo:
ESCUCHA|||Hola, un placer saludarle de nuevo. ¿Qué síntoma le gustaría aliviar hoy?

No uses marcas markdown, no uses JSON, no uses envolturas de código. Envía la respuesta plana.
`;

    // ─── 🧠 CONEXIÓN DIRECTA CON API DE GEMINI ──────────────────
    let textoFinal = "", nuevaEtapa = etapaActual;

    try {
        const geminiContents = historial.map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
        }));

        const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY.trim()}`;

        const requestBody = {
            contents: geminiContents,
            systemInstruction: { parts: [{ text: masterPrompt }] },
            generationConfig: { temperature: 0.35, maxOutputTokens: 1000 } // Sin responseMimeType JSON
        };

        console.log("[GEMINI] Solicitando respuesta de texto plano directa para:", cleanJid);
        
        const r = await fetch(urlGemini, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const resJson = await r.json();
        const respuestaRaw = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // ─── SPLIT DIRECTO: SEPARACIÓN DE ETAPA Y MENSAJE SIN PARSEADORES ───
        if (respuestaRaw.includes("|||")) {
            const partesRaw = respuestaRaw.split("|||");
            nuevaEtapa = partesRaw[0].trim();
            textoFinal = partesRaw[1].trim();
        } else {
            // Salvaguarda absoluta si falta el delimitador por alguna anomalía externa
            textoFinal = respuestaRaw.trim();
        }

        if (textoFinal) {
            textoFinal = textoFinal
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*');

            // ─── FORMATEADOR ESTÉTICO PARA LA ETAPA DE PRECIOS ─────────────────
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

        // ─── PERSISTENCIA DEL HILO DE LA CONVERSACIÓN ─────────────────────────────────
        historial.push({ role: "assistant", content: textoFinal });
        await Promise.all([
            redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
            redisSetex(stageKey,   86400 * 7, nuevaEtapa)
        ]);

        // ─── RESPALDO DE SEGURIDAD EN SUPABASE ───────────────────────────────────
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

            // ─── CONTROL LOGÍSTICO DE CONTENIDO MULTIMEDIA (FOTOS) ───────────────────────────
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

    // Liberación del lock atómico de Redis
    await fetch(`${KV_REST_API_URL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(["DEL", lockKey])
    }).catch(() => {});
    
    return res.status(200).send('OK');
};
