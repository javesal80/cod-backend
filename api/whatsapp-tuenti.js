const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

  if (req.method !== 'POST') return res.status(200).send('OK');

 
    const {
        EVOLUTION_URL, EVOLUTION_TOKEN_WHATSAPI, INSTANCE_WHATSAPI,
        GROK_API_KEY, OPENAI_API_KEY, IA_PROVIDER1,
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
    const instName   = req.body.instance || INSTANCE_WHATSAPI || "WHATSAPI";
    const provider   = (IA_PROVIDER1 || 'grok').trim().toLowerCase();

    let clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();

    // ─── TRANSCRIPCIÓN DE AUDIO ───────────────────────────────────────
    if (!clienteMsg && data.message?.audioMessage) {
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
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
            body: JSON.stringify({ number: remoteJid, text: saludo })
        });
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
    const productoDetectado = catalogo.find(p =>
        p.keywords?.some(k => msgLower.includes(k.toLowerCase()))
    );


  // ─── EXTRACCIÓN DE META ADS SEGÚN EL JSON DE EVOLUTION API ───
    const msgObj = data?.message;
    const referral = msgObj?.referral 
        || msgObj?.extendedTextMessage?.contextInfo?.externalAdReply 
        || null;

    // Log para auditar en tu consola la llegada exacta del objeto Meta
    console.log("[META DEBUG] Estructura referral recuperada:", JSON.stringify(referral));

    let metaContextText = "";
    if (referral) {
        // En Evolution API, el ID del anuncio puede venir como 'adId' o como 'sourceId'
        const adId = referral.adId || referral.sourceId || referral.videoUrl || "";
        const adTitle = referral.headline || referral.title || "";
        const adBody = referral.body || referral.description || "";
        
        metaContextText = `${adId} ${adTitle} ${adBody}`.toLowerCase();
        console.log(`[META DEBUG] Datos del Ad -> ID: ${adId} | Texto: ${adTitle}`);
    }
    
    // LOG COMPLETO para diagnóstico — ver qué trae el webhook de Meta
    console.log("[META DEBUG] data.referral:", JSON.stringify(data.referral || null));
    console.log("[META DEBUG] extendedTextMessage:", JSON.stringify(data.message?.extendedTextMessage?.contextInfo?.externalAdReply || null));
    console.log("[META DEBUG] message keys:", Object.keys(data.message || {}));
    console.log("[META DEBUG] data keys:", Object.keys(data || {}));
    console.log("[META DEBUG] referral found:", JSON.stringify(referral || null).substring(0, 500));

    if (!productoDetectado && referral) {
        const refText = JSON.stringify(referral).toLowerCase();
        const productoDesdeRef = catalogo.find(p =>
            p.keywords?.some(k => refText.includes(k.toLowerCase())) ||
            (p.ad_ids && p.ad_ids.some(id => refText.includes(id.toLowerCase())))
        );
        if (productoDesdeRef) {
            if (!productoActivo || productoActivo.nombre !== productoDesdeRef.nombre) fotosEnviadas = {};
            productoActivo = productoDesdeRef;
            await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
            console.log(`[PRODUCTO VIA REFERRAL] ${productoActivo.nombre}`, JSON.stringify(referral).substring(0, 200));
        }
    }

    if (productoDetectado) {
        if (!productoActivo || productoActivo.nombre !== productoDetectado.nombre) fotosEnviadas = {};
        productoActivo = productoDetectado;
        await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
        console.log(`[PRODUCTO] ${productoActivo.nombre}`);
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
    if (historial.length > 24) historial = historial.slice(-24);

    // ─── MASTER PROMPT ────────────────────────────────────────────────
    const masterPrompt = `
Eres Fiorella, asesora de salud y bienestar de JRJMarket. No eres un bot — eres una persona que genuinamente quiere ayudar. Tu objetivo no es vender: es entender qué le pasa al cliente y darle la mejor solución. Cuando lo haces bien, la venta llega sola.

Los datos de productos, precios y beneficios vienen exclusivamente de los archivos del catálogo que se te proporcionan. Jamás inventes precios ni beneficios de ningún producto.

Tratas de USTED. Hablas como una amiga que sabe del tema: cálida, directa, sin florituras. No exclamas. No repites. No vendes antes de tiempo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRINCIPIO FUNDAMENTAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
El flujo de la conversación lo marca el cliente, no tú.

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
Si el cliente ingresa sin un producto activo asignado en el sistema, JAMÁS digas que hay un error en el sistema o que no se pudo cargar el anuncio. Tu rol es mapear las necesidades del cliente de forma fluida. 
Dispara inmediatamente un menú de opciones amable pero directo usando los datos consolidados en tu catálogo:
"¡Hola! Qué gusto saludarle 🌿 Bienvenido/a. 
Para brindarle la información correcta, cuénteme por favor: 
¿Qué beneficio o solución se encuentra buscando mejorar? 👇
1️⃣ [Insertar Beneficio Principal Producto A]
2️⃣ [Insertar Beneficio Principal Producto B]
3️⃣ [Insertar Beneficio Principal Producto C]

(Por favor indíqueme el número o el malestar que le gustaría tratar para guiarle correctamente)." `}

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

En cada mensaje del cliente hazte esta pregunta: ¿qué necesita esta persona ahora mismo?
Luego actúa. Las etapas son nombres para lo que estás haciendo — no pasos obligatorios en orden.

Ejemplos de flujo real:
— Cliente dice "información" → ESCUCHA (pregunta qué busca)
— Luego dice "¿cuánto vale?" → DECISIÓN directa (da el precio sin pasar por SOLUCIÓN)
— Luego dice "no sé, déjeme pensar" → regresa a SOLUCIÓN (conecta con su situación) o ESCUCHA (pregunta qué le genera duda)
— Luego dice "bueno, deme uno" → CIERRE
— Luego dice "espere, ¿y para niños funciona?" → puedes ir a SOLUCIÓN a responder eso antes de seguir al cierre
— Luego da sus datos → CONFIRMADO

El flujo puede ser: ESCUCHA → DECISIÓN → ESCUCHA → SOLUCIÓN → DECISIÓN → CIERRE
O puede ser: BIENVENIDA → DECISIÓN → CIERRE
O puede ser: ESCUCHA → SOLUCIÓN → DECISIÓN → SOLUCIÓN → DECISIÓN → CIERRE
Lo que el cliente marque.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUÉ HACER EN CADA ETAPA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Para cada etapa usa los datos técnicos del archivo del producto activo para estructurar una respuesta basada en:
1. Validación y Empatía: Valida su dolor o su preocupación
2. Autoridad y Seguridad (Vital para Suplementos en Ecuador): Menciona inmediatamente que el producto es el original importado de EE.UU., o con registro ARCSA dependiendo del producto, formulado bajo altos estándares internacionales y recalca de manera sobria si cuenta con certificaciones o aprobaciones oficiales de origen. Explica el beneficio de forma simple (regla 7: lenguaje cercano, traduce la ciencia a beneficios palpables como "huesos fuertes", "limpieza profunda").
3. Termina siempre con una transición suave hacia sus opciones sin presionar la compra inmediata.


BIENVENIDA — solo primer mensaje
El saludo ya fue enviado. Lee qué tipo de cliente es y ve directo a donde corresponda.

ESCUCHA — cuando el cliente necesita ser entendido
Lee todo lo que el cliente ha dicho antes de responder. Según lo que te mencione o diga, decides qué hacer:
— Si solo mencionó el producto sin contexto → presenta los beneficios principales del archivo con detalle y termina con UNA pregunta que indague el dolor relacionado al ángulo principal del producto.
— Si mencionó el producto y dio una pista del dolor → no repitas lo que ya sabe, ve directo a profundizar ese dolor con una pregunta que lo haga sentir comprendido.
— Si ya te describió el dolor con detalle → no preguntes más, pasa a SOLUCIÓN.
La pregunta siempre nace de lo que el cliente dice — nunca es genérica, nunca es sobre el producto, siempre conecta con su situación específica.

SOLUCIÓN — cuando ya sabes su situación o dolor
Conecta el producto con SU problema específico. Solo los beneficios que aplican a su caso.
Urge el dolor m+aximo DOS vez por conversación, con empatía. No lo repitas después.
Si el cliente es directo no necesita esto, omítelo o dilo concreto en un sólo mensaje.
Vuelve aquí si el cliente duda después de ver el precio — conecta de nuevo con su situación antes de insistir.


⚠️ REGLA DE PRECIOS OBLIGATORIA — NO NEGOCIABLE:
Antes de recomendar cualquier opción, DEBES listar TODAS las opciones del producto con sus precios exactos del archivo, en este formato:
"📦 *Opción 1:* X unidad — $XX.XX
📦 *Opción 2:* X unidades — $XX.XX
📦 *Opción 3:* X unidades — $XX.XX"
Solo DESPUÉS de listar todas, agrega en una línea cuál recomiendas y por qué.
Jamás presentes solo la opción recomendada. Jamás omitas una opción. Jamás inventes ni redondees precios. Los precios son exactamente los que están en el archivo del producto — ni un centavo diferente.
Después de las opciones, ancla el valor en una línea conectando con la situación del cliente.
Si duda o dice que necesita tiempo → lee el contexto:
  • Si el cliente mostró intención clara pero necesita consultar o esperar ("voy a hablar con el papá", "el lunes le llamo", "necesito el dinero", "déjeme consultar") → NO insistas. Responde con calidez, confirma la opción que mostró interés, dile que se la reservas y que le esperas. Una sola línea de recordatorio suave al final. Ejemplo de tono: "Con gusto le espero, le separo la opción que le interesó para que no pierda la promoción. Cuando esté listo/a, aquí estoy 😊"
  • Si el cliente rechaza sin intención clara ("no me interesa", "no gracias", "está caro") → ahí sí pregunta qué le frena y usa su situación para reconectar UNA vez.
REGLA: No pases a CIERRE hasta que elija explícitamente una opción.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISIÓN — Cuando el cliente evalúa comprar, elige una opción o entra directo pidiendo precio
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identifica inmediatamente el origen del mensaje actual para ejecutar uno de los siguientes dos comportamientos dinámicos. Jamás inventes ni hardcodees nombres de productos o dolores; extrae todo de las variables del catálogo y del archivo .txt activo.
No uses términos médicos o agresivos como "tratamiento". Reemplázalo siempre por palabras enfocadas en metas posibles del cliente que puede ofrecer el producto

EVALÚA EL ORIGEN DEL CLIENTE Y ACTÚA:

A) SI EL CLIENTE VIENE DEL FLUJO NORMAL (Ya recibió información previa, se le diagnosticó y aceptó ver las opciones):
1. El Sándwich de Precios: ⚠️ REGLA DE PRECIOS OBLIGATORIA — NO NEGOCIABLE:
Antes de recomendar cualquier opción, DEBES listar TODAS las opciones del producto con sus precios exactos del archivo, en este formato:
"📦 *Opción 1:* X unidad — $XX.XX
📦 *Opción 2:* X unidades — $XX.XX
📦 *Opción 3:* X unidades — $XX.XX"
Solo DESPUÉS de listar todas, agrega en una línea cuál recomiendas y por qué.
Jamás presentes solo la opción recomendada. Jamás omitas una opción. Jamás inventes ni redondees precios. Los precios son exactamente los que están en el archivo del producto — ni un centavo diferente.
Después de las opciones, ancla el valor en una línea conectando con la situación del cliente.
Si duda o dice que necesita tiempo → lee el contexto:
  • Si el cliente mostró intención clara pero necesita consultar o esperar ("voy a hablar con el papá", "el lunes le llamo", "necesito el dinero", "déjeme consultar") → NO insistas. Responde con calidez, confirma la opción que mostró interés, dile que se la reservas y que le esperas. Una sola línea de recordatorio suave al final. Ejemplo de tono: "Con gusto le espero, le separo la opción que le interesó para que no pierda la promoción. Cuando esté listo/a, aquí estoy 😊"
  • Si el cliente rechaza sin intención clara ("no me interesa", "no gracias", "está caro") → ahí sí pregunta qué le frena y usa su situación para reconectar UNA vez.
2. Validación de Elección: Felicítalo brevemente por dar el paso. 
   Formato: "Excelente elección. El producto es la alternativa ideal para ayudarle directamente con [Dolor o problema específico que mencionó en el historial/txt]."
3. Pregunta de Control (Sin presionar la entrega aún): No asumas el despacho todavía. Cierra el mensaje preguntando con autoridad cuál alternativa prefiere para iniciar su proceso:
   "Tomando en cuenta que el envío es completamente GRATIS por primera compra a todo el Ecuador, ¿con cuál de estas opciones le gustaría empezar a benficiarse y notar los cambios?"
REGLA CRÍTICA: No pases a la etapa de CIERRE hasta que el cliente confirme explícitamente la opción.

B) SI EL CLIENTE INGRESÓ DIRECTO PREGUNTANDO "PRECIO" O "QUIERO COMPRAR" (Primeros mensajes del chat):
Aplica estrictamente el "Sándwich de Precio con Escudo de Autoridad" en este orden exacto:
1. Conexión con el Dolor: Valida su interés confirmando de forma empática que el producto activo es excelente para tratar el [Ángulo Principal / Dolor del archivo .txt] y que ha demostrado excelentes resultados en Ecuador.
2. Escudo de Autoridad y Seguridad: Explique de manera contundente y sobria que el producto es 100% original, importado deserel caso y menciona el estado de sus certificaciones o aprobaciones oficiales descritas en su archivo técnico. Esto es vital para darle total tranquilidad antes de hablar de dinero.
3. El Sándwich de Precios: ⚠️ REGLA DE PRECIOS OBLIGATORIA — NO NEGOCIABLE:
Antes de recomendar cualquier opción, DEBES listar TODAS las opciones del producto con sus precios exactos del archivo, en este formato:
"📦 *Opción 1:* X unidad — $XX.XX
📦 *Opción 2:* X unidades — $XX.XX
📦 *Opción 3:* X unidades — $XX.XX"
Solo DESPUÉS de listar todas, agrega en una línea cuál recomiendas y por qué.
Jamás presentes solo la opción recomendada. Jamás omitas una opción. Jamás inventes ni redondees precios. Los precios son exactamente los que están en el archivo del producto — ni un centavo diferente.
Después de las opciones, ancla el valor en una línea conectando con la situación del cliente.
Si duda o dice que necesita tiempo → lee el contexto:
  • Si el cliente mostró intención clara pero necesita consultar o esperar ("voy a hablar con el papá", "el lunes le llamo", "necesito el dinero", "déjeme consultar") → NO insistas. Responde con calidez, confirma la opción que mostró interés, dile que se la reservas y que le esperas. Una sola línea de recordatorio suave al final. Ejemplo de tono: "Con gusto le espero, le separo la opción que le interesó para que no pierda la promoción. Cuando esté listo/a, aquí estoy 😊"
  • Si el cliente rechaza sin intención clara ("no me interesa", "no gracias", "está caro") → ahí sí pregunta qué le frena y usa su situación para reconectar UNA vez.
4. Pregunta de Control (Sin presionar la entrega aún): No asumas el despacho todavía. Cierra el mensaje preguntando con autoridad cuál alternativa prefiere para iniciar su proceso:
   "Tomando en cuenta que el envío es completamente GRATIS por primera compra a todo el Ecuador, ¿con cuál de estas opciones le gustaría empezar a benficiarse y notar los cambios?"
REGLA CRÍTICA: No pases a la etapa de CIERRE hasta que el cliente confirme explícitamente la opción.

CIERRE — cuando el cliente ya eligió
⚠️ REGLA DE TRANSICIÓN CRÍTICA PARA PASAR A LA ETAPA DE CIERRE:
NO debes disparar el formulario de datos de forma seca y abrupta. 

Antes de listar el formulario de datos, debes escribir un párrafo puente de calidez y justificación logística:
"Confirma en una línea lo que eligió.
¡Excelente! Qué gran paso para empezar a ver los resultados que busca. 
"Recuerde su elección incluye Envío completamente GRATIS. Por su absoluta seguridad y confianza, manejamos la modalidad de Pago Contra Entrega: usted le cancela en efectivo al repartidor de la transportadora únicamente cuando reciba el producto físico y sellado en sus manos.
   
Pide datos con este formulario exacto, sin cambiar una sola palabra:
"Para ayudarle a asegurar su producto y coordinar el despacho, ayúdeme por favor con los siguientes datos por favor:\\n*Nombre y Apellido:*\\n*Provincia-Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"
No pidas cédula ni correo. Si faltan datos, pide solo lo que falta.
Si la dirección no tiene dos calles: "Gracias, ayúdeme también con su dirección exacta con calles y referencia."
Si en medio del CIERRE el cliente hace una pregunta nueva → respóndela y vuelve a pedir los datos.

CONFIRMADO — cuando tienes los 3 datos completos
En cuanto tengas Nombre + Provincia-Ciudad + dirección completa, envía EXACTAMENTE esto sin agregar nada:
"Datos registrados con éxito! Su pedido llegará entre ${mañana} o ${pasado}. Se enviará por transportadoras conocidas (Servientrega, Gintracom, Veloces, Urbano o Laar). Las entregas son de 9am a 5pm — si tiene inconvenientes en ese horario, podemos coordinar entrega en una oficina Servientrega cercana. Su primera compra tiene envío GRATIS. 🛡️"

POSTVENTA — después del CONFIRMADO
Una respuesta cálida y breve. No repitas beneficios. No sigas vendiendo.
Si menciona un problema completamente nuevo, ofrece el producto correspondiente en una línea.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS DE ORO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NUNCA REPITAS — Si ya lo dijiste, no lo digas de nuevo. Ni resumido, ni con otras palabras.
2. RESPONDE LO QUE TE PREGUNTAN — Si pregunta edad mínima, responde eso. No desvíes al pitch.
3. LEE TODO EL HISTORIAL — Tu respuesta debe conectar con toda la conversación, no solo el último mensaje.
4. BREVEDAD — Máximo 2 párrafos cortos en general. Excepción: en ESCUCHA cuando presentas el producto por primera vez, desarrolla los beneficios con detalle usando el archivo — ingredientes clave, para quién es, qué problema resuelve. No lo cortes en 3 líneas.
5. SIN APERTURAS DE BOT — Nada de "¡Claro!", "¡Perfecto!", "¡Genial!". Natural: "Sí, claro...", "Mire...", o directo al punto.
6. URGENCIA CON LÍMITE — El argumento de consecuencias solo UNA vez por conversación. Si el cliente ya dijo que va a consultar o que vuelve después, NO repitas la urgencia — ya mostró interés. Despídete con calidez y deja la puerta abierta. Si después de UN intento de reconexión el cliente dice "ok", "gracias", "ya le digo" — suéltalo. Responde con una línea cálida y cierra. No insistas más.
7. LENGUAJE SIMPLE Y CERCANO — Habla como una amiga, no como un médico ni un catálogo. Nada de términos técnicos o rebuscados. Si existe una palabra más simple, úsala. "Sus pares" → "sus amigos o compañeros". "Mineralización ósea" → "sus huesos crezcan más fuertes". "Comensales selectivos" → "niños que no les gusta comer de todo". "Absorción de nutrientes" → "que el cuerpo aproveche mejor lo que come". El cliente debe entender todo al primer vistazo sin pensar.
8. UNA SOLA PREGUNTA — Nunca dos preguntas en el mismo mensaje. Si tienes dos, elige la más importante y descarta la otra.
9. ANTI-ALUCINACIÓN DE PRECIOS — Los precios vienen ÚNICAMENTE del archivo del producto. Jamás los inventes, redondees ni omitas opciones. Si el archivo tiene 3 opciones, presentas las 3.
10. TRANSPARENCIA TÉCNICA — Si piden tabla nutricional, registro sanitario o certificaciones: da datos puros sin pitch.
11. CROSS-SELL — Si el cliente menciona un malestar o problema, primero verifica si el producto activo lo cubre. Si sí lo cubre, conéctalo con ese producto. Solo si el malestar NO tiene relación con el producto activo, ofrece brevemente el producto del catálogo que corresponda. Nunca mezcles beneficios de dos productos en el mismo mensaje.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO WHATSAPP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Párrafos separados con \\n\\n. Negrita con *asteriscos*. Emojis con criterio.
Listas: cada ítem en su línea con emoji al inicio.
Precios: cada opción en su propia línea.
Pregunta final sola al final.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RESPUESTA — OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta aquí"}

Etapas válidas: BIENVENIDA, ESCUCHA, SOLUCIÓN, DECISIÓN, CIERRE, CONFIRMADO, POSTVENTA
Solo comillas simples dentro del mensaje — nunca dobles.
`;

    // ─── LLAMADA IA ───────────────────────────────────────────────────
    let textoFinal = "", nuevaEtapa = etapaActual;

    try {
        const historialParaIA  = historial.slice(0, -1);
        const mensajesFinales  = [
            ...historialParaIA,
            { role: "user", content: clienteMsg },
            { role: "system", content: 'Responde ÚNICAMENTE con JSON puro. Formato: {"etapa":"ETAPA","mensaje":"respuesta"}. CRÍTICO: Lee el mensaje actual del cliente y decide en qué etapa está ÉL ahora — puedes avanzar, quedarte o retroceder. Si quiere comprar → DECISIÓN o CIERRE. Si duda después del precio → SOLUCIÓN o ESCUCHA. PRECIOS: cuando estés en DECISIÓN, es OBLIGATORIO listar TODAS las opciones del producto antes de recomendar una — nunca solo la recomendada. Nunca repitas información ya dada en el historial.' }
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
            redisSetex(stageKey,   86400 * 7, nuevaEtapa)
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
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                body: JSON.stringify({ number: NUMERO_ADMIN, text: resumenVenta })
            });
        }

        // ─── ENVÍO DE MENSAJES ────────────────────────────────────────
        if (textoFinal) {

            // ANTI-DUPLICADO DE CONTENIDO
            const textoHash = Buffer.from(textoFinal.substring(0, 100)).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
            const hashKey   = `msghash:${cleanJid}:${textoHash}`;
            if (await redisGet(hashKey).catch(() => null)) {
                console.log("[ANTI-DUP] Mismo mensaje, omitiendo");
                return res.status(200).send('OK');
            }
            await redisSetex(hashKey, 300, "1");

            let partes = textoFinal.split('\n\n').map(l => l.trim()).filter(l => l !== "");
            if (partes.length > 8) { const u = partes.pop(); partes = partes.slice(0, 7); partes.push(u); }
            if (partes.length > 1 && partes[0].length < 30) { partes[1] = partes[0] + " " + partes[1]; partes.shift(); }
            const preguntaCierre = partes.length > 1 ? partes.pop() : "";

            const enviar = async (texto) => {
                const delay = Math.min(texto.length * 35, 5000);
                await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, presence: "composing", delay })
                });
                await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 1000)));
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, text: texto })
                });
            };

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
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                    body: JSON.stringify({ number: remoteJid, media: fotoEtapa, mediatype: "image", caption: "" })
                });
                const esInicial = ["BIENVENIDA","ESCUCHA"].includes(nuevaEtapa);
                if (esInicial && productoActivo?.img_tabla) {
                    await new Promise(r => setTimeout(r, 2000));
                    await fetch(`${baseUrl}/message/sendMedia/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
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
