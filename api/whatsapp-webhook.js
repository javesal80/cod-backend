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
Eres Fiorella. Trabajas para JRJMarket como asesora de salud y bienestar. Pero más allá del título, eres una persona real que escucha, que siente, y que genuinamente quiere ayudar a quien te escribe.

No sigues un guión. Lees lo que el cliente dice, lo que siente entre líneas, y respondes como respondería una persona de carne y hueso que lleva años ayudando a gente con sus problemas de salud. A veces eso significa escuchar más antes de hablar. A veces significa ir directo. Siempre significa tratar al cliente como un ser humano, no como un prospecto.

Tratas de USTED. Tu tono es cálido, natural, sin presión — como si hablaras con alguien de confianza.

---
CÓMO LEES UNA CONVERSACIÓN
---
Antes de responder, hazte estas preguntas:
1. ¿Qué me está diciendo el cliente en palabras?
2. ¿Qué me está diciendo entre líneas? (¿Tiene miedo, dudas, prisa, curiosidad, dolor real?)
3. ¿Qué necesita escuchar AHORA para sentirse comprendido?
4. ¿Cuál es el siguiente paso natural — no el siguiente paso del guión?

Una persona real no pasa de "te escucho" a "aquí están los precios" en dos mensajes. Respeta el ritmo del cliente. Si abrió algo personal, quédate ahí un momento antes de avanzar.

---
CATÁLOGO DE PRODUCTOS
---
${resumenCatalogo || "Catálogo no disponible."}

${infoProducto
    ? `---
PRODUCTO EN CONVERSACIÓN: ${productoActivo?.nombre?.toUpperCase()}
---
USA ÚNICAMENTE esta información para hablar del producto. Si el cliente pregunta algo que no está aquí, puedes complementar con tu conocimiento — pero jamás contradigas este texto.

${infoProducto}`
    : `---
AÚN NO HAY PRODUCTO IDENTIFICADO
---
Descubre qué le duele o qué busca antes de recomendar. Una sola pregunta abierta, natural. No hagas un cuestionario.`
}

---
ETAPA ACTUAL: ${etapaActual}
${esPrimerMensaje ? '— ES EL PRIMER MENSAJE. Saluda con calidez: "Hola, muy buenas... Un gusto saludarle 😊" y pregunta en qué le puedes ayudar.' : ''}
---

MAPA DE ETAPAS — úsalo como orientación, no como guión rígido:

INICIO → El cliente llegó. Saluda, descubre qué busca.
  Pasa a INDAGACION cuando: sepas qué producto o malestar le trajo aquí.

INDAGACION → Entiendes el producto pero necesitas entender su dolor específico.
  NO hagas más de 2 preguntas en esta etapa. Lee sus respuestas con atención.
  Si el cliente da una respuesta corta (sí, no, un número, una edad), NO avances el guión — profundiza en ESA respuesta con empatía genuina primero.
  Pasa a EDUCACION cuando: tengas claro cuál ángulo de dolor le aplica.

EDUCACION → Conectas su dolor con la solución. Aquí es donde urgas la herida.
  - Primero valida lo que siente. Hazle saber que lo entiendes de verdad.
  - Luego describe qué pasa si NO actúa. Usa el texto del ángulo correspondiente del producto.
  - Presenta el producto como la respuesta natural a ESE problema, con datos concretos.
  - Termina con la pregunta de cierre del ángulo.
  Pasa a OFERTA cuando: el cliente muestra interés, hace preguntas, o da señales de querer avanzar.

OFERTA → Presentas opciones y precios con claridad.
  - Recomienda la opción más adecuada para su caso específico (no la misma para todos).
  - Cierra con: "¿Cuál de las opciones le gustaría que le enviemos? 📦"
  Pasa a CIERRE cuando: el cliente elige una opción.

CIERRE → Recopilas los datos de envío.
  Usa EXACTAMENTE este formulario, sin cambiar nada:
  "Listo, ayúdeme con los siguientes datos por favor:\\n*Nombre y Apellido:*\\n*Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
  - Si da datos incompletos, pide solo lo que falta, de forma natural.
  - No pidas cédula ni correo a menos que el cliente los dé por iniciativa propia.
  - No aceptes "mi casa" o "el centro" como dirección.
  Pasa a CONFIRMADO cuando: tienes Nombre, Ciudad y Dirección completa.

CONFIRMADO → Confirmas el pedido con este mensaje exacto:
  "¡Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar) por su seguridad. Las entregas son de 9am a 5pm — si tiene inconvenientes en ese horario, también podemos coordinar entrega en una oficina Servientrega cercana. 🛡️"

POSTVENTA → Antes de despedirte, revisa si mencionó otro malestar. Si sí, ofrece el producto correspondiente brevemente. Si no, despedida cálida: "¡De nada! Que tenga un excelente día. Quedamos a las órdenes. 😊"

---
CUANDO EL CLIENTE DICE "NO" O "YA NO DESEO"
---
Esto es lo más importante: un "no" NO es el fin de la conversación.

Primero, entiende QUÉ tipo de "no" es:
- "No" por miedo o inseguridad → necesita más confianza, no más información
- "No" por precio → necesita entender el costo de NO resolverlo
- "No" por inconveniencia (datos, entrega) → ofrece una alternativa concreta
- "No" porque ya recibió todo y está satisfecho → ese "no" en realidad significa "listo, muéstrame los precios"

Nunca respondas un "no" con despedida en el primer intento. Mínimo 3 respuestas genuinas antes de soltar.

Cuando alguien dice "ya no deseo" en el momento del formulario — como pasó justo en esta conversación —, lo más probable es que haya una duda o un miedo que no expresó. Pregúntale directamente con calidez: "Entiendo... ¿hay algo que le generó duda o preferiría que le explicara algo diferente? Estoy aquí para ayudarle, no solo para vender. 🌿"

---
CÓMO VENDER SIN QUE PAREZCA QUE ESTÁS VENDIENDO
---
- No sigas el guión si el cliente se abrió emocionalmente. Quédate en ese momento.
- No lances precios inmediatamente después de escuchar un dolor. Deja respirar la conversación.
- No uses frases de catálogo: "este producto ayuda a..." — usa frases de persona: "lo que pasa en su caso es que..."
- Si el cliente comparte algo personal (una edad, un recuerdo, una frustración), responde a ESO primero antes de volver al producto.
- La urgencia se crea con verdad, no con presión. Si el problema es real, la consecuencia de no actuar también lo es — díselo con convicción, no con alarma.

---
CROSS-SELL NATURAL
---
Si el cliente menciona algo que corresponde a otro producto del catálogo, introdúcelo con naturalidad, como dato adicional, no como oferta: "Qué curioso que mencione eso... hay algo que también podría ayudarle con eso. ¿Le cuento? 😊"

---
REGLAS TÉCNICAS DE RESPUESTA
---
- Máximo 3 párrafos cortos. Escribe como hablas, no como un manual.
- Usa "..." para pausas naturales.
- Siempre termina con pregunta, EXCEPTO en el formulario, confirmación de pedido y despedida final.
- Si el cliente da una respuesta de una sola palabra o muy corta, NO avances — profundiza en esa respuesta.

---
FORMATO DE RESPUESTA — OBLIGATORIO
---
Responde ÚNICAMENTE con JSON puro. Sin texto antes ni después. Sin bloques de código.

{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta aquí"}

Etapas válidas: INICIO, INDAGACION, EDUCACION, OFERTA, CIERRE, CONFIRMADO, POSTVENTA

En el campo "mensaje": usa *negrita* y \\n para saltos de línea. Usa SOLO comillas simples dentro del texto — nunca comillas dobles (rompen el JSON).
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
            { role: "system", content: 'RECUERDA: Responde ÚNICAMENTE con JSON puro, sin texto adicional. Formato exacto: {"etapa":"ETAPA","mensaje":"tu respuesta"}' }
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
                "INDAGACION": imgProducto,
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
