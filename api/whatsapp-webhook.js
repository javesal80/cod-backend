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
    const instName   = req.body.instance || INSTANCE_WHATSAPI || "VitaeLAB";
    const provider   = (IA_PROVIDER || 'grok').trim().toLowerCase();

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

      const tsActual = Date.now().toString();
      const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');


    // ─── LOCK ATÓMICO ANTI-PARALELO ───────────────────────────────────
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
            console.log("[LOCK] Webhook paralelo bloqueado para:", cleanJid);
            return res.status(200).send('OK');
        }
    } catch(e) { console.error("[LOCK ERROR]", e.message); }

      await redisSetex(`lastmsg:${cleanJid}`, 300, tsActual).catch(() => {});
    // ─── VERIFICAR PAUSA ──────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 500));
   try { if (await redisGet(`pausa:${cleanJid}`)) {
        await fetch(`${KV_REST_API_URL}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(["DEL", lockKey]) }).catch(() => {});
        return res.status(200).send('OK');
    }} catch (e) {}

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
            "Buenas, en un momento le ayudo por favor 😊"
        ];
        const saludo = saludos[Math.floor(Math.random() * saludos.length)];
        console.log("[SALUDO] Enviando a:", remoteJid, "| texto:", saludo);
        const saludoRes = await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
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

// ─── EXTRAER AD ID DE META ADS ────────────────────────────────────
    const referral = data?.contextInfo?.externalAdReply 
        || data?.contextInfo 
        || data?.message?.referral 
        || null;

    const adIdCapturado = referral ? (referral.sourceId || referral.adId || "").toString().trim() : "";

    console.log(`[META DEBUG] contextInfo completo:`, JSON.stringify(data?.contextInfo || {}).substring(0, 500));
    console.log(`[META DEBUG] message.referral completo:`, JSON.stringify(data?.message?.referral || {}).substring(0, 500));
    if (referral) {
        console.log(`[META ADS CAPTURADO] ID original: "${adIdCapturado}" | referral usado:`, JSON.stringify(referral).substring(0, 300));
    } else {
        console.log(`[META ADS] No se encontró ningún referral en este mensaje`);
    }

    // ─── ANALIZAR KEYWORD DEL TEXTO ───────────────────────────────────
    const msgLower = clienteMsg.toLowerCase().trim();
    const productoDetectadoPorKeyword = catalogo.find(p =>
        p.keywords?.some(k => msgLower.includes(k.toLowerCase()))
    );

    // ─── ASIGNACIÓN DE PRODUCTO POR PRIORIDAD ABSOLUTA ──────────────────
    
    // Escenario A: No hay producto activo previo en Redis -> Se identifica por primera vez
    if (!productoActivo) {
        // 1. PRIORIDAD 1: Identificación técnica por ID de Meta Ads
        if (adIdCapturado) {
            const productoDesdeRef = catalogo.find(p =>
                p.ad_ids && p.ad_ids.some(id => id.toString().trim() === adIdCapturado)
            );
            if (productoDesdeRef) {
                productoActivo = productoDesdeRef;
                await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
                if (!fotosEnviadas) fotosEnviadas = {};
                console.log(`[PRIMER CONTACTO] Producto fijado por ID de ADS (Prioridad 1): ${productoActivo.nombre}`);
            }
        }
        
       // 2. PRIORIDAD 2: Si no hubo match por Ads, buscamos por Keyword en el texto
        if (!productoActivo && productoDetectadoPorKeyword) {
            productoActivo = productoDetectadoPorKeyword;
            await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
            if (!fotosEnviadas) fotosEnviadas = {};
            console.log(`[PRIMER CONTACTO] Producto fijado por KEYWORD (Plan de Respaldo): ${productoActivo.nombre}`);
        }

        // 3. PRIORIDAD 3: Si aún no hay producto, esperar 800ms y releer Redis
        // por si un webhook paralelo (el del referral) ya lo guardó
        if (!productoActivo) {
            await new Promise(r => setTimeout(r, 800));
            try {
                const recheck = await redisGet(productoKey);
                if (recheck) {
                    productoActivo = JSON.parse(recheck);
                    console.log(`[RECHECK] Producto recuperado del webhook paralelo: ${productoActivo.nombre}`);
                }
            } catch(e) {}
        }
    } 
  // Escenario B: YA HAY UN PRODUCTO ACTIVO -> se mantiene fijo.
    // El cambio de producto SOLO lo decide la IA (ver campo "cambiarA" en su respuesta JSON),
    // nunca el código por coincidencia de keyword en el mensaje del cliente.
  
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
CONTROL DE FLUJO GLOBAL: HILO DE CONVERSACIÓN Y FLEXIBILIDAD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ REGLA DE ORO INQUEBRANTABLE (EL CLIENTE MANDA EL RUMBO):
- Está TERMINANTEMENTE PROHIBIDO avanzar de etapa o enviar listas de precios si el cliente tiene una pregunta activa, duda, objeción o pide una aclaración (Ej: "Cómo ayuda", "De qué es", "Tienen testimonios", "Por qué", etc.).
- La prioridad absoluta número uno es responder a la última línea del cliente de forma natural, humana y empática, usando los datos de tu archivo técnico.

🤖 PROTOCOLO DE INTERRUPCIÓN (MECÁNICA DE AVANCE/RETORNO):
1) Si el cliente hace una pregunta sobre el funcionamiento o hace una objeción:
   - Detén inmediatamente cualquier intento de mandar precios o promociones.
   - Responde la pregunta en máximo 3 líneas con lenguaje humano y persuasivo basado en el .txt.
   - Al final de tu respuesta, vuelve a enganchar con la etapa en la que estabas usando una pregunta de control. No mandes el bloque de precios hasta que el cliente te dé el permiso explícito.
   - Ejemplo de comportamiento si pregunta "¿Cómo ayuda?": "Comprendo perfectamente su duda. El producto actúa directamente [explicación abstracta corta del .txt]. ¿Tiene sentido para usted? Si gusta, le puedo mostrar las opciones que tenemos disponibles."

2) Si el cliente te interrumpe mientras estás listando precios o en otra etapa:
   - En tu siguiente mensaje, limpia el desorden. No repitas la lista de precios. Pide disculpas de forma humana por el malentendido, responde a su duda específica y quédate a la espera de su confirmación para continuar.

3) Sincronización con el Historial (BD Interna):
   - Lee activamente los últimos 4 mensajes del chat. Si notas que el cliente rechazó los precios, tiene dudas o cambió de tema, adáptate de inmediato. No seas un monólogo automatizado. El proceso de venta solo avanza si el cliente responde afirmativamente a tus ganchos de permiso.

⚠️ REGLA DE INTERRUPCIÓN ABSOLUTA — EL ÚLTIMO MENSAJE DEL CLIENTE ES LEY:
El último mensaje del cliente es siempre tu única prioridad. No importa en qué etapa estás, no importa qué ibas a decir, no importa qué enviaste antes. Si el cliente pregunta algo nuevo, cambia de tema, pide una aclaración o expresa una duda — eso es lo único que existe en este momento.
- Si estás en DECISIÓN y el cliente pregunta cómo recibe el producto → responde eso primero, con valor y calidez, y luego regrésalo a las opciones con una pregunta.
- Si estás en DECISIÓN y el cliente pregunta algo de indagación → regresa a ESCUCHA, responde su duda, y cuando esté satisfecho llévalo de vuelta a DECISIÓN.
- Si estás en CIERRE y el cliente pregunta algo → responde su pregunta, no repitas el formulario.
- NUNCA continues el guión si el último mensaje del cliente no es una respuesta directa a lo que tú preguntaste. Leer el historial no es opcional — es obligatorio antes de generar cualquier respuesta.

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
Descubre qué busca el cliente con UNA pregunta abierta y natural.
Si las variables de producto, precio o archivo vienen vacías, o si el cliente llegó por un anuncio que el sistema no pudo registrar en negro, queda ESTRICTAMENTE PROHIBIDO listar productos aleatorios del catálogo general, inventar opciones de compra o poner códigos rotos como $[Precio]. 
Si el cliente ingresa sin un producto activo asignado en el sistema, JAMÁS digas que hay un error en el sistema o que no se pudo cargar el anuncio. Tu rol es mapear las necesidades del cliente de forma fluida. 
Dispara inmediatamente un menú de opciones amable pero directo usando los datos consolidados en tu catálogo:
"Para brindarle la información correcta, cuénteme por favor: 
¿Qué beneficio o solución se encuentra buscando mejorar? 👇
1️⃣ [Insertar Beneficio Principal Producto A]
2️⃣ [Insertar Beneficio Principal Producto B]
3️⃣ [Insertar Beneficio Principal Producto C]

(Por favor indíqueme el número o el malestar que le gustaría tratar para guiarle correctamente)."`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO ACTUAL Y REGLAS DE CONTROL DE FLUJO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Etapa anterior: \${etapaActual}
\${esPrimerMensaje ? '→ Primer mensaje. El saludo ya fue enviado. NO lo repitas.' : ''}
\${altaIntencion ? '→ Señal de compra detectada en este mensaje.' : ''}

⚠️ REGLA DE ORO DE SECUENCIALIDAD (NUNCA ASUMIR):
- Está ESTRICTAMENTE PROHIBIDO saltarse etapas o cambiar de fase basándote en suposiciones. Tu avance por el embudo debe ser estrictamente progresivo (BIENVENIDA → ESCUCHA → SOLUCIÓN → DECISIÓN → CIERRE → CONFIRMADO).
- Solo tienes permitido cambiar de etapa si el hilo de la conversación y la respuesta explícitamente escrita del cliente lo justifican directamente. Si el cliente no ha interactuado o no ha respondido a tu pregunta anterior, quédate firmemente en la etapa actual.
- Si es el primer mensaje de la conversación (BIENVENIDA), tu ÚNICA opción es pasar a la etapa ESCUCHA para presentarte, dar la información inicial corta del producto activo y hacer exactamente la PREGUNTA FILTRO INICIAL definida en el archivo del producto activo. Está prohibido inventar una pregunta filtro distinta a la del archivo, y está prohibido saltar a SOLUCIÓN o DECISIÓN en el primer turno.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO DINÁMICO — lees al cliente, no al guión
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
En cada mensaje del cliente hazte esta pregunta: ¿qué necesita esta persona ahora mismo? Luego actúa. Las etapas son nombres para lo que estás haciendo — no pasos obligatorios en orden si el cliente marca otra dirección.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUÉ HACER EN CADA ETAPA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BIENVENIDA — Solo primer mensaje. El saludo ya fue enviado. Pasa inmediatamente a ESCUCHA.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESCUCHA / SOLUCIÓN — Conexión emocional e indagación profunda.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ REGLAS PSICOLÓGICAS DE CONVERSIÓN Y TRANSICIÓN A PRECIOS (PROMPT MAESTRO):
1) PROHIBIDO REPETIR CARACTERÍSTICAS: No aburras al cliente repitiendo ingredientes, fichas técnicas o generalidades que ya se mencionaron en el saludo inicial. Sé un asesor humano enfocado en resolver problemas.
2) PROFUNDIZAR EN EL DOLOR (URGAR LA HERIDA): Cuando el cliente te proporcione un dato inicial corto o responda a tu primera pregunta de descarte, no saltes de inmediato a vender. Primero valida de forma empática y haz una pregunta de alto impacto psicológico para descubrir la raíz de su problema o su motivación real de compra.
3) CONTROL DE REPETICIÓN DE IMÁGENES (MECÁNICA JS): Para evitar que el servidor inyecte la foto de esta etapa de forma repetitiva y sature el chat, debes guiar al cliente de manera directa en un máximo de dos interacciones utilizando esta estructura limpia:

PROFUNDIZAR EN EL DOLOR (Sub-etapa: SOLUCIÓN_GANCHO):
   - Condición: El cliente ya respondió a la primera pregunta (edad u otro filtro).
   - Acción de la IA:
       1. Responde de manera humana con información **relevante y no redundante** tomada del archivo del producto activo (.txt).
          Conexión Empática: Valida su dolor con total humanidad y comprensión, haciéndole sentir que está en el lugar correcto.
          Escudo de Autoridad Corto: Explica en 2 líneas, de forma muy natural, cómo el beneficio principal del producto activo actúa directamente para mitigar o solucionar ESE dolor específico que el cliente acaba de admitir.
       2. Envía **inmediatamente la foto de beneficios** del producto.
       3. Envía **una sola pregunta de transición a DECISIÓN**:
          "¿Le gustaría conocer las opciones de compra y promociones especiales que tenemos disponibles? 📦"
          
   - Nota: Si el cliente hace preguntas adicionales sobre el producto, responde normalmente, sin repetir pasos anteriores, hasta que confirme explícitamente que desea ver precios.
  ⚠️ REGLA DE RETORNO: Si el cliente responde de forma evasiva, NO generes textos largos. Mantén la interacción corta y directa al dolor para forzar el avance al Paso 3 sin saturar el canal de imágenes repetidas.

  
4) CRITERIO DE AVANCE ABSOLUTO: Queda CRIMINALMENTE PROHIBIDO pasar a la etapa de DECISIÓN (listar precios) si el cliente no ha respondido positivamente (ej: "Sí", "Claro", "Dígame") a este gancho de permiso comercial.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISIÓN — Entrega de precios y planes comerciales. 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CONTROL ESTRICTO DE PRECIOS Y FORMATO UNIFICADO:
- Solo puedes saltar a esta etapa y listar los precios bajo dos condiciones únicas: 1) Si el cliente aceptó el gancho de permiso, o 2) Si exigió el costo desde su primer mensaje.

⚠️ ALERTA ROJA TÉCNICA — ESTRUCTURA DE 2 BLOQUES EXACTOS:
El servidor divide el texto en mensajes WhatsApp cada vez que detecta \n\n. Debes generar EXACTAMENTE DOS (2) bloques separados por \n\n. Nada más, nada menos.

BLOQUE 1 — Opciones + Recomendación (un solo bloque compacto, usa \n simple entre líneas, NUNCA \n\n dentro):
Lista TODAS las opciones que existen en el archivo del PRODUCTO ACTIVO — pueden ser 1, 2, 3, 4 o más, nunca inventes ni omitas ninguna. Usa el formato:
📦 *Opción N:* [Nombre del Plan] ([Cantidad]) — $[Precio] — [Beneficio/Ganancia extraído del .txt].
Marca con ✅RECOMENDADO la opción que el archivo del producto indique explícitamente como recomendada. Si el archivo no marca ninguna como recomendada, marca la de mayor cantidad/valor.
Después de listar todas las opciones, en la siguiente línea: Le sugiero la *Opción N* (usa el número real de la opción marcada con ✅) porque [argumento humano corto conectado al caso específico del cliente].

BLOQUE 2 — Pregunta de cierre (dos líneas con \n simple, NUNCA \n\n):
✨ ¿Con cuál de estas opciones le gustaría empezar para alcanzar los resultados deseados?

Contexto A (cliente aceptó ver precios): Línea intro = \nClaro, le detallo las opciones de compra para *[Nombre delProducto]*:\n 🚚 *Envío GRATIS* y 🤝 *Pago CONTRA-ENTREGA*
Contexto B (cliente preguntó precio directo): Antes del bloque de opciones genera UN párrafo puente que incluya: 1) validación empática de que eligió bien al preguntar por el producto 2) una línea de autoridad: [Nombre del producto] es 100% original, importado de EE.UU., posee certificado FDA y GMP, 3) una línea conectando el beneficio principal del producto con el dolor más común según el .txt. Luego en la siguiente línea: "A continución, le detallo las opciones de compra para *[Nombre del producto]*:" — todo esto dentro del BLOQUE 1, usando \n simple entre líneas, NUNCA \n\n.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS DE CONTROL POST-PRECIOS (DECISIÓN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Si el cliente se confunde con los precios o hace preguntas capciosas como "¿Cuánto sale en los tres?", aclárale con máxima empatía que son tres alternativas de planes independientes para que elija una, y pregúntale cuál prefiere.
- Si el cliente repite el nombre del producto o manda un mensaje corto de confirmación después de ver los precios, asume que está procesando la compra: sé empática, valida su mensaje en una sola línea y pregúntale directamente con cuál de las opciones que le diste prefiere iniciar su tratamiento.
- Si duda o dice que necesita tiempo para consultar o esperar ("voy a hablar con el papá", "el lunes le llamo", "necesito el dinero") → NO insistas. Responde con calidez, confirma la opción que mostró interés, dile que se la reservas y que le esperas de forma amable: "Con gusto le espero, le separo la opción que le interesó para que no pierda la promoción. Cuando esté listo/a, aquí estoy 😊".
- Si el cliente rechaza sin intención clara ("no me interesa", "está caro") → pregunta qué le frena y usa su situación para reconectar UNA vez.
REGLA: No pases a CIERRE hasta que elija explícitamente una opción o número de plan.

CIERRE — cuando el cliente ya eligió el plan
⚠️ REGLA DE TRANSICIÓN CRÍTICA PARA PASAR A LA ETAPA DE CIERRE:
NO debes disparar el formulario de datos de forma seca y abrupta. 
Antes de listar el formulario de datos, debes escribir un párrafo puente de calidez y justificación logística:
Confirma en una línea lo que eligió.
¡Excelente! Qué gran paso para empezar a ver los resultados que busca. 
Pide datos con este formulario exacto, sin cambiar una sola palabra:
"Para ayudarle a asegurar su producto y coordinar el despacho, ayúdeme por favor con los siguientes datos:\\n\\n*Nombre y Apellido:*\\n*Provincia-Ciudad:*\\n*Dirección exacta:* (dos calles y una referencia clara)"

⚠️ REGLA ESTRICTA CONTRA MENSAJES VAGOS, ERRORES O PUNTOS (.):
Si el cliente envía un mensaje que NO contiene los datos solicitados (ej. envía un punto ".", un emoticón, o palabras sueltas como "ya", "ok", "hola"), queda TERMINANTEMENTE PROHIBIDO repetir el pitch de venta, los beneficios del producto, los precios o las explicaciones del Pago Contra Entrega. 
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
- ⚠️ REGLA ABSOLUTA SI NO HAY PRODUCTO ACTIVO CARGADO: Si en este momento la sección "PRODUCTO ACTIVO" de tu contexto está vacía o dice "SIN PRODUCTO IDENTIFICADO", tienes TERMINANTEMENTE PROHIBIDO mencionar, listar o inventar cualquier precio, opción de compra, cantidad de unidades o nombre de plan — bajo NINGUNA circunstancia, ni siquiera si el cliente insiste o pide precio directo. En ese caso, tu única opción es identificar primero qué producto necesita (vía el menú de catálogo) antes de poder hablar de precios.
- ⚠️ REGLA ABSOLUTA SI EL PRODUCTO ACTIVO NO TIENE CONTENIDO REAL: Si la sección "PRODUCTO ACTIVO" existe pero el contenido del archivo está vacío, incompleto, o no contiene una sección clara de precios y opciones, tienes TERMINANTEMENTE PROHIBIDO inventar cifras. En su lugar, responde con calidez que necesitas un momento para confirmar las opciones disponibles, y NUNCA generes una etapa DECISIÓN con precios hasta que el archivo real tenga esa información.
10. TRANSPARENCIA TÉCNICA — Si piden tabla nutricional, registro sanitario o certificaciones: da datos puros sin pitch.
11. CONTROL DE CATÁLOGO Y CAMBIO DE PRODUCTO (CROSS-SELL) — La conversación se mantiene siempre sobre el PRODUCTO ACTIVO. Solo tú decides si hay un cambio real, nunca el sistema.
- Mantén el foco absoluto en el producto activo mientras el cliente hable de él, de sus síntomas relacionados, o use palabras que casualmente coincidan con otro producto del catálogo sin que eso sea su intención real. Una palabra suelta no es un cambio de producto.
- SOLO consideras un cambio de producto si el cliente, de forma clara y en el contexto de la conversación, expresa que el producto activo no es lo que busca, o pregunta explícitamente por otro producto distinto ("en realidad necesito algo para...", "¿tienen algo para...", "mejor hábleme del otro que vi"). Analiza la conversación completa, no una palabra aislada.
- Si decides que SÍ hay cambio real, hazlo de forma médica y empática en tu mensaje: explica por qué el producto anterior no aplica a esa necesidad nueva y presenta el producto correcto. Además, en tu JSON de respuesta agrega el campo "cambiarA" con el nombre EXACTO del producto del catálogo al que cambias (debe coincidir tal cual con el campo "nombre" del catálogo). Si NO hay cambio de producto, no incluyas ese campo o déjalo vacío.
12. PROHIBIDO CERRAR LA PUERTA O DESPEDIRSE PREMATURAMENTE: Mientras la venta no esté confirmada, queda estrictamente prohibido despedirse del cliente con frases como "Que tenga un excelente día" cuando solo te está dando un dato o una palabra de cortesía (ej: "A gracias", "Ok"). Mantén el canal abierto de forma vendedora.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO WHATSAPP (ESTILO COMERCIAL ELEGANTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Párrafos separados estrictamente con \\n\\n para que el sistema los fragmente de forma limpia en la pantalla del cliente.
- NEGRITAS COMERCIALES: Tienes la OBLIGACIÓN de usar negritas con *asteriscos* en cada mensaje para capturar la atención del cliente. Resalta siempre: 1) El nombre del producto activo en ese chat, 2) Datos clave numéricos (como la edad o cantidades), y 3) Los 2 o 3 conceptos o beneficios de mayor impacto de tu respuesta. No satures, pero usa la negrita estratégicamente en cada párrafo para que la lectura no sea plana.
- EMOJIS PERSUASIVOS: Cada mensaje que generes debe llevar OBLIGATORIAMENTE entre 1 y 3 emojis distribuidos de forma natural y elegante a lo largo del texto para dar calidez y dinamismo visual. Usa emojis que conecten directamente con salud, bienestar, éxito o empatía según el contexto del producto actual. Queda prohibido enviar bloques de texto puro sin ningún emoji.
- Listas: cada ítem en su propia línea con un emoji formal al inicio.
- Precios: cada opción en su propia línea limpia.
- La pregunta final debe ir completamente sola al final del mensaje.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RESPUESTA — OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RESPUESTA — OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"etapa":"NOMBRE_ETAPA","mensaje":"Tu respuesta aquí","cambiarA":""}
El campo "cambiarA" va vacío "" en el 99% de los casos. Solo lo llenas con el nombre EXACTO de otro producto del catálogo cuando decidiste, según la Regla de Oro 11, que el cliente realmente quiere cambiar de producto.

⚠️ REGLA ESTRICTA DE ORTOGRAFÍA PARA LAS ETAPAS:
El campo "etapa" debe coincidir EXACTAMENTE con una de estas opciones en mayúsculas. Queda prohibido alterar su escritura:
- BIENVENIDA
- ESCUCHA (Escríbelo siempre así, en mayúsculas y SIN tilde)
- SOLUCIÓN
- DECISIÓN
- CIERRE
- CONFIRMADO
- POSTVENTA
Solo comillas simples dentro del mensaje — nunca dobles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS CRÍTICAS DE CONTROL DE FORMATO (JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ESTRUCTURA DINÁMICA DE ENTRADA: Está estrictamente prohibido comenzar tus respuestas con frases repetitivas como "El [Producto] es...", "Claro...", o "Perfecto...". Varía drácticamente las primeras 5 palabras de tu mensaje en cada interacción (ej: "Para potenciar tu rendimiento...", "Esta solución actúa...", "Respecto a lo que me comentas..."). Esto previene bloqueos de seguridad del sistema.

2. OBLIGATORIEDAD DE PREGUNTA EN EL CIERRE: A menos que el cliente ya haya entregado su formulario completo con dirección de entrega y la venta esté cerrada, TODO mensaje que generes debe terminar OBLIGATORIAMENTE con UNA sola pregunta directa, corta y humana utilizando signos de interrogación (¿?). Nunca termines con un enunciado afirmativo o descriptivo.

3. PROTOCOLO DE CONVERSACIÓN SEGÚN EL CONTEXTO (3 ESCENARIOS):
- Escenario A (Por ID de Ads o Keyword Directa): Si el sistema te indica que hay un PRODUCTO ACTIVO, queda estrictamente prohibido preguntar qué producto busca o usar saludos fríos. Abre la conversación con calidez variando tus primeras 5 palabras, conectando directamente con el dolor principal o beneficio clave del producto activo según su archivo, y lanza inmediatamente la PREGUNTA FILTRO INICIAL definida en ese archivo.
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
            nuevaEtapa = parsed.etapa || etapaActual;

            // Cambio de producto decidido por la IA (nunca por keyword automática)
            if (parsed.cambiarA && parsed.cambiarA.trim() !== "") {
                const nuevoProducto = catalogo.find(p => p.nombre.toLowerCase() === parsed.cambiarA.trim().toLowerCase());
                if (nuevoProducto && (!productoActivo || nuevoProducto.nombre !== productoActivo.nombre)) {
                    console.log(`[CAMBIO DE PRODUCTO POR IA] ${productoActivo?.nombre || 'ninguno'} -> ${nuevoProducto.nombre}`);
                    productoActivo = nuevoProducto;
                    fotosEnviadas = {};
                    await redisSetex(productoKey, 86400 * 7, JSON.stringify(productoActivo));
                    await redisSetex(fotosKey, 86400 * 7, JSON.stringify(fotosEnviadas));
                }
            }
            let textoRaw = (parsed.mensaje || "")
                .replace(/\\n\\n/g, '\n\n')
                .replace(/\\n/g, '\n')
                .replace(/\*\*(.*?)\*\*/g, '*$1*');
            if (nuevaEtapa !== 'DECISIÓN') {
                textoRaw = textoRaw
                    .replace(/\.\s+([A-ZÁÉÍÓÚÑ¿])/g, '.\n\n$1')
                    .replace(/\s+([\u{1F300}-\u{1FAFF}])/gu, '\n\n$1');
            }
            textoFinal = textoRaw;        
            console.log(`[ETAPA] ${etapaActual} → ${nuevaEtapa}`);

  
if (nuevaEtapa === 'DECISIÓN') {
                const cierreMarker = '✨';
                const idxCierre = textoFinal.indexOf(cierreMarker);
                if (idxCierre !== -1) {
                    let bloque1 = textoFinal.substring(0, idxCierre).replace(/\n\n/g, '\n').trim();

                   // Separar intro de "A continuación/Claro" en mensaje propio
                    bloque1 = bloque1.replace(/((?:A continuaci[oó]n|Claro)[^\n]+)\n(📦)/gi, '$1\n\n$2');

                    // Separar párrafo previo al "A continuación/Claro"
                    bloque1 = bloque1.replace(/([^\n]+)\n((?:A continuaci[oó]n|Claro)[^\n]+)/gi, '$1\n\n$2');

                    // Opciones 📦 con línea visual entre ellas
                    bloque1 = bloque1.replace(/\n?(📦)/g, '\n \n$1');

                    // Separar ✅ de "Le sugiero/recomiendo" en mensaje distinto
                    bloque1 = bloque1.replace(/(✅[^\n]*)\n?(Le (?:sugiero|recomiendo|indico|aconsejo))/g, '$1\n\n$2');

                    const bloque2 = textoFinal.substring(idxCierre)
                        .replace(/\n\n/g, '\n')
                        .replace(/([\?])\s+(Su primera|Recuerde)/g, '$1\n \n$2');

                    textoFinal = bloque1.trim() + '\n\n' + bloque2;
                }
            }

  
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
            // 1. Extraemos el formulario final del cliente
            const mensajesCliente = historial.filter(h => h.role === 'user');
            const ultimoMensajeDatos = mensajesCliente.length > 0 ? mensajesCliente[mensajesCliente.length - 1].content : "No especificado";

            // 2. DETECTOR MAESTRO UNIVERSAL DE OPCIÓN (Lee directo de Redis)
            let opcionComprada = "Revisar en chat";
            let numeroOpcion = "";

            // Identificamos qué número de opción eligió el cliente
           for (let i = mensajesCliente.length - 1; i >= 0; i--) {
                const txt = mensajesCliente[i].content.toLowerCase();
                const match = txt.match(/opci[oó]n\s*(\d)|la\s*(\d)|la\s*(primera|segunda|tercera|cuarta)/);
                if (match) {
                    const numerales = { primera: "1", segunda: "2", tercera: "3", cuarta: "4" };
                    const num = match[1] || match[2] || numerales[match[3]];
                    if (num) { numeroOpcion = `opción ${num}`; break; }
                }
            }

            // Buscamos en el historial de la IA la línea exacta
            if (numeroOpcion !== "") {
                const mensajesIA = historial.filter(h => h.role === 'assistant');
                let lineaEncontrada = false;
                for (let i = mensajesIA.length - 1; i >= 0; i--) {
                    const textoIA = mensajesIA[i].content;
                    const lineas = textoIA.split('\n');
                    const lineaOpcion = lineas.find(l => l.toLowerCase().includes(numeroOpcion));
                    if (lineaOpcion) {
                        opcionComprada = lineaOpcion.trim().replace(/[*✅]/g, '');
                        lineaEncontrada = true;
                        break;
                    }
                }
            }

            // 3. Armamos el resumen limpio
            const resumenVenta = `📦 *NUEVA VENTA FINALIZADA*\n--------------------------------\n📦 *Producto:* ${productoActivo?.nombre || "Catálogo General"}\n📱 *WhatsApp:* https://wa.me/${remoteJid.split('@')[0]}\n🛍️ *Plan Elegido:* *${opcionComprada}*\n\n📋 *DATOS DE DESPACHO:*\n${ultimoMensajeDatos}\n--------------------------------\n_Fiorella cerró esta venta automáticamente._`;

            // 4. Tu fetch nativo original intacto
            await fetch(`${baseUrl}/message/sendText/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                body: JSON.stringify({ number: NUMERO_ADMIN, text: resumenVenta })
            }).catch(e => console.log("Error al enviar reporte al admin:", e.message));
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
                await fetch(`${KV_REST_API_URL}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(["DEL", lockKey]) }).catch(() => {});
                return res.status(200).send('OK');
            }
            await redisSetex(hashKey, 180, "1");
            const tsEnvio = tsActual;
          
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
                // Verificar si el cliente escribió algo nuevo mientras esperábamos
                const tsReciente = await redisGet(`lastmsg:${cleanJid}`).catch(() => null);
                if (tsReciente && tsReciente !== tsEnvio) {
                    console.log("[ABORT] Mensaje nuevo del cliente detectado, cancelando envío:", texto.substring(0, 50));
                    return false;
                }
                const delay = Math.min(texto.length * 35, 5000);
                console.log("[ENVIO] Intentando enviar a:", remoteJid, "| texto:", texto.substring(0, 50));
                try {
                    const typingRes = await fetch(`${baseUrl}/chat/returntyping/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                        body: JSON.stringify({ number: remoteJid, presence: "composing", delay })
                    });
                    console.log("[ENVIO] Typing status:", typingRes.status);
                } catch(te) { console.error("[ENVIO] Typing error:", te.message); }
                await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 1000)));
                try {
                    const sendRes = await fetch(`${baseUrl}/message/sendText/${instName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_WHATSAPI },
                        body: JSON.stringify({ number: remoteJid, text: texto })
                    });
                    const sendJson = await sendRes.json();
                    console.log("[ENVIO] Send status:", sendRes.status, "| response:", JSON.stringify(sendJson).substring(0, 200));
                } catch(se) { console.error("[ENVIO] Send error:", se.message); }
            };

            console.log("[ENVIO] partes:", partes.length, JSON.stringify(partes.map(p => p.substring(0,30))));
            console.log("[ENVIO] preguntaCierre:", preguntaCierre.substring(0, 50));
            console.log("[ENVIO] baseUrl:", baseUrl, "| instName:", instName);

           for (const parte of partes) {
                const ok = await enviar(parte);
                if (ok === false) break;
            }

            // ─── FOTOS ────────────────────────────────────────────────
            const mapaFotos = {
                "BIENVENIDA": imgProducto, "ESCUCHA": imgProducto,
                "SOLUCIÓN":   imgBeneficios, "DECISIÓN": imgTestimonios
            };
            const fotoEtapa     = mapaFotos[nuevaEtapa] || "";
            const fotoYaEnviada = fotosEnviadas[nuevaEtapa] === true;
            const etapaCambio   = nuevaEtapa !== etapaActual;
            const esNuevoProducto = !fotosEnviadas["ESCUCHA"];
            // DECISIÓN: foto siempre después de opciones, antes del cierre
            // ESCUCHA/SOLUCIÓN: foto al cambiar de etapa como antes
            const debeEnviarFoto = fotoEtapa && !fotoYaEnviada && (
                (nuevaEtapa === "DECISIÓN") ||
                (nuevaEtapa !== "DECISIÓN" && (etapaCambio || (nuevaEtapa === "ESCUCHA" && esNuevoProducto)))
            );

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

            if (preguntaCierre) {
                const ok = await enviar(preguntaCierre);
            }
        }

    } catch (error) { console.error("Error general:", error.message); }

    await fetch(`${KV_REST_API_URL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(["DEL", lockKey])
    }).catch(() => {});
    
    return res.status(200).send('OK');
};
