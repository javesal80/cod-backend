const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

if (req.method !== 'POST') return res.status(200).send('OK');

const {
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME,
    IA_PROVIDER1,
    KV_REST_API_URL, KV_REST_API_TOKEN,
    GEMINI_API_KEY
} = process.env;

if (!req.body?.data?.message) return res.status(200).send('OK');

const data = req.body.data;
const remoteJid = data.key?.remoteJid;
const msgId = data.key?.id;

const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
const instName = req.body.instance || INSTANCE_NAME || "bot";

let clienteMsg =
data.message?.conversation ||
data.message?.extendedTextMessage?.text ||
data.message?.imageMessage?.caption ||
data.message?.videoMessage?.caption ||
data.message?.buttonsResponseMessage?.selectedButtonId ||
data.message?.interactiveResponseMessage?.body ||
"";

clienteMsg = clienteMsg.toString().trim();

// ─── REDIS SIMPLE ─────────────────────
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

// ─── ANTI DUP ─────────────────────────
if (await redisGet(`dd:${msgId}`)) return res.status(200).send('OK');
await redisSetex(`dd:${msgId}`, 60, "1");

const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

// ─── LOCK ─────────────────────────────
const lockKey = `lock:${cleanJid}`;

const lock = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["SET", lockKey, "1", "NX", "EX", 20])
}).then(r => r.json());

if (lock.result !== "OK") return res.status(200).send('OK');

// ─── MEMORIA ──────────────────────────
const memoriaKey = `chat:${cleanJid}`;
const stageKey = `stage:${cleanJid}`;

let historial = [];
let etapaActual = "BIENVENIDA";

const h = await redisGet(memoriaKey);
const e = await redisGet(stageKey);

if (h) historial = JSON.parse(h);
if (e) etapaActual = e;

// ─── HISTORIAL ─────────────────────────
historial.push({ role: "user", content: clienteMsg });

// ─── PROMPT SIMPLE Y ESTABLE ───────────
const prompt = `
Eres un asesor humano de ventas por WhatsApp.

Reglas:
- Habla natural, corto y humano
- 1 sola pregunta al final (si aplica)
- Nunca respondas como bot
- Si no entiendes algo, responde igual de forma útil
- Máximo 8 líneas
- Usa emojis suaves

Devuelve SIEMPRE una respuesta útil, aunque no sigas formato.

Cliente dijo:
${clienteMsg}
`;

// ─── GEMINI CALL ───────────────────────
let respuestaRaw = "";

try {
    const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        }
    );

    respuestaRaw =
        (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text ||
        "Hola 😊 ¿en qué puedo ayudarle?";
} catch (e) {
    respuestaRaw = "Hola 😊 ¿en qué puedo ayudarle?";
}

// ─── LIMPIEZA ──────────────────────────
let textoFinal = respuestaRaw
    .replace(/```/g, "")
    .trim();

// ─── GARANTÍA DE RESPUESTA ─────────────
if (!textoFinal || textoFinal.length < 2) {
    textoFinal = "Hola 😊 ¿en qué puedo ayudarle hoy?";
}

// ─── GUARDAR ───────────────────────────
historial.push({ role: "assistant", content: textoFinal });

await redisSetex(memoriaKey, 604800, JSON.stringify(historial));
await redisSetex(stageKey, 604800, etapaActual);

// ─── ENVIAR ────────────────────────────
await fetch(`${baseUrl}/message/sendText/${instName}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN
    },
    body: JSON.stringify({
        number: remoteJid,
        text: textoFinal
    })
});

// ─── UNLOCK ────────────────────────────
await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["DEL", lockKey])
});

return res.status(200).send('OK');

};
