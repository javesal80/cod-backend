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
    const provider   = (IA_PROVIDER || 'grok').trim().toLowerCase();

    let clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();

    // ─── TRANSCRIPCIÓN DE AUDIO ───────────────────────────────────────
    if (!clienteMsg && data.message?.audioMessage) {
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

    // ─── FECHA ECUADOR ────────────────────────────────────────────────
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

    // ─── ANTI-DUPLICADOS POR msgId ────────────────────────────────────
    try {
        if (await redisGet(`dd:${msgId}`)) return res.status(200).send('OK');
        await redisSetex(`dd:${msgId}`, 60, "1");
    } catch (e) { console.error("Dedup error:", e.message); }

    const cleanJid     = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

    // ─── VERIFICAR PAUSA ──────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 500));
    try { if (await redisGet(`pausa:${cleanJid}`)) return res.status(200).send('OK'); } catch (e) {}

    // ─── CLAVES REDIS ─────────────────────────────────────────────────
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

    // ─── SALUDO INMEDIATO (solo primera vez) ──────────────────────────
    if (historial.length === 0) {
        const saludos = [
            "Hola, muy buenas... Un gusto saludarle 😊",
            "Buenas, bienvenido/a... con gusto le atiendo 😊",
            "Hola, qué gusto saludarle 🌿",
            "Buenas, gracias por escribirnos 😊"
        ];
        const saludo = saludos[Math.floor(Math.random() * saludos.length)];
        console.log("[SALUDO] Enviando a:", remoteJid, "| texto:", saludo);
        const saludoRes = await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: remoteJid, text: saludo })
        });
        const saludoJson = await saludoRes.json();
        console.log("[SALUDO] Status:", saludoRes.status, "| response:", JSON.stringify(saludoJson).substring(0, 200));
        // Pequeña pausa para que el saludo llegue antes que la respuesta principal
        await new Promise(r => setTimeout(r, 1500));
    }

    // ─── CATÁLOGO ─────────────────────────────────────────────────────
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

    // ─── DETECTAR PRODUCTO POR KEYWORDS ──────────────────────────────
    const msgLower = clienteMsg.toLowerCase().trim();
    const productoDetectadoPorKeyword = catalogo.find(p =>
        p.keywords?.some(k => msgLower.includes(k.toLowerCase()))
    );

    const referral = data?.contextInfo?.externalAdReply 
        || data?.contextInfo 
        || data?.message?.referral 
        || null;

    const adIdCapturado = referral ? (referral.sourceId || referral.adId || "").toString().trim() : "";

    if (referral) {
        console.log(`[META ADS CAPTURADO] ID original: ${adIdCapturado}`);
    }

    // Escenario A: No hay producto activo previo en Redis -> Se identifica por primera vez
    if (!productoActivo) {
        if (productoDetectadoPorKeyword) {
            productoActivo = productoDetectadoPorKeyword;
            await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
            if (!fotosEnviadas) fotosEnviadas = {};
            console.log(`[PRIMER CONTACTO] Producto fijado por KEYWORD inicial: ${productoActivo.nombre}`);
        } 
        else if (adIdCapturado) {
            const productoDesdeRef = catalogo.find(p =>
                p.ad_ids && p.ad_ids.some(id => id.toString().trim() === adIdCapturado)
            );
            if (productoDesdeRef) {
                productoActivo = productoDesdeRef;
                await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
                if (!fotosEnviadas) fotosEnviadas = {};
                console.log(`[PRIMER CONTACTO] Producto fijado por ID de ADS inicial: ${productoActivo.nombre}`);
            }
        }
    } 
    // Escenario B: YA HAY UN PRODUCTO ACTIVO -> Se bloquea, SALVO que el cliente cambie de dolor hacia un producto diferente
    else if (productoActivo && productoDetectadoPorKeyword) {
        if (productoDetectadoPorKeyword.nombre !== productoActivo.nombre) {
            console.log(`[CAMBIO DE RUMBO] Transición de producto detectada: ${productoActivo.nombre} -> ${productoDetectadoPorKeyword.nombre}`);
            productoActivo = productoDetectadoPorKeyword;
            fotosEnviadas = {}; 
            await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
            await redisSetex(fotosKey, 86400 * 7, JSON.stringify(fotosEnviadas));
        }
    }
  
    // ─── ALTA INTENCIÓN — solo hint para el prompt, la IA decide la etapa
    const altaIntencion = /quiero (realizar |hacer )?(una )?compra|quiero (pedir|comprarlo|uno|pedirlo)|me lo llevo|d[oó]nde pago|c[oó]mo pago|quiero (el |los )?(\d+ )?(tarros?|unidades?|paquetes?)/i.test(clienteMsg);
    console.log("[ALTA INTENCIÓN]", altaIntencion);

    // ─── CARGAR TXT PRODUCTO ──────────────────────────────────────────
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

    // ─── INFO GENERAL ─────────────────────────────────────────────────
    let infoGeneral = "";
    try {
        const gp = path.join(process.cwd(), 'api', 'info-general.txt');
        if (fs.existsSync(gp)) infoGeneral = fs.readFileSync(gp, 'utf-8');
    } catch (e) {}

    // ─── HISTORIAL ────────────────────────────────────────────────────
    const esPrimerMensaje = historial.length === 0;
    historial.push({ role: "user", content: clienteMsg });
    if (historial.length > 60) historial = historial.slice(-60);

// ─── MASTER PROMPT ────────────────────────────────────────────────
    const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de JRJMarket. No eres un bot — eres una persona que genuinamente quiere ayudar. Tu objetivo no es vender: es entender qué le pasa al cliente y darle la mejor solución a través de un proceso de venta (Funnel) de forma 100% conversacional, fluida y humana. Cuando lo haces bien, la venta llega sola.

Los datos de productos, precios y beneficios vienen exclusivamente de los archivos del catálogo que se te proporcionan. Jamás inventes precios ni beneficios de ningún producto.

Tratas de USTED. Hablas como una amiga que sabe del tema: cálida, directa, sin florituras. No exclamas. No repites. No vendes antes de tiempo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRINCIPIO FUNDAMENTAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
El flujo de la conversación lo marca el cliente, no tú. No lo obligues a seguir un orden de guión rígido; lee su nivel de interés en cada mensaje y muévete por el embudo según él te lo marque.

Hay tres tipos de cliente y cada uno necesita algo diferente:

🔹 CLIENTE DIRECTO — Ya sabe lo que quiere. Va al grano.
   Señales: "¿Es bueno para X?", "¿Cuánto vale?", "Deme uno", "¿Cómo pago?"
   Tu rol: seguirle el ritmo. Responde lo que pregunta, sin agregar pasos que no pidió.
   Si pregunta si es bueno → responde sí o no + una línea de por qué.
   Si pregunta el precio → dalo directo + recomienda cuál opción es mejor para su caso.
   Si dice que lo quiere → ve al cierre sin más.

🔹 CLIENTE QUE EVALÚA — Hace preguntas, compara, necesita entender antes de decidir.
   Señales: "¿Qué ingredientes tiene?", "¿Cuánto tiempo tarda?", "¿Tiene efectos secundarios?"
   Tu rol: responder con claridad y precisión. No vendas — informa. La confianza construye la venta.

🔹 CLIENTE FRÍO — No sabe bien qué quiere o tiene dudas difusas.
   Señales: "Quiero información", "Vi un anuncio", "Me recomendaron"
   Tu rol: indagar su situación real con UNA pregunta abierta. Escuchar. Conectar su dolor con la solución.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORMACIÓN DE LA EMPRESA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${infoGeneral}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CATÁLOGO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${resumenCatalogo || "No disponible."}

${infoProducto ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUCTO ACTIVO: ${productoActivo?.nombre?.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Usa SOLO la información de este archivo. Complementa con conocimiento general si hace falta, pero jamás contradigas este texto.

${infoProducto}` : `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIN PRODUCTO IDENTIFICADO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Descubre qué busca el cliente con UNA pregunta abierta y natural.`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO ACTUAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Etapa anterior: ${etapaActual}
${esPrimerMensaje ? '→ Primer mensaje. El saludo ya fue enviado. NO lo repitas.' : ''}
${altaIntencion ? '→ Señal de compra detectada en este mensaje.' : ''}

IMPORTANTE: La etapa anterior es solo referencia de dónde venías. Tu trabajo ahora es leer el mensaje actual del cliente, entender dónde está ÉL en este momento, y responder desde ahí. Puedes avanzar, quedarte, o retroceder — lo que el cliente necesite.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO DINÁMICO — lees al cliente, no al guión
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
En cada mensaje del cliente hazte esta pregunta: ¿qué necesita esta persona ahora mismo? Luego actúa. Las etapas son nombres para lo que estás haciendo — no pasos obligatorios en orden.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUÉ HACER EN CADA ETAPA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BIENVENIDA — solo primer mensaje
El saludo ya fue enviado. Lee qué tipo de cliente es y ve directo a donde corresponda.

ESCUCHA — cuando el cliente necesita ser entendido o pide información inicial
Lee todo lo que el cliente ha dicho antes de responder. Según lo que ya te dio, decides qué hacer:
— Si el cliente mencionó una keyword indirecta o un síntoma (ej: "crecimiento", "estatura", "rendimiento", "fuerza"): Tienes la OBLIGACIÓN ESTRICTA de validar su interés y presentar de inmediato el nombre del producto activo como la solución ideal para ese problema (ej: "Claro que sí, para todo el desarrollo y crecimiento contamos con NuBest Tall..."). Nunca hables del síntoma en abstracto sin nombrar el producto. Desarrolla brevemente su beneficio principal según su archivo .txt y termina con UNA pregunta de filtro humano.
— Si el cliente ya describió su dolor con detalle: No repitas lo que ya sabe, valida su situación con empatía, conecta directamente con cómo el producto activo soluciona ese síntoma específico y pasa a la etapa de SOLUCIÓN.
— Si NO hay producto identificado (tráfico orgánico frío sin keywords): Haz una sola pregunta abierta, cercana y cálida para descubrir qué malestar busca mejorar en su salud hoy.
— Si mencionó el producto y dio una pista del dolor → no repitas lo que ya sabe, ve directo a profundizar ese dolor con una pregunta que lo haga sentir comprendido.

SOLUCIÓN — cuando ya sabes su situación
Conecta el producto con SU problema específico. Solo los beneficios que aplican a su caso.
Urge el dolor UNA sola vez por conversación, con empatía. No lo repitas después.
Si el cliente directo no necesita esto, omítela o dila en una línea.
Vuelve aquí si el cliente duda después de ver el precio — conecta de nuevo con su situación antes de iniciar.

DECISIÓN — cuando el cliente está evaluando comprar o pregunta explícitamente el costo
⚠️ REGLA DE PRECIOS OBLIGATORIA — NO NEGOCIABLE:
- SOLO si el cliente pregunta directamente el precio, el valor, el costo, o demuestra una altísima intención de compra, tienes la OBLIGACIÓN ABSOLUTA de leer el archivo .txt del producto activo y extraer textualmente los datos. Si el cliente solo saluda o menciona el producto en frío (ej: "Nubest"), queda ESTRICTAMENTE PROHIBIDO entrar en esta etapa o mostrar este formato.
- Cuando muestres los costos, tienes la obligación de listar las 3 opciones de forma CORRIDA, en un solo bloque compacto, una opción debajo de la otra. Está estrictamente prohibido meter preguntas intermedias, emojis sueltos o texto explicativo entre las opciones.
- El formato de los precios debe ser persuasivo e idéntico a este formato (adaptando los marcadores con los nombres, cantidades, precios y ganancias reales del .txt):
📦 *Opción 1:* [Nombre del Plan 1] ([Cantidad 1]) — $[Precio 1] — [Beneficio/Ganancia del Plan 1 extraído del .txt].
📦 *Opción 2:* [Nombre del Plan 2] ([Cantidad 2]) — $[Precio 2] — [Beneficio/Ganancia del Plan 2 extraído del .txt].
📦 *Opción 3:* [Nombre del Plan 3] ([Cantidad 3]) — $[Precio 3] — [Beneficio/Ganancia del Plan 3 extraído del .txt] ✅ RECOMENDADO

Solo DESPUÉS de listar todas de forma corrida, agrega en una línea cuál recomiendas y por qué. Jamás presentes solo la opción recomendada. Jamás omitas una opción. Jamás inventes ni redondees precios.
- Si el cliente se confunde con los precios o hace preguntas capciosas como "¿Cuánto sale en los tres?", aclárale con máxima empatía que son tres alternativas de planes independientes para que elija una, y pregúntale cuál prefiere.

- Si en el historial de la conversación YA listaste los precios de este producto, queda ESTRICTAMENTE PROHIBIDO volver a escribir la lista de precios o repetir el pitch comercial, aunque el cliente vuelva a escribir el nombre del producto (ej: "Nubestall"). 
- Si el cliente repite el nombre del producto o manda un mensaje corto de confirmación después de ver los precios, asume que está procesando la compra: sé empática, valida su mensaje en una sola línea y pregúntale directamente con cuál de las opciones que le diste prefiere iniciar su tratamiento.

Si duda o dice que necesita tiempo → lee el contexto:
  • Si el cliente mostró intención clara pero necesita consultar o esperar ("voy a hablar con el papá", "el lunes le llamo", "necesito el dinero", "déjeme consultar") → NO insistas. Responde con calidez, confirma la opción que mostró interés, dile que se la reservas y que le esperas. Una sola línea de recordatorio suave al final. Ejemplo de tono: "Con gusto le espero, le separo la opción que le interesó para que no pierda la promoción. Cuando esté listo/a, aquí estoy 😊"
  • Si el cliente rechaza sin intención clara ("no me interesa", "no gracias", "está caro") → ahí sí pregunta qué le frena y usa su situación para reconectar UNA vez.
REGLA: No pases a CIERRE hasta que elija explícitamente una opción.

CIERRE — cuando el cliente ya eligió el plan
Confirma en una línea lo que eligió. Pide datos con este formulario exacto, sin cambiar una sola palabra:
"Listo, ayúdeme con los siguientes datos por favor:\\n*Nombre y Apellido:*\\n*Provincia-Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
- REGLA DE RETENCIÓN HUMANA: Presenta la plantilla del formulario vacío UNA SOLA VEZ por conversación. Si el cliente interrumpe el cierre respondiendo por partes (ej: "vivo en Quito", "pago con transferencia"), responde a su duda logística con total naturalidad y pídele el dato que falta conversacionalmente de forma corta. Está prohibido volver a clavarle la plantilla del formulario completa si ya está interactuando contigo. Queda estrictamente prohibido meter testamentos de beneficios o ingredientes en esta etapa.
- Si la dirección no tiene dos calles: "Gracias, ayúdeme también con su dirección exacta con calles y referencia."

CONFIRMADO — cuando tienes los 3 datos completos
En cuanto tengas Nombre + Provincia-Ciudad + dirección completa, envía EXACTAMENTE esto sin agregar nada:
"Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar). Las entregas son de 9am a 5pm — si tiene inconvenientes en ese horario, podemos coordinar entrega en una oficina Servientrega cercana. Su primera compra tiene envío GRATIS. 🛡️"

POSTVENTA — después del CONFIRMADO
Una respuesta cálida y breve. No repitas beneficios. No sigas vendiendo.
Si menciona un problema completamente nuevo, ofrece el producto correspondiente en una línea.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS DE ORO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NUNCA REPITAS — Si ya dijiste una idea, un argumento o una pregunta en el mensaje actual o en el historial, queda ESTRICTAMENTE PROHIBIDO volver a escribirla, ni usando sinónimos o palabras parecidas (ej: no repitas la misma pregunta cambiando 'iniciar' por 'comenzar'). Si ya cerraste con una pregunta, no agregues más texto después de ella.
2. RESPONDE LO QUE TE PREGUNTAN — Si pregunta edad mínima, responde eso. No desvíes al pitch.
3. LEE TODO EL HISTORIAL — Tu respuesta debe conectar con toda la conversación, no solo el último mensaje.
4. BREVEDAD — Máximo 2 párrafos cortos en general. Excepción: en ESCUCHA cuando presentas el producto por primera vez, desarrolla los beneficios con detalle usando el archivo — ingredientes clave, para quién es, qué problema resuelve. No lo cortes en 3 líneas.
5. SIN APERTURAS DE BOT — Nada de "¡Claro!", "¡Perfecto!", "¡Genial!". Natural: "Sí, claro...", "Mire...", o directo al punto.
6. URGENCIA CON LÍMITE — El argumento de consecuencias solo UNA vez por conversación. Si el cliente ya dijo que va a consultar o que vuelve después, NO repitas la urgencia. Despídete con calidez manteniendo el canal abierto. Si después de UN intento de reconexión el cliente dice "ok", "gracias", "ya le digo" — suéltalo. Responde con una línea cálida y cierra. No insistas más.
7. LENGUAJE SIMPLE Y CERCANO — Habla como una amiga, no como un médico ni un catálogo. Nada de términos técnicos o rebuscados. Escribe palabras simples ("sus amigos", "huesos fuertes", "aproveche mejor lo que come"). El cliente debe entender todo al primer vistazo sin pensar.
8. UNA SOLA PREGUNTA EN TODO EL MENSAJE — Todo tu mensaje debe contener ÚNICAMENTE una sola pregunta al final de todo el texto. Está prohibido generar micro-párrafos que lleven preguntas intermedias o duplicadas dentro de la misma respuesta. Escribe la pregunta una sola vez y corta la generación ahí. Si tienes dos, elige la más importante y descarta la otra.
9. PROHIBICIÓN ABSOLUTA DE ALUCINAR E INVENTAR VALORES:
- Queda terminantemente prohibido inventar, aproximar o redondear precios, cantidades o nombres de opciones comerciales basándote en tu conocimiento general. 
- Toda cifra monetaria, cantidad por paquete y ganancia del tratamiento que escribas en tu mensaje debe existir textualmente dentro del archivo del PRODUCTO ACTIVO que tienes en tu contexto, debes enviar todas las opciones que tiene el archivo. Si estás en un flujo orgánico y acabas de identificar el producto, detente y extrae los datos exclusivamente del texto de ese producto. Si el dato no está explícito en el archivo proporcionado, solicita amablemente un segundo al cliente para verificar el sistema, pero jamás lances números falsos creados por ti.
10. TRANSPARENCIA TÉCNICA — Si piden tabla nutricional, registro sanitario o certificaciones: da datos puros sin pitch.
11. CONTROL DE CATÁLOGO Y CAMBIO DE PRODUCTO (CROSS-SELL)  —  Solo si el malestar NO tiene relación con el producto activo, ofrece brevemente el producto del catálogo que corresponda.
- Mantén el foco en el producto activo mientras el cliente hable de los síntomas relacionados a este. Si el cliente solo repite el nombre del producto o hace preguntas de este, no mires el resto del catálogo.
- Tienes total libertad de cambiar la recomendación hacia otro producto del catálogo SI Y SOLO SI el cliente manifiesta un dolor, malestar o síntoma completamente nuevo que no se soluciona ni se cubre con el producto activo actual. 
- Si ocurre este cambio de dolor, realiza la transición de forma médica y empática: explícale por qué el producto anterior ya no aplica para ese síntoma específico y preséntale el nuevo suplemento como la solución correcta a su problema de salud. Al hacer esto, el sistema actualizará el contexto.
12. PROHIBIDO CERRAR LA PUERTA O DESPEDIRSE PREMATURAMENTE: Mientras la venta no esté confirmada, queda estrictamente prohibido despedirse del cliente con frases como "Que tenga un excelente día" cuando solo te está dando un dato o una palabra de cortesía (ej: "A gracias", "Ok"). Mantén el canal abierto de forma vendedora.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO WHATSAPP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Párrafos separados con \\n\\n. Negrita con *asteriscos*. Emojis con criterio para no cansar la vista.
Listas: cada ítem en su línea con emoji al inicio.
Precios: cada opción en su propia línea.
Pregunta final sola al final.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RESPUESTA — OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta aquí"}

Etapas válidas: BIENVENIDA, ESCUCHA, SOLUCIÓN, DECISIÓN, CIERRE, CONFIRMADO, POSTVENTA
Solo comillas simples dentro del mensaje — nunca dobles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS CRÍTICAS DE CONTROL DE FORMATO (JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ESTRUCTURA DINÁMICA DE ENTRADA: Está estrictamente prohibido comenzar tus respuestas con frases repetitivas como "El [Producto] es...", "Claro...", o "Perfecto...". Varía drácticamente las primeras 5 palabras de tu mensaje en cada interacción (ej: "Para potenciar tu rendimiento...", "Esta solución actúa...", "Respecto a lo que me comentas..."). Esto previene bloqueos de seguridad del sistema.

2. OBLIGATORIEDAD DE PREGUNTA EN EL CIERRE: A menos que el cliente ya haya entregado su formulario completo con dirección de entrega y la venta esté cerrada, TODO mensaje que generes debe terminar OBLIGATORIAMENTE con UNA sola pregunta directa, corta y humana utilizando signos de interrogación (¿?). Nunca termines con un enunciado afirmativo o descriptivo.

3. PROTOCOLO DE CONVERSACIÓN SEGÚN EL CONTEXTO (3 ESCENARIOS):
- Escenario A (Por ID de Ads o Keyword Directa): Si el sistema te indica que hay un PRODUCTO ACTIVO (ej: NuBest Tall o Selerb), queda estrictamente prohibido preguntar qué producto busca o usar saludos fríos. Abre la conversación con calidez hablando directamente sobre los beneficios de ese producto específico o indagando sobre el dolor que resuelve (ej: "¡Hola! Qué gusto saludarle. Veo que le interesó nuestro suplemento para el crecimiento y estirón de los niños... Cuéntame, ¿qué edad tiene su hijo para poder asesorarle mejor?").
- Escenario B (Tráfico Orgánico / Sin Producto): Si el sistema indica "SIN PRODUCTO IDENTIFICADO" and el cliente escribe un saludo genérico ("Hola", "Buenas"), responde con máxima calidez humana preguntando en qué le puedes asesorar hoy respecto a su salud para descubrir qué busca o en que producto estaria interesado.
`;
    // ─── LLAMADA IA ───────────────────────────────────────────────────
    let textoFinal = "", nuevaEtapa = etapaActual;

    try {
       const historialParaIA  = historial.slice(0, -1);
        const mensajesFinales  = [
            ...historialParaIA,
            { role: "user", content: clienteMsg },
            { role: "system", content: 'Responde ÚNICAMENTE con JSON puro. Formato: {"etapa":"ETAPA","mensaje":"respuesta"}. CRÍTICO: Lee el mensaje actual del cliente y decide en qué etapa está ÉL ahora — puedes avanzar, quedarte o retroceder. Si quiere comprar → DECISIÓN o CIERRE. Si duda después del precio → SOLUCIÓN o ESCUCHA. PRECIOS: cuando estés en DECISIÓN, es OBLIGATORIO listar TODAS las opciones del producto antes de recomendar una — nunca solo la recomendada. Nunca repitas información ya dada in el historial.' }
        ];
        let respuestaRaw = "";

        if (provider === 'grok') {
            const r = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "grok-4-1-fast-non-reasoning",
                    messages: [{ role: "system", content: masterPrompt }, ...mensajesFinales],
                    temperature: 0.75, max_tokens: 1000
                })
            });
            respuestaRaw = (await r.json()).choices?.[0]?.message?.content || "";
        } else if (provider === 'openai') {
            const r = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "gpt-4o",
                    messages: [{ role: "system", content: masterPrompt }, ...mensajesFinales],
                    temperature: 0.5, max_tokens: 1000
                })
            });
            respuestaRaw = (await r.json()).choices?.[0]?.message?.content || "";
        } else if (provider === 'gemini') {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: masterPrompt + "\n\n" + JSON.stringify(mensajesFinales) }] }] })
            });
            respuestaRaw = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";
        }

        console.log("[IA RAW]", respuestaRaw.substring(0, 400));

        // ─── PARSEAR ──────────────────────────────────────────────────
        let parsed = null;
        try {
            let clean = respuestaRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const m = clean.match(/\{[\s\S]*\}/);
            if (m) clean = m[0];
            parsed = JSON.parse(clean);
        } catch (e) {
            textoFinal = respuestaRaw.trim();
            nuevaEtapa = etapaActual;
        }

        if (parsed) {
            textoFinal = (parsed.mensaje || "")
                .replace(/\\n\\n/g, '\n\n')
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*')
                .replace(/\.\s+([A-ZÁÉÍÓÚÑ¿])/g, '.\n\n$1')
                .replace(/\s+([\u{1F300}-\u{1FAFF}])/gu, '\n\n$1');
            nuevaEtapa = parsed.etapa || etapaActual;
            console.log(`[ETAPA] ${etapaActual} → ${nuevaEtapa}`);
        }

       // ─── GUARDAR REDIS ────────────────────────────────────────────
        historial.push({ role: "assistant", content: textoFinal });
        await Promise.all([
            redisSetex(memoriaKey, 86400 * 7, JSON.stringify(historial)),
            redisSetex(stageKey,   86400 * 7, nuevaEtapa),
            productoActivo ? redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo)) : Promise.resolve()
        ]);

        // ─── SUPABASE ─────────────────────────────────────────────────
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

        // ─── NOTIFICACIÓN VENTA ───────────────────────────────────────
        if (nuevaEtapa === "CONFIRMADO" && etapaActual !== "CONFIRMADO") {
            const resumenVenta = `📦 *NUEVA VENTA FINALIZADA*\n--------------------------------\n📦 *Producto:* ${productoActivo?.nombre || "Ver historial"}\n📱 *WhatsApp:* https://wa.me/${remoteJid.split('@')[0]}\n📝 *Mensajes del cliente:*\n${historial.filter(h => h.role === 'user').map(h => h.content).join(' | ')}\n--------------------------------\n_Fiorella cerró esta venta automáticamente._`;
            await fetch(`${baseUrl}/message/sendText/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                body: JSON.stringify({ number: NUMERO_ADMIN, text: resumenVenta })
            });
        }

        // ─── ENVÍO DE MENSAJES ────────────────────────────────────────
        if (textoFinal) {

           // ANTI-DUPLICADO DE CONTENIDO (CORREGIDO: EVALÚA TEXTO COMPLETO + ETAPA)
            const textoUnico = `${nuevaEtapa}_${textoFinal}`;
            const textoHash = Buffer.from(textoUnico).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 24);
            const hashKey   = `msghash:${cleanJid}:${textoHash}`;
            console.log("[ANTI-DUP CHECK] hash:", textoHash, "| key:", hashKey);
            const antidupExiste = await redisGet(hashKey).catch(() => null);
            console.log("[ANTI-DUP CHECK] existe en Redis:", antidupExiste);
            if (antidupExiste) {
                console.log("[ANTI-DUP] Mismo mensaje detectado con certeza, omitiendo envío.");
                return res.status(200).send('OK');
            }
            await redisSetex(hashKey, 180, "1");
          
            let partes = textoFinal.split('\n\n').map(l => l.trim()).filter(l => l !== "");
            if (partes.length > 8) { const u = partes.pop(); partes = partes.slice(0, 7); partes.push(u); }
            if (partes.length > 1 && partes[0].length < 30) { partes[1] = partes[0] + " " + partes[1]; partes.shift(); }
            
            // CANDADO QUIRÚRGICO: Si el último fragmento es solo un emoji o un texto muy corto, 
            // lo unimos al párrafo anterior para que no se envíe solo.
            if (partes.length > 1 && partes[partes.length - 1].length < 10) {
                const ultimoElemento = partes.pop();
                partes[partes.length - 1] = partes[partes.length - 1] + " " + ultimoElemento;
            }
            
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            const enviar = async (texto) => {
                const delay = Math.min(texto.length * 35, 5000);
                console.log("[ENVIO] Intentando enviar a:", remoteJid, "| texto:", texto.substring(0, 50));
                try {
                    const typingRes = await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, presence: "composing", delay })
                    });
                    console.log("[ENVIO] Typing status:", typingRes.status);
                } catch(te) { console.error("[ENVIO] Typing error:", te.message); }
                await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 1000)));
                try {
                    const sendRes = await fetch(`${baseUrl}/message/sendText/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, text: texto })
                    });
                    const sendJson = await sendRes.json();
                    console.log("[ENVIO] Send status:", sendRes.status, "| response:", JSON.stringify(sendJson).substring(0, 200));
                } catch(se) { console.error("[ENVIO] Send error:", se.message); }
            };

            console.log("[ENVIO] partes:", partes.length, JSON.stringify(partes.map(p => p.substring(0,30))));
            console.log("[ENVIO] preguntaCierre:", preguntaCierre.substring(0, 50));
            console.log("[ENVIO] baseUrl:", baseUrl, "| instName:", instName);

            for (const parte of partes) await enviar(parte);

            // ─── FOTOS ────────────────────────────────────────────────
            const mapaFotos = {
                "BIENVENIDA": imgProducto, "ESCUCHA": imgProducto,
                "SOLUCIÓN":   imgBeneficios, "DECISIÓN": imgTestimonios
            };
            const fotoEtapa    = mapaFotos[nuevaEtapa] || "";
            const fotoYaEnviada = fotosEnviadas[nuevaEtapa] === true;
            const etapaCambio   = nuevaEtapa !== etapaActual;
            const esNuevoProducto = !fotosEnviadas["ESCUCHA"];
            const debeEnviarFoto  = fotoEtapa && (etapaCambio || (nuevaEtapa === "ESCUCHA" && esNuevoProducto)) && !fotoYaEnviada;

            if (debeEnviarFoto) {
                await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
                await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, media: fotoEtapa, mediatype: "image", caption: "" })
                });
                const esInicial = ["BIENVENIDA","ESCUCHA"].includes(nuevaEtapa);
                if (esInicial && productoActivo?.img_tabla) {
                    await new Promise(r => setTimeout(r, 2000));
                    await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                        body: JSON.stringify({ number: remoteJid, media: productoActivo.img_tabla, mediatype: "image", caption: "" })
                    });
                }
                await new Promise(r => setTimeout(r, 1500));
                fotosEnviadas[nuevaEtapa] = true;
                await redisSetex(fotosKey, 86400 * 7, JSON.stringify(fotosEnviadas));
            }

            if (preguntaCierre) await enviar(preguntaCierre);
        }

    } catch (error) { console.error("Error general:", error.message); }

    return res.status(200).send('OK');
};
