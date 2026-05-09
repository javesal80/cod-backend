const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const {
        EVOLUTION_URL, EVOLUTION_TOKEN_WHATSAPI, INSTANCE_WHATSAPI,
        GROK_API_KEY, OPENAI_API_KEY, IA_PROVIDER,
        KV_REST_API_URL, KV_REST_API_TOKEN
    } = process.env;

    const NUMERO_ADMIN = "593992668002";

    if (!req.body?.data?.message || req.body.data.key?.fromMe) return res.status(200).send('OK');

const data = req.body.data;
    const remoteJid = data.key?.remoteJid;
    const msgId = data.key?.id;
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
    const instName = req.body.instance || INSTANCE_WHATSAPI || "WHATSAPI";
    const provider = (IA_PROVIDER || 'grok').trim().toLowerCase();

    let clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();

    if (!clienteMsg && data.message?.audioMessage) {
        try {
            const mediaResp = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                body: JSON.stringify({ message: { key: data.key, message: data.message }, convertToMp4: false })
            });
            const mediaJson = await mediaResp.json();
            const base64Audio = mediaJson.base64;
            if (base64Audio) {
                const buffer = Buffer.from(base64Audio, 'base64');
                const formData = new FormData();
                formData.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'audio.ogg');
                formData.append('model', 'whisper-1');
                formData.append('language', 'es');
                const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}` },
                    body: formData
                });
                const whisperJson = await whisperResp.json();
                clienteMsg = whisperJson.text || "";
                console.log("[WHISPER]", clienteMsg);
            }
        } catch (e) {
            console.error("[WHISPER ERROR]", e.message);
        }
    }
    // ─── FECHA/HORA ECUADOR ───────────────────────────────────────────
    const utc = new Date().getTime() + (new Date().getTimezoneOffset() * 60000);
    const hoy = new Date(utc + (3600000 * -5));
    const nombresDias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

    let dia1 = new Date(hoy); dia1.setDate(hoy.getDate() + 1);
    if (dia1.getDay() === 0) dia1.setDate(dia1.getDate() + 1);
    if (dia1.getDay() === 6) dia1.setDate(dia1.getDate() + 2);
    let dia2 = new Date(dia1); dia2.setDate(dia1.getDate() + 1);
    if (dia2.getDay() === 0) dia2.setDate(dia2.getDate() + 1);
    if (dia2.getDay() === 6) dia2.setDate(dia2.getDate() + 2);
    const mañana = nombresDias[dia1.getDay()];
    const pasado = nombresDias[dia2.getDay()];

    // ─── HELPERS REDIS ────────────────────────────────────────────────
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

    // ─── ANTI-DUPLICADOS ──────────────────────────────────────────────
    try {
        const existe = await redisGet(`dd:${msgId}`);
        if (existe) return res.status(200).send('OK');
        await redisSetex(`dd:${msgId}`, 60, "1");
    } catch (e) { console.error("Dedup error:", e.message); }

    // ─── CARGAR ESTADO DESDE REDIS ────────────────────────────────────
    const cleanJid    = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');
    const memoriaKey  = `chat:${cleanJid}`;
    const stageKey    = `stage:${cleanJid}`;
    const productoKey = `prod:${cleanJid}`;
    const fotosKey    = `fotos:${cleanJid}`;  // fotos ya enviadas por etapa

    let historial     = [];
    let etapaActual   = "INICIO";
    let productoActivo = null;
    let fotosEnviadas  = {};  // { "INDAGACION": true, "EDUCACION": true, ... }

    try {
        const [guardado, etapaGuardada, prodGuardado, fotosGuardadas] = await Promise.all([
            redisGet(memoriaKey),
            redisGet(stageKey),
            redisGet(productoKey),
            redisGet(fotosKey)
        ]);
        if (guardado)       { try { historial      = JSON.parse(decodeURIComponent(guardado));       } catch { historial      = JSON.parse(guardado);       } }
        if (etapaGuardada)  etapaActual = etapaGuardada;
        if (prodGuardado)   { try { productoActivo = JSON.parse(decodeURIComponent(prodGuardado));   } catch { productoActivo = JSON.parse(prodGuardado);   } }
        if (fotosGuardadas) { try { fotosEnviadas  = JSON.parse(decodeURIComponent(fotosGuardadas)); } catch { fotosEnviadas  = JSON.parse(fotosGuardadas); } }
    } catch (e) { console.error("Error leyendo Redis:", e.message); }

    // ─── CARGAR CATÁLOGO ──────────────────────────────────────────────
    let catalogo = [];
    let resumenCatalogo = "";
    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            catalogo = dataProductos.PRODUCTOS || [];
            resumenCatalogo = catalogo.map(p =>
                `- ${p.nombre}: ${p.descripcion_corta || ''} | keywords: [${(p.keywords || []).join(', ')}]`
            ).join('\n');
        }
    } catch (e) { console.error("Error cargando catálogo:", e.message); }

    // ─── DETECTAR PRODUCTO POR KEYWORDS ──────────────────────────────
    const msgLower = clienteMsg.toLowerCase().trim();
    const productoDetectado = catalogo.find(p =>
        p.keywords && p.keywords.some(k => msgLower.includes(k.toLowerCase()))
    );

    if (productoDetectado) {
        if (!productoActivo || productoActivo.nombre !== productoDetectado.nombre) {
            fotosEnviadas = {};  // resetear fotos si cambia de producto
        }
        productoActivo = productoDetectado;
        await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
        console.log(`[PRODUCTO] Detectado: ${productoActivo.nombre}`);
    }

    // ─── CARGAR TXT DEL PRODUCTO ACTIVO ──────────────────────────────
    let infoProducto = "";
    let imgProducto = "", imgBeneficios = "", imgTestimonios = "";

    if (productoActivo) {
        try {
            const txtPath = path.join(process.cwd(), 'api', productoActivo.archivo);
            if (fs.existsSync(txtPath)) {
                infoProducto = fs.readFileSync(txtPath, 'utf-8');
                console.log(`[TXT] Cargado: ${productoActivo.nombre} (${infoProducto.length} chars)`);
            }
            imgProducto    = productoActivo.img_producto    || "";
            imgBeneficios  = productoActivo.img_beneficios  || "";
            imgTestimonios = productoActivo.img_testimonios || "";
        } catch (e) { console.error("Error cargando TXT:", e.message); }
    }

    // ─── HISTORIAL ────────────────────────────────────────────────────
    const esPrimerMensaje = historial.length === 0;
    historial.push({ role: "user", content: clienteMsg });
    if (historial.length > 24) historial = historial.slice(-24);

    // ─── CARGAR INFO GENERAL ──────────────────────────────────────────
    let infoGeneral = "";
    try {
        const generalPath = path.join(process.cwd(), 'api', 'info-general.txt');
        if (fs.existsSync(generalPath)) infoGeneral = fs.readFileSync(generalPath, 'utf-8');
    } catch (e) { console.error("Error cargando info-general:", e.message); }

    // ─── MASTER PROMPT ────────────────────────────────────────────────
    const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de JRJMarket. Llevas años ayudando a personas con sus problemas de salud y conoces profundamente los productos que recomiendas. No eres un bot — eres una persona que escucha, interpreta y responde según lo que el cliente realmente necesita en ese momento.

Tratas de USTED. Eres cálida, directa, y genuinamente te importa el bienestar de quien te escribe.

Tu habilidad principal: LEER EL CONTEXTO COMPLETO de la conversación antes de responder.
Cada mensaje del cliente tiene un significado que depende de todo lo que se ha dicho antes. Una palabra suelta no te dice nada — la conversación completa sí. Úsala.

Tu método de venta se basa en tres cosas:
1. ESCUCHAR — entender qué le duele al cliente, qué busca, qué siente.
2. URGAR LA HERIDA — una vez que sabes su dolor, hazle sentir la consecuencia real de no resolverlo. Con empatía, con verdad, sin alarmar.
3. OFRECER LA SOLUCIÓN — presenta el producto como la respuesta natural a ESE dolor específico, con datos concretos del archivo del producto.

---
INFORMACIÓN GENERAL DE LA EMPRESA
---
${infoGeneral}

---
CATÁLOGO DE PRODUCTOS DISPONIBLES
---
${resumenCatalogo || "Catálogo no disponible."}

${infoProducto ? `---
PRODUCTO EN CONVERSACIÓN: ${productoActivo?.nombre?.toUpperCase()}
---
Usa ÚNICAMENTE la información de este archivo para hablar del producto.
Si el cliente pregunta algo que no está aquí, puedes complementar con tu conocimiento general — pero jamás contradigas este texto.

${infoProducto}` : `---
SIN PRODUCTO IDENTIFICADO AÚN
---
Descubre qué le duele o qué busca. Una sola pregunta abierta y natural.`}

---
ETAPA ACTUAL DE LA CONVERSACIÓN: ${etapaActual}
${esPrimerMensaje ? 'Es el primer mensaje — saluda: "Hola, muy buenas... Un gusto saludarle 😊"' : ''}
---

Las etapas son una orientación del punto donde está la conversación, no un guión a seguir paso a paso:

INICIO: Cliente llegó. Salúdalo y entiende qué busca. IMPORTANTE — si desde el primer mensaje el cliente indica intención de compra clara ('quiero comprar', 'quiero pedir', 'me puede enviar', 'cuánto cuesta', 'quiero uno'), salta directo a OFERTA o CIERRE según corresponda. No lo trates como cliente frío si ya llegó convencido.
INDAGACION: Ya sabes el producto. IMPORTANTE — si el cliente llegó pidiendo 'información', 'beneficios', 'qué hace' o simplemente mencionó el producto, NO le preguntes qué aspecto le interesa conocer. Preséntale directamente los beneficios principales usando el ángulo principal del archivo del producto, y termina con una pregunta que explore SU situación personal (ej: '¿hace cuánto tiene ese problema?' o '¿qué síntoma le molesta más?'). La exploración de ángulos específicos viene después, cuando el cliente responde y te da más contexto.
EDUCACION: Ya sabes su dolor. Úrgalo con empatía y presenta el producto como la solución a ESE dolor.
OFERTA: Presenta opciones y precios. Recomienda la más adecuada para su caso. Si el cliente rechaza las opciones o duda, NO te despidas — ya conoces su dolor, úsalo. Recuérdale lo que te contó (sus síntomas, su situación) y hazle ver el costo de seguir sin resolver ese problema. La persuasión aquí se basa en lo que el cliente mismo ya te reveló durante la conversación.
CIERRE: Antes de pedir los datos, confirma en una línea lo que el cliente eligió: producto y cantidad. Luego pide los datos con el formulario.
        Recopila datos de envío con este formulario exacto, sin cambiar una sola palabra:
  "Listo, ayúdeme con los siguientes datos por favor:\\n*Nombre y Apellido:*\\n*Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
  No pidas cédula ni correo. No aceptes direcciones vagas. Si faltan datos, pide solo lo que falta.
CONFIRMADO: Cuando tengas nombre, ciudad y dirección completa, confirma con este mensaje exacto:
  "Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar). Las entregas son de 9am a 5pm — si tiene inconvenientes en ese horario, podemos coordinar entrega en una oficina Servientrega cercana. Su primera compra tiene envío GRATIS. 🛡️"
POSTVENTA: Despedida cálida. Si el cliente mencionó otro malestar durante la conversación, ofrece el producto correspondiente antes de despedirte.

---
CÓMO RESPONDER
---
- Máximo 3 párrafos cortos por mensaje. Escribe como hablas, no como un manual.
- FORMATO WHATSAPP: Usa \\n\\n entre párrafos para dar espacio visual. Cada idea en su propia línea. Usa emojis con moderación — 1 o 2 por mensaje, solo donde aporten calidez, no al final de cada frase. Cuando presentes listas de precios o pasos, cada opción en su propia línea con \\n. El mensaje debe ser fácil de leer de un vistazo, sin bloques de texto apretados.
- Antes de responder, revisa el historial completo. Nunca repitas información, frases o preguntas que ya enviaste en esta conversación.
- Termina siempre con una pregunta, EXCEPTO en el formulario de datos, la confirmación del pedido y la despedida final.
- No uses frases de catálogo genéricas. Conecta cada dato del producto con el problema específico del cliente.
- Si el cliente pregunta por otro producto del catálogo o menciona un malestar que corresponde a otro producto, ofrécelo con naturalidad.
- En cualquier momento de la conversación, si el contexto te indica que el cliente quiere retirarse sin haber comprado, no lo dejes ir sin antes recordarle su propio dolor — lo que él mismo te contó. Hazle ver con empatía y convicción qué pasará si no resuelve ese problema. La persuasión más poderosa es devolverle sus propias palabras: su síntoma, su situación, su miedo. Usa eso. Solo cuando el contexto deje claro que el cliente no quiere continuar después de varios intentos genuinos, despídete con calidez.

---
FORMATO DE RESPUESTA — OBLIGATORIO
---
Responde ÚNICAMENTE con JSON puro. Sin texto antes ni después. Sin bloques de código markdown.

{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta aquí"}

Etapas válidas: INICIO, INDAGACION, EDUCACION, OFERTA, CIERRE, CONFIRMADO, POSTVENTA
En el mensaje: usa *negrita* y \\n para saltos de línea. Usa SOLO comillas simples si necesitas citar — nunca comillas dobles dentro del mensaje.
`;

    // ─── LLAMADA A LA IA ──────────────────────────────────────────────
    let textoFinal = "";
    let nuevaEtapa  = etapaActual;

    try {
        // Historial sin el último mensaje del usuario
        const historialParaIA = historial.slice(0, -1);
        const mensajesFinales = [
            ...historialParaIA,
            { role: "user", content: clienteMsg },
            // Recordatorio de formato justo antes de la respuesta
            { role: "system", content: 'RECUERDA: Responde ÚNICAMENTE con JSON puro, sin texto adicional. Formato exacto: {"etapa":"ETAPA","mensaje":"tu respuesta"}. CRÍTICO: Si el cliente no ha confirmado su compra y el contexto sugiere que quiere retirarse, NO te despidas — usa lo que el cliente te contó sobre su problema para persuadirlo con empatía. Devuélvele sus propias palabras y hazle ver qué pasará si no actúa. Mínimo 3 intentos genuinos antes de despedirte.' }
        ];

        const bodyIA = {
            model: provider === 'grok' ? "grok-2-latest" : "gpt-4o",
            messages: [
                { role: "system", content: masterPrompt },
                ...mensajesFinales
            ],
            temperature: 0.75,
            max_tokens: 1000
        };

        let respuestaRaw = "";

        if (provider === 'grok') {
            const respIA = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyIA)
            });
            const jsonIA = await respIA.json();
            console.log("[GROK STATUS]", respIA.status, JSON.stringify(jsonIA).substring(0, 200));
            respuestaRaw = jsonIA.choices?.[0]?.message?.content || "";
        } else {
            const respIA = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyIA)
            });
            const jsonIA = await respIA.json();
            console.log("[OPENAI STATUS]", respIA.status, JSON.stringify(jsonIA).substring(0, 200));
            respuestaRaw = jsonIA.choices?.[0]?.message?.content || "";
        }

        console.log("[IA RAW]", respuestaRaw.substring(0, 400));

        // ─── PARSEAR JSON ─────────────────────────────────────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const jsonMatch = clean.match(/\{[\s\S]*\}/);
            if (jsonMatch) clean = jsonMatch[0];
            parsed = JSON.parse(clean);
        } catch (e) {
            console.error("[PARSE ERROR] IA no devolvió JSON — usando texto plano como fallback");
            // Fallback: usar el texto tal cual y mantener etapa
            textoFinal = respuestaRaw.trim();
            nuevaEtapa  = etapaActual;
        }

        if (parsed) {
            textoFinal = (parsed.mensaje || "").replace(/\\n/g, '\n');
            nuevaEtapa  = parsed.etapa  || etapaActual;
            console.log(`[ETAPA] ${etapaActual} → ${nuevaEtapa}`);
        }

        // ─── GUARDAR EN REDIS ─────────────────────────────────────────
        historial.push({ role: "assistant", content: textoFinal });
        await Promise.all([
            redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
            redisSetex(stageKey,   86400 * 7, nuevaEtapa)
        ]);

        // ─── GUARDAR EN SUPABASE ──────────────────────────────────────
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
                    jid: cleanJid,
                    etapa_final: nuevaEtapa,
                    producto: productoActivo?.nombre || null,
                    vendido: nuevaEtapa === 'CONFIRMADO',
                    historial: historial,
                    updated_at: new Date().toISOString()
                })
            });
        } catch (e) { console.error("[SUPABASE ERROR]", e.message); }
        console.log("[SUPABASE] Guardado intento completado");

        // ─── NOTIFICACIÓN ADMIN ───────────────────────────────────────
        if (nuevaEtapa === "CONFIRMADO" && etapaActual !== "CONFIRMADO") {
            const resumenVenta = `📦 *NUEVA VENTA FINALIZADA*
--------------------------------
📦 *Producto:* ${productoActivo?.nombre || "Ver historial"}
📱 *WhatsApp:* https://wa.me/${remoteJid.split('@')[0]}
📝 *Datos del cliente:*
${clienteMsg}
--------------------------------
_Fiorella cerró esta venta automáticamente._`;

            await fetch(`${baseUrl}/message/sendText/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                body: JSON.stringify({ number: NUMERO_ADMIN, text: resumenVenta })
            });
            console.log(`[ADMIN] Notificación de venta enviada`);
        }

        // ─── ENVÍO DE MENSAJES ────────────────────────────────────────
        if (textoFinal) {
            let partes = textoFinal
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "");

            if (partes.length > 8) {
                const ultima = partes.pop();
                partes = partes.slice(0, 7);
                partes.push(ultima);
            }

            if (partes.length > 1 && partes[0].length < 30) {
                partes[1] = partes[0] + " " + partes[1];
                partes.shift();
            }

            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            // Enviar párrafos
            for (const parte of partes) {
    await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
        body: JSON.stringify({ number: remoteJid, presence: "composing", delay: Math.min(parte.length * 35, 5000) })
    });
    await new Promise(r => setTimeout(r, Math.min(parte.length * 35, 5000) + Math.floor(Math.random() * 1000)));
    await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });

                             
            }

            // ─── LÓGICA DE FOTOS ──────────────────────────────────────
            // img_producto  → primera vez que aparece el producto (INDAGACION)
            //                 va ENTRE el texto y la pregunta de cierre
            // img_beneficios → cuando entra a EDUCACION
            //                  va ENTRE el texto y la pregunta de cierre
            // img_testimonios → cuando entra a OFERTA (antes de mostrar precios)
            //                   va ANTES de la pregunta de cierre

            const mapaFotos = {
                "INDAGACION": imgProducto,
                "EDUCACION":  imgBeneficios,
                "OFERTA":     imgTestimonios
            };

            const fotoDeEstaEtapa = mapaFotos[nuevaEtapa] || "";
            const fotoYaEnviada   = fotosEnviadas[nuevaEtapa] === true;
            const etapaCambio     = nuevaEtapa !== etapaActual;
            const esNuevoProducto = !fotosEnviadas["INDAGACION"];
            const debeEnviarFoto  = fotoDeEstaEtapa && (etapaCambio || (nuevaEtapa === "INDAGACION" && esNuevoProducto)) && !fotoYaEnviada;

            const enviarFoto = async () => {
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({
                        number: remoteJid,
                        media: fotoDeEstaEtapa,
                        mediatype: "image",
                        caption: ""
                    })
                });
                await new Promise(r => setTimeout(r, 1500));
                fotosEnviadas[nuevaEtapa] = true;
                await redisSetex(fotosKey, 86400 * 7, JSON.stringify(fotosEnviadas));
                console.log(`[FOTO] Enviada: ${nuevaEtapa}`);
            };

            // Foto va ENTRE el cuerpo del mensaje y la pregunta de cierre
            if (debeEnviarFoto) await enviarFoto();
            else console.log(`[FOTO] Omitida — etapa: ${nuevaEtapa} | cambio: ${etapaCambio} | yaEnviada: ${fotoYaEnviada}`);

            // Pregunta de cierre — siempre al final
            if (preguntaCierre) {
    await fetch(`${baseUrl}/chat/sendPresence/${instName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
        body: JSON.stringify({ number: remoteJid, presence: "composing", delay: Math.min(preguntaCierre.length * 35, 4000) })
    });
    await new Promise(r => setTimeout(r, Math.min(preguntaCierre.length * 35, 4000) + Math.floor(Math.random() * 800)));
    await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, text: preguntaCierre })
                });
            }
        }

    } catch (error) {
        console.error("Error flujo general:", error.message);
    }

    return res.status(200).send('OK');
};
