const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

if (req.method !== 'POST') return res.status(200).send('OK');

const {
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME,
    GROK_API_KEY, OPENAI_API_KEY, IA_PROVIDER1,
    KV_REST_API_URL, KV_REST_API_TOKEN,
    GEMINI_API_KEY,
    SUPABASE_URL,
    SUPABASE_KEY
} = process.env;

const NUMERO_ADMIN = "593992668002";

if (!req.body?.data?.message) return res.status(200).send('OK');

// ─── ADMIN ───────────────────────────────
if (req.body.data.key?.fromMe) {
    const msgAdmin = (req.body.data.message?.conversation || "").trim().toLowerCase();
    const cleanJidAdmin = req.body.data.key?.remoteJid?.replace(/[^a-zA-Z0-9]/g, '_');

    if (msgAdmin === '#pausa') {
        await fetch(KV_REST_API_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["SETEX", `pausa:${cleanJidAdmin}`, 86400, "1"])
        });
    }

    if (msgAdmin === '#activar') {
        await fetch(KV_REST_API_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(["DEL", `pausa:${cleanJidAdmin}`])
        });
    }

    return res.status(200).send('OK');
}

const data = req.body.data;
const remoteJid = data.key?.remoteJid;
const msgId = data.key?.id;

const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";
const provider = (IA_PROVIDER1 || 'gemini').trim().toLowerCase();

let clienteMsg = (data.message?.conversation ||
    data.message?.extendedTextMessage?.text || "").trim();

// ─── AUDIO ───────────────────────────────
if (!clienteMsg && data.message?.audioMessage) {
    try {
        const mediaResp = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ message: { key: data.key, message: data.message } })
        });

        const mediaJson = await mediaResp.json();
        if (mediaJson.base64) {
            const buffer = Buffer.from(mediaJson.base64, 'base64');
            const formData = new FormData();
            formData.append('file', new Blob([buffer]), 'audio.ogg');
            formData.append('model', 'whisper-1');

            const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                method: 'POST',
                headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: formData
            });

            clienteMsg = (await whisperResp.json()).text || "";
        }
    } catch (e) {}
}

// ─── REDIS HELPERS ───────────────────────
const redisGet = async (key) => {
    const r = await fetch(KV_REST_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
        body: JSON.stringify(["GET", key])
    });
    return (await r.json()).result || null;
};

const redisSetex = async (key, s, v) => {
    await fetch(KV_REST_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
        body: JSON.stringify(["SETEX", key, s, v])
    });
};

// ─── ANTI DUP ────────────────────────────
if (await redisGet(`dd:${msgId}`)) return res.status(200).send('OK');
await redisSetex(`dd:${msgId}`, 60, "1");

const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

// ─── LOCK ────────────────────────────────
const lockKey = `lock:${cleanJid}`;

const lock = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["SET", lockKey, "1", "NX", "EX", 25])
}).then(r => r.json());

if (lock.result !== "OK") return res.status(200).send('OK');

// ─── MEMORIA ─────────────────────────────
const memoriaKey = `chat:${cleanJid}`;
const stageKey = `stage:${cleanJid}`;
const productoKey = `prod:${cleanJid}`;
const fotosKey = `fotos:${cleanJid}`;

let historial = [];
let etapaActual = "BIENVENIDA";
let productoActivo = null;
let fotosEnviadas = {};

const [g, e, p, f] = await Promise.all([
    redisGet(memoriaKey),
    redisGet(stageKey),
    redisGet(productoKey),
    redisGet(fotosKey)
]);

if (g) historial = JSON.parse(g);
if (e) etapaActual = e;
if (p) productoActivo = JSON.parse(p);
if (f) fotosEnviadas = JSON.parse(f);

// ─── CATALOGO ────────────────────────────
let catalogo = [];
try {
    const pp = path.join(process.cwd(), 'api', 'productos.json');
    if (fs.existsSync(pp)) {
        catalogo = JSON.parse(fs.readFileSync(pp)).PRODUCTOS || [];
    }
} catch (e) {}

// ─── SALUDO ──────────────────────────────
if (historial.length === 0) {
    const saludos = [
        "Hola 😊 ¿en qué puedo ayudarle hoy?",
        "Buenas 👋 cuénteme qué necesita",
        "Hola, gusto en atenderle 🌿"
    ];

    const saludo = saludos[Math.floor(Math.random() * saludos.length)];

    await fetch(`${baseUrl}/message/sendText/${instName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: saludo })
    });

    await new Promise(r => setTimeout(r, 1200));
}

// ─── HISTORIAL ───────────────────────────
historial.push({ role: "user", content: clienteMsg });
if (historial.length > 50) historial = historial.slice(-50);

// ─── GEMINI PROMPT MEJORADO ──────────────
const masterPrompt = `
Eres una asesora humana de ventas por WhatsApp.
Hablas natural, corto, cálido y conversacional.

REGLAS:
- Máximo 1 pregunta por mensaje
- No sonar robot
- No repetir información
- Detecta intención del cliente
- Avanza solo si el cliente lo permite
- Si duda → responde primero, luego pregunta
- Usa emojis suaves (1-3 máximo)
- Español neutro latino

ETAPAS:
BIENVENIDA, ESCUCHA, SOLUCIÓN, DECISIÓN, CIERRE, CONFIRMADO

DEVUELVE SOLO JSON:
{"etapa":"ETAPA","mensaje":"RESPUESTA","cambiarA":""}

CATALOGO:
${JSON.stringify(catalogo)}
`;

// ─── GEMINI CALL ─────────────────────────
let respuestaRaw = "";

const r = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
{
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        contents: [{
            parts: [{
                text: masterPrompt + "\n\nMENSAJE CLIENTE:\n" + clienteMsg
            }]
        }]
    })
});

respuestaRaw = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";

// ─── PARSE ───────────────────────────────
let parsed;
try {
    const clean = respuestaRaw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean.match(/\{[\s\S]*\}/)[0]);
} catch {
    parsed = { etapa: etapaActual, mensaje: respuestaRaw };
}

let textoFinal = parsed.mensaje;
let nuevaEtapa = parsed.etapa || etapaActual;

// ─── GUARDAR ─────────────────────────────
historial.push({ role: "assistant", content: textoFinal });

await redisSetex(memoriaKey, 604800, JSON.stringify(historial));
await redisSetex(stageKey, 604800, nuevaEtapa);

// ─── RESPUESTA ───────────────────────────
await fetch(`${baseUrl}/message/sendText/${instName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
    body: JSON.stringify({ number: remoteJid, text: textoFinal })
});

await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["DEL", lockKey])
});

return res.status(200).send('OK');

};
