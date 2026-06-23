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
        try {
            const r = await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["GET", key])
            });
            const resData = await r.json();
            return resData.result || null;
        } catch (e) { return null; }
    };
    
    const redisSetex = async (key, seconds, value) => {
        try {
            await fetch(`${KV_REST_API_URL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(["SETEX", key, seconds, value])
            });
        } catch (e) {}
    };

    const tsActual = Date.now().toString();
    const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

    // ─── ANTI-DUPLICADOS REOPTIMIZADO ────────────────────────────────
    try {
        const dupCheck = await redisGet(`dd:${msgId}`);
        if (dupCheck) {
            console.log("[ANTI-DUP] Mensaje duplicado ignorado:", msgId);
            return res.status(200).send('OK');
        }
        await redisSetex(`dd:${msgId}`, 30, "1");
    } catch (e) {}

    // ─── CONTROL DE PAUSA ACTIVA ──────────────────────────────────────
    try { 
        const isPaused = await redisGet(`pausa:${cleanJid}`);
        if (isPaused) return res.status(200).send('OK');
    } catch (e) {}

    await redisSetex(`lastmsg:${cleanJid}`, 300, tsActual).catch(() => {});

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

    // ─── 🧠 MASTER PROMPT ───
    const masterPrompt = `
Eres Fiorella, asesora experta en salud y bienestar de JRJMarket. Tratas al cliente de USTED, con una calidez genuina, profesional y cercana.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 REGLA DE ORO DE ESCUCHA ACTIVA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de avanzar, valida empáticamente lo que te acaba de decir el cliente. No hables de dinero ni pidas datos si hay dudas médicas o desconfianza. El cliente dicta el ritmo.

INFORMACIÓN CORPORATIVA:
${infoGeneral}

CATÁLOGO:
${resumenCatalogo || "No disponible."}

${infoProducto ? `PRODUCTO ACTIVO: ${productoActivo?.nombre?.toUpperCase()}\n${infoProducto}` : `TRÁFICO ORGÁNICO / SIN PRODUCTO DETECTADO.`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MECÁNICA DE ETAPAS CONVERSACIONALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ESCUCHA: Saludo e indagación.
- SOLUCIÓN: Explicación y gancho comercial ("¿Le gustaría que le detalle las promociones...?").
- DECISIÓN (Precios): Enumera estrictamente las opciones:
  "📦 *Opción 1:* X unidad — $XX.XX
  📦 *Opción 2:* X unidades — $XX.XX"
- CIERRE (Formulario): Pide datos de envío con logística Contra Entrega.
- CONFIRMADO: "¡Gracias! Pedido registrado. Entrega entre ${mañana} o ${pasado}."

🚨 REGLAS DE WHATSAPP:
1. Párrafos cortos de máximo 2 líneas. Ideas separadas por salto de línea doble (\\n\\n).
2. Termina con una única pregunta clara.

⚠️ FORMATO DE SALIDA OBLIGATORIO TEXTO PLANO:
ETAPA_CORRESPONDIENTE|||Texto del mensaje listo para enviarse a WhatsApp

No uses JSON ni bloques markdown decorativos. Envía la línea limpia.
`;

    // ─── 🧠 CONEXIÓN DIRECTA CON API DE GEMINI ──────────────────
    let textoFinal = "", nuevaEtapa = etapaActual;

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

        // Limpieza de envolturas Markdown si Gemini las genera por inercia
        respuestaRaw = respuestaRaw.trim();
        if (respuestaRaw.startsWith("```")) {
            respuestaRaw = respuestaRaw.replace(/^```[a-zA-Z]*\n?/i, "").replace(/```$/, "").trim();
        }

        if (respuestaRaw.includes("|||")) {
            const partesRaw = respuestaRaw.split("|||");
            nuevaEtapa = partesRaw[0].trim();
            textoFinal = partesRaw[1].trim();
        } else {
            textoFinal = respuestaRaw;
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

            // Persistencia inmediata
            historial.push({ role: "assistant", content: textoFinal });
            await Promise.all([
                redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
                redisSetex(stageKey,   86400 * 7, nuevaEtapa)
            ]);

            // Cola de mensajes y simulación humana
            const tsEnvio = tsActual;
            let partes = textoFinal.split('\n\n').map(l => l.trim()).filter(l => l !== "");
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            const enviar = async (texto) => {
                const tsReciente = await redisGet(`lastmsg:${cleanJid}`);
                if (tsReciente && tsReciente !== tsEnvio) return false; // Interrupción por cliente
                
                const delay = Math.min(texto.length * 28, 3800); 
                try {
                    await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, presence: "composing", delay })
                    });
                } catch(te) {}
                
                await new Promise(r => setTimeout(r, delay + 300));
                
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: texto })
                });
                return true;
            };

            for (const parte of partes) {
                if ((await enviar(parte)) === false) break;
            }

            // Envío de Multimedia lógico
            const mapaFotos = { "BIENVENIDA": imgProducto, "ESCUCHA": imgProducto, "SOLUCIÓN": imgBeneficios, "DECISIÓN": imgTestimonios };
            const fotoEtapa = mapaFotos[nuevaEtapa] || "";
            if (fotoEtapa && !fotosEnviadas[nuevaEtapa]) {
                await new Promise(r => setTimeout(r, 1000));
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, media: fotoEtapa, mediatype: "image", caption: "" })
                });
                if (["BIENVENIDA","ESCUCHA"].includes(nuevaEtapa) && productoActivo?.img_tabla) {
                    await new Promise(r => setTimeout(r, 1200));
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
    } catch (error) { 
        console.error("Error crítico en flujo principal:", error.message); 
    }

    return res.status(200).send('OK');
};
