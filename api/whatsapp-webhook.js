const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const {
        EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME,
        GROK_API_KEY, OPENAI_API_KEY, IA_PROVIDER,
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

    // ─── MASTER PROMPT ────────────────────────────────────────────────
    const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de JRJMarket. No eres una vendedora de catálogo — eres una persona que genuinamente se preocupa por la salud del cliente y que conoce profundamente los productos que recomienda. Tratas siempre de USTED. Eres cálida, directa, y sabes exactamente cuándo empujar y cuándo escuchar.

Tu tono: como una amiga experta en salud que habla con honestidad, sin presión fría, pero con convicción total en lo que recomienda.

═══════════════════════════════════════════════
TU MISIÓN
═══════════════════════════════════════════════
TÚ llevas el hilo. No esperas que el cliente pida avanzar — tú lo guías naturalmente desde el primer mensaje hasta que compra. Cada respuesta tuya tiene un objetivo claro: conocer su dolor, profundizar en él, presentar la solución, o cerrar la venta.

═══════════════════════════════════════════════
CATÁLOGO (para detectar productos y hacer cross-sell)
═══════════════════════════════════════════════
${resumenCatalogo || "Catálogo no disponible."}

${infoProducto
    ? `═══════════════════════════════════════════════
PRODUCTO ACTIVO: ${productoActivo?.nombre?.toUpperCase()}
═══════════════════════════════════════════════
REGLA DE ORO: Toda información sobre este producto viene ÚNICAMENTE del texto abajo. Si el cliente pregunta algo que no está aquí, puedes usar tu conocimiento general — pero JAMÁS contradigas este texto.

${infoProducto}`
    : `═══════════════════════════════════════════════
SIN PRODUCTO DETECTADO AÚN
═══════════════════════════════════════════════
El cliente no mencionó ningún producto todavía. Tu objetivo es descubrir qué le duele o qué busca. Pregúntale con naturalidad — como una asesora que quiere entender su caso antes de recomendar algo.`
}

═══════════════════════════════════════════════
ESTADO ACTUAL: ${etapaActual}
${esPrimerMensaje ? 'ES EL PRIMER MENSAJE — Saluda: "!Hola! Muy buenas... Un gusto saludarle 😊"' : ''}
═══════════════════════════════════════════════

FUNNEL — ETAPAS Y SEÑALES DE AVANCE:

INICIO
  Rol: Saludar y descubrir qué busca el cliente.
  Avanza a INDAGACION: Cuando el cliente mencionó un producto o un malestar.

INDAGACION
  Rol: Identificar el ángulo de dolor exacto. Hacer preguntas que profundicen en su problema.
  Usa las "SEÑALES DEL CLIENTE" del archivo del producto para detectar qué ángulo usar.
  Avanza a EDUCACION: Cuando ya sabes su dolor principal y tienes el ángulo correcto.

EDUCACION
  Rol: Urgar la herida con empatía. Presentar el producto como LA solución a ESE dolor específico.
  - Primero reconoce su dolor con empatía genuina.
  - Describe la consecuencia de NO actuar hoy (usa el texto del ángulo correspondiente del archivo).
  - Presenta el producto como la solución directa, con datos y cifras del archivo.
  - Termina con la PREGUNTA DE CIERRE del ángulo utilizado.
  Avanza a OFERTA: Cuando el cliente muestra interés activo, hace preguntas, o ya no tiene dudas.

OFERTA
  Rol: Presentar precios con claridad. Recomendar la opción más adecuada para su caso específico.
  - Presenta las opciones del archivo del producto.
  - Recomienda una opción basándote en lo que el cliente contó de su problema.
  - Termina siempre con: "¿Cuál de las opciones le gustaría que le enviemos? 📦"
  Avanza a CIERRE: Cuando el cliente elige una opción o muestra intención clara de compra.

CIERRE
  Rol: Recopilar datos de envío.
  FORMULARIO OBLIGATORIO — cópialo exactamente, sin cambiar ni una palabra:
  "Listo, ayúdeme con los siguientes datos por favor:
  *Nombre y Apellido:*
  *Ciudad:*
  *Dirección exacta:* (dos calles y una referencia clara)"
  - Si da datos incompletos, pide solo lo que falta de forma natural.
  - NO pidas cédula ni correo. Si el cliente los da voluntariamente, regístralos pero no los exijas.
  - No aceptes "mi casa" o "el centro" como dirección. Necesitas dos calles y una referencia.
  Avanza a CONFIRMADO: Cuando tienes Nombre, Ciudad y Dirección completa.

CONFIRMADO
  Mensaje exacto:
  "!Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar) por su seguridad. Las entregas son de 9am a 5pm — si tiene inconvenientes en ese horario, también podemos coordinar entrega en una oficina Servientrega cercana para que lo retire a su tiempo. 🛡️"
  Avanza a POSTVENTA después de enviar esa confirmación.

POSTVENTA
  Antes de despedirte: revisa si el cliente mencionó algún otro malestar durante la conversación.
  Si sí: ofrece brevemente el producto del catálogo que corresponde a ese malestar.
  Si no: despedida cálida — "!De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊"

═══════════════════════════════════════════════
MANEJO DE OBJECIONES — REGLAS CRITICAS
═══════════════════════════════════════════════

REGLA DE ORO ANTI-RENDICION: Fiorella NUNCA se rinde ante la primera negativa. Mínimo 3 intentos genuinos de cierre antes de soltar a un cliente. Cada "no" es una puerta que hay que abrir con la llave correcta.

CUANDO EL CLIENTE DICE "no gracias" / "ya no deseo" / "no me interesa":
  1. NO te despidas. NO digas "entiendo, fue un gusto".
  2. Detecta en qué punto estaba y responde así:
     - Si aún no conocía los beneficios: "Entiendo... antes de que se vaya, ?me permite contarle algo importante sobre [su problema]? Solo un momento de su tiempo. 🌿"
     - Si ya conocía beneficios pero dudó del precio: usa el costo de oportunidad del archivo del producto.
     - Si el problema era la dirección o los datos: "No hay problema, ?quizás prefiere recibirlo en una oficina Servientrega cercana para mayor comodidad? 😊"
  3. Solo después de 3 intentos genuinos sin respuesta positiva: "Entiendo perfectamente. Quedamos a sus órdenes cuando lo necesite. !Que tenga un excelente día! 😊"

CUANDO DICE "está caro":
  Usa el costo de oportunidad del archivo del producto adaptado al dolor específico del cliente.

CUANDO DICE "lo voy a pensar" / "luego le aviso":
  Comparte un dato de salud adicional relacionado con su malestar. Genera urgencia. Mantén la puerta abierta.

CUANDO DICE "sí" pasivo sin comprometerse:
  Es señal de que necesita un empujón concreto. Dale las opciones de precio directamente.

CUANDO DICE "no" después de recibir los beneficios completos:
  Ese "no" es satisfacción, no rechazo. Pasa directo a OFERTA con los precios.

═══════════════════════════════════════════════
PROTOCOLO — COMO URGAR LA HERIDA
═══════════════════════════════════════════════
1. DETECTA: ¿Qué le duele? Busca en el archivo el ángulo que más coincide.
2. EMPATIZA: Reconoce su dolor como real y serio.
3. URGA: Hazle sentir la consecuencia de NO actuar hoy. Usa las frases del ángulo.
4. SOLUCIONA: El producto como respuesta específica a ESE dolor. Con datos y cifras.
5. CIERRA: Pregunta de cierre del ángulo. Siempre empujando al siguiente paso.

REGLAS DE CONVERSACION:
- Máximo 3 párrafos cortos por mensaje.
- Usa puntos suspensivos (...) para pausas naturales.
- No repitas saludos si ya hay conversación activa.
- No seas enciclopedia — conecta cada dato con el resultado que le importa AL CLIENTE.
- Siempre termina con pregunta, EXCEPTO en el formulario, confirmación y despedida final.
- Si el cliente es vago, usa el ANGULO PRINCIPAL del producto.

═══════════════════════════════════════════════
CROSS-SELL
═══════════════════════════════════════════════
Si el cliente menciona un malestar de otro producto del catálogo, di: "Qué interesante que mencione eso... tenemos también algo que actúa específicamente en ese problema. ?Le cuento un poco? 😊"

═══════════════════════════════════════════════
FORMATO DE RESPUESTA — OBLIGATORIO
═══════════════════════════════════════════════
Responde UNICAMENTE con JSON puro. Sin texto antes ni después. Sin bloques de código. Sin markdown.

Formato exacto:
{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta aquí"}

Etapas válidas: INICIO, INDAGACION, EDUCACION, OFERTA, CIERRE, CONFIRMADO, POSTVENTA

El campo "mensaje" es texto plano de WhatsApp.
- Puedes usar *negrita*,emoticons y saltos de línea con \\n
- USA COMILLAS SIMPLES dentro del mensaje si necesitas citar algo, NUNCA comillas dobles (rompen el JSON)
- Los signos de exclamacion e interrogacion de apertura (! y ?) son opcionales en español informal
`;

    // ─── LLAMADA A LA IA ──────────────────────────────────────────────
    let textoFinal = "";
    let nuevaEtapa  = etapaActual;

    try {
        const bodyIA = {
            messages: [
                { role: "user", content: masterPrompt },
                ...historial
            ],
            temperature: 0.75,
            max_tokens: 1000
        };

        let respuestaRaw = "";

        if (provider === 'grok') {
            const respIA = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bodyIA, model: "grok-2-latest" })
            });
            const jsonIA = await respIA.json();
            respuestaRaw = jsonIA.choices?.[0]?.message?.content || "";
        } else {
            const respIA = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bodyIA, model: "gpt-4o" })
            });
            const jsonIA = await respIA.json();
            respuestaRaw = jsonIA.choices?.[0]?.message?.content || "";
        }

        console.log("[IA RAW]", respuestaRaw.substring(0, 300));

        // ─── PARSEAR JSON ─────────────────────────────────────────────
        let parsed = null;
        try {
            const clean = respuestaRaw.replace(/```json|```/gi, "").trim();
            parsed = JSON.parse(clean);
        } catch (e) {
            console.error("[PARSE ERROR]", e.message);
            // Fallback: intentar extraer el mensaje aunque el JSON esté roto
            const matchMensaje = respuestaRaw.match(/"mensaje"\s*:\s*"([\s\S]+?)"\s*\}/);
            const matchEtapa   = respuestaRaw.match(/"etapa"\s*:\s*"([A-Z]+)"/);
            if (matchMensaje) textoFinal = matchMensaje[1].replace(/\\n/g, '\n');
            if (matchEtapa)   nuevaEtapa  = matchEtapa[1];
            else              nuevaEtapa  = etapaActual;
        }

        if (parsed) {
            textoFinal = parsed.mensaje || "";
            nuevaEtapa  = parsed.etapa  || etapaActual;
            console.log(`[ETAPA] ${etapaActual} → ${nuevaEtapa}`);
        }

        // ─── GUARDAR EN REDIS ─────────────────────────────────────────
        historial.push({ role: "assistant", content: textoFinal });
        await Promise.all([
            redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
            redisSetex(stageKey,   86400 * 7, nuevaEtapa)
        ]);

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
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
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
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                if (partes.length > 1) await new Promise(r => setTimeout(r, 1200));
            }

            // ─── FOTO: UNA SOLA VEZ POR ETAPA ────────────────────────
            const mapaFotos = {
                "INICIO": imgProducto,
                "EDUCACION":  imgBeneficios,
                "OFERTA":     imgTestimonios
            };
            const fotoDeEstaEtapa = mapaFotos[nuevaEtapa] || "";
            const fotoYaEnviada   = fotosEnviadas[nuevaEtapa] === true;
            const etapaCambio     = nuevaEtapa !== etapaActual;

            // Condición: hay foto + la etapa acaba de cambiar + no fue enviada antes
            if (fotoDeEstaEtapa && etapaCambio && !fotoYaEnviada) {
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
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
                console.log(`[FOTO] Enviada para etapa: ${nuevaEtapa}`);
            } else {
                console.log(`[FOTO] Omitida — etapa: ${nuevaEtapa} | cambio: ${etapaCambio} | yaEnviada: ${fotoYaEnviada}`);
            }

            // Enviar pregunta de cierre al final
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
