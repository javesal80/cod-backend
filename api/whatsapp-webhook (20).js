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

    // ─── HISTORIAL Y ETAPA DESDE REDIS ───────────────────────────────
    const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');
    const memoriaKey = `chat:${cleanJid}`;
    const stageKey = `stage:${cleanJid}`;
    const productoKey = `prod:${cleanJid}`;

    let historial = [];
    let etapaActual = "INICIO";
    let productoActivo = null;

    try {
        const [guardado, etapaGuardada, prodGuardado] = await Promise.all([
            redisGet(memoriaKey),
            redisGet(stageKey),
            redisGet(productoKey)
        ]);
        if (guardado) {
            try { historial = JSON.parse(decodeURIComponent(guardado)); } catch { historial = JSON.parse(guardado); }
        }
        if (etapaGuardada) etapaActual = etapaGuardada;
        if (prodGuardado) {
            try { productoActivo = JSON.parse(decodeURIComponent(prodGuardado)); } catch { productoActivo = JSON.parse(prodGuardado); }
        }
    } catch (e) { console.error("Error leyendo Redis:", e.message); }

    // ─── CARGAR CATÁLOGO ──────────────────────────────────────────────
    let catalogo = [];
    let resumenCatalogo = "";
    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            catalogo = dataProductos.PRODUCTOS || [];
            // Resumen compacto para cross-sell en el prompt
            resumenCatalogo = catalogo.map(p =>
                `- ${p.nombre}: keywords [${(p.keywords || []).join(', ')}]`
            ).join('\n');
        }
    } catch (e) { console.error("Error cargando catálogo:", e.message); }

    // ─── DETECTAR PRODUCTO POR KEYWORDS ──────────────────────────────
    const msgLower = clienteMsg.toLowerCase().trim();
    const productoDetectado = catalogo.find(p =>
        p.keywords && p.keywords.some(k => msgLower.includes(k.toLowerCase()))
    );

    if (productoDetectado) {
        // El cliente mencionó un producto nuevo — actualizar producto activo
        productoActivo = productoDetectado;
        await redisSetex(productoKey, 86400, JSON.stringify(productoActivo));
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
            imgProducto = productoActivo.img_producto || "";
            imgBeneficios = productoActivo.img_beneficios || "";
            imgTestimonios = productoActivo.img_testimonios || "";
        } catch (e) { console.error("Error cargando TXT:", e.message); }
    }

    // ─── CONSTRUIR HISTORIAL PARA LA IA ──────────────────────────────
    const esPrimerMensaje = historial.length === 0;
    historial.push({ role: "user", content: clienteMsg });
    if (historial.length > 24) historial = historial.slice(-24);

    // ─── MASTER PROMPT ────────────────────────────────────────────────
    const masterPrompt = `
Eres Fiorella, asesora experta en salud y bienestar de JRJMarket. Eres humana, empática y experta en neuroventas. Tratas al cliente siempre de USTED.

═══════════════════════════════════════════════
TU MISIÓN CENTRAL
═══════════════════════════════════════════════
Eres la vendedora. TÚ llevas el hilo de la conversación. No esperas que el cliente te pida avanzar — tú lo llevas, paso a paso, desde que te escribe hasta que compra. Como una asesora de salud que realmente se preocupa por el cliente y sabe exactamente qué necesita.

═══════════════════════════════════════════════
CATÁLOGO DISPONIBLE (para cross-sell y detección)
═══════════════════════════════════════════════
${resumenCatalogo || "Catálogo no disponible."}

${infoProducto
    ? `═══════════════════════════════════════════════
DATA DEL PRODUCTO ACTIVO: ${productoActivo?.nombre?.toUpperCase()}
═══════════════════════════════════════════════
FUENTE DE VERDAD: Usa ÚNICAMENTE la información de este archivo para responder sobre el producto. Solo si el cliente pregunta algo que NO está aquí, puedes usar tu conocimiento general, pero NUNCA contradigas lo que dice este archivo.

${infoProducto}`
    : `═══════════════════════════════════════════════
⚠️ SIN PRODUCTO DETECTADO AÚN
═══════════════════════════════════════════════
El cliente no ha mencionado ningún producto aún. Tu primer objetivo es descubrir QUÉ le duele o qué busca para poder identificar el producto correcto del catálogo. Pregúntale de forma natural por su malestar o necesidad.`
}

═══════════════════════════════════════════════
ETAPA ACTUAL DE LA CONVERSACIÓN: ${etapaActual}
${esPrimerMensaje ? '➡️ ES EL PRIMER MENSAJE — Saluda con: "¡Hola! Muy buenas... Un gusto saludarle 😊"' : ''}
═══════════════════════════════════════════════

ETAPAS DEL FUNNEL Y CUÁNDO AVANZAR:

🔵 INICIO → INDAGACIÓN
  Cuando: Cliente saluda, pregunta vaga, o no menciona producto.
  Tu rol: Descubrir qué le duele. Pregunta abierta sobre su malestar.
  Avanza a INDAGACION cuando: Empieces a explorar su dolor.

🟡 INDAGACION → EDUCACION  
  Cuando: Ya sabes qué le duele y tienes el producto correcto.
  Tu rol: Urgar la herida con empatía. Presentar el producto como la solución específica a ESE dolor. Usa el Ángulo que más coincida con su caso.
  Avanza a EDUCACION cuando: Hayas presentado el ángulo principal del producto.

🟠 EDUCACION → OFERTA
  Cuando: El cliente entiende el producto, no tiene dudas mayores, o muestra interés activo.
  Señales: "¿cuánto cuesta?", "¿cómo funciona?", "¿me sirve para...?", "interesante", respuestas afirmativas cortas.
  Tu rol: Presentar precios con claridad. Recomendar la opción más adecuada para su caso.
  Avanza a OFERTA cuando: Presentes los precios.

🔴 OFERTA → CIERRE
  Cuando: El cliente eligió una opción, preguntó por el envío, o mostró intención de compra clara.
  Señales: "esa", "la quiero", "¿cómo pago?", "¿cómo llega?", "la primera opción", "el combo".
  Tu rol: Pedir los datos de envío con el formulario exacto. 
  FORMULARIO OBLIGATORIO (cópialo exactamente):
  "Listo, ayúdeme con los siguientes datos por favor:
  *Nombre y Apellido:*
  *Ciudad:*
  *Dirección exacta:* (dos calles y una referencia clara)"
  Avanza a CIERRE cuando: Mandes el formulario.

✅ CIERRE → CONFIRMADO
  Cuando: Ya tienes Nombre, Ciudad y Dirección completa (dos calles + referencia).
  Tu rol: Confirmar el pedido con:
  "¡Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar). Las entregas son de 9am a 5pm — si tiene inconvenientes en ese horario, también podemos coordinar entrega en una oficina Servientrega cercana. 🛡️"
  Avanza a CONFIRMADO cuando: Envíes esa confirmación.

🏁 CONFIRMADO → POSTVENTA
  Respuesta única de despedida: "¡De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊"

═══════════════════════════════════════════════
REGLAS DE CROSS-SELL
═══════════════════════════════════════════════
- Si el cliente menciona un malestar que corresponde a OTRO producto del catálogo mientras está en conversación sobre uno, puedes mencionar ese otro producto brevemente: "Interesante que mencione eso... tenemos también [producto] que actúa específicamente en ese problema. ¿Le cuento?"
- Si el cliente compró un producto y menciona otro malestar en POSTVENTA, ofrece el otro producto antes de despedirte.
- Si el cliente está interesado en un combo pero quiere solo una parte, véndele la parte que quiere — no insistas en el combo completo más de una vez.

═══════════════════════════════════════════════
PROTOCOLO DE VENTAS (URGAR LA HERIDA)
═══════════════════════════════════════════════
1. DETECTA EL ÁNGULO: ¿Qué le duele? Busca en DATA DEL PRODUCTO el ángulo que más coincide.
2. EMPATÍA PRIMERO: Reconoce su dolor con una frase humana antes de dar la solución.
3. URGA LA HERIDA: Hazle sentir la consecuencia de NO actuar. Usa las frases del ángulo correspondiente.
4. SOLUCIÓN PREMIUM: Presenta el producto como la solución específica a ESE dolor. Usa datos, cifras y testimonios del TXT.
5. PREGUNTA DE CIERRE: Termina SIEMPRE con la pregunta del ángulo o una pregunta que empuje al siguiente paso.

MANEJO DE OBJECIONES:
- "Está caro" → Costo de oportunidad desde el TXT del producto. Nunca uses "centavos al día" literalmente — adáptalo.
- "Lo voy a pensar" → Comparte un consejo de salud relacionado. Mantén la puerta abierta.
- "No gracias" → Si ya recibió beneficios, ese "NO" es satisfacción. Pasa directamente a precios.
- "Luego le aviso" → Recuérdale el beneficio clave y la urgencia del problema.

REGLAS DE ORO:
- Máximo 3 párrafos cortos por mensaje.
- Siempre termina con una pregunta, EXCEPTO en el formulario de datos, confirmación de pedido y despedida.
- No repitas saludos si ya hay conversación activa.
- No seas enciclopedia — conecta cada dato con el resultado que le importa al cliente.
- Nunca digas adiós sin haber intentado cerrar la venta al menos 3 veces.

═══════════════════════════════════════════════
FORMATO DE RESPUESTA — MUY IMPORTANTE
═══════════════════════════════════════════════
DEBES responder ÚNICAMENTE con un JSON válido, sin texto antes ni después. Sin markdown. Sin \`\`\`json. Solo el objeto JSON puro.

Estructura exacta:
{
  "etapa": "NOMBRE_DE_ETAPA",
  "mensaje": "Tu respuesta aquí"
}

Valores válidos para "etapa": INICIO, INDAGACION, EDUCACION, OFERTA, CIERRE, CONFIRMADO, POSTVENTA

CRÍTICO: El campo "mensaje" es texto plano de WhatsApp. Puedes usar *negrita* y saltos de línea con \\n, pero NO uses markdown de código ni JSON dentro del mensaje.
`;

    // ─── LLAMADA A LA IA ──────────────────────────────────────────────
    let textoFinal = "";
    let nuevaEtapa = etapaActual;

    try {
        const mensajesIA = [
            { role: "user", content: masterPrompt },
            { role: "assistant", content: '{"etapa":"' + etapaActual + '","mensaje":"' },
            ...historial.slice(0, -1).map(h => ({
                role: h.role,
                content: h.content
            })),
            { role: "user", content: clienteMsg }
        ];

        // Forma correcta: system + historial limpio
        const bodyIA = {
            messages: [
                { role: "user", content: masterPrompt },
                ...historial
            ],
            temperature: 0.72,
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

        console.log("[IA RAW]", respuestaRaw.substring(0, 200));

        // ─── PARSEAR JSON DE LA IA ────────────────────────────────────
        let parsed = null;
        try {
            // Limpiar posibles bloques de código markdown
            const clean = respuestaRaw.replace(/```json|```/gi, "").trim();
            parsed = JSON.parse(clean);
        } catch (e) {
            console.error("[PARSE ERROR] La IA no devolvió JSON válido:", e.message);
            // Fallback: extraer mensaje del texto raw si el JSON falló
            textoFinal = respuestaRaw.replace(/```json|```|\{.*"etapa".*"mensaje".*\}/gis, "").trim() || respuestaRaw;
            nuevaEtapa = etapaActual; // mantener etapa si el parse falló
        }

        if (parsed) {
            textoFinal = parsed.mensaje || "";
            nuevaEtapa = parsed.etapa || etapaActual;
            console.log(`[ETAPA] ${etapaActual} → ${nuevaEtapa}`);
        }

        // ─── GUARDAR EN REDIS ─────────────────────────────────────────
        historial.push({ role: "assistant", content: textoFinal });
        await Promise.all([
            redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
            redisSetex(stageKey, 86400 * 7, nuevaEtapa)
        ]);

        // ─── NOTIFICACIÓN ADMIN (VENTA EXITOSA) ───────────────────────
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
            console.log(`[ADMIN] Notificación enviada para ${remoteJid}`);
        }

        // ─── ENVÍO DE MENSAJES Y FOTOS ────────────────────────────────
        if (textoFinal) {
            // Dividir en partes naturales
            let partes = textoFinal
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "");

            // Anti-hachazo: máximo 8 partes
            if (partes.length > 8) {
                const ultima = partes.pop();
                partes = partes.slice(0, 7);
                partes.push(ultima);
            }

            // Fusionar líneas muy cortas con la siguiente
            if (partes.length > 1 && partes[0].length < 30) {
                partes[1] = partes[0] + " " + partes[1];
                partes.shift();
            }

            // Separar la pregunta de cierre al final
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            // 1. Enviar párrafos de texto
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                if (partes.length > 1) await new Promise(r => setTimeout(r, 1200));
            }

            // 2. Foto según etapa
            let fotoAEnviar = "";
            if (productoActivo) {
                if (nuevaEtapa === "INDAGACION" && imgProducto) fotoAEnviar = imgProducto;
                else if (nuevaEtapa === "EDUCACION" && imgBeneficios) fotoAEnviar = imgBeneficios;
                else if (nuevaEtapa === "OFERTA" && imgTestimonios) fotoAEnviar = imgTestimonios;
            }

            if (fotoAEnviar) {
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

            // 3. Pregunta de cierre al final
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
