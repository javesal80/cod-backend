const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

if (req.method !== 'POST') return res.status(200).send('OK');
if (!req.body?.data?.message) return res.status(200).send('OK');

// ─── ENV ─────────────────────────────
const {
    EVOLUTION_URL,
    EVOLUTION_TOKEN_WHATSAPI,
    INSTANCE_WHATSAPI,
    KV_REST_API_URL,
    KV_REST_API_TOKEN,
    GEMINI_API_KEY
} = process.env;

// ─── DATA ────────────────────────────
const data = req.body.data;
const remoteJid = data.key?.remoteJid;
const msgId = data.key?.id;

const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
const instName = req.body.instance || INSTANCE_WHATSAPI || "bot";

// ─── EXTRACT MSG ─────────────────────
let clienteMsg =
data.message?.conversation ||
data.message?.extendedTextMessage?.text ||
data.message?.imageMessage?.caption ||
data.message?.videoMessage?.caption ||
data.message?.buttonsResponseMessage?.selectedButtonId ||
data.message?.interactiveResponseMessage?.body ||
"";

clienteMsg = clienteMsg.toString().trim().toLowerCase();

if (!clienteMsg) return res.status(200).send('OK');

// ─── REDIS ───────────────────────────
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

// ─── ANTI DUP FÍSICO ────────────────
if (await redisGet(`dd:${msgId}`)) return res.status(200).send('OK');
await redisSetex(`dd:${msgId}`, 60, "1");

// ─── JID ─────────────────────────────
const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

// ─── LOCK ────────────────────────────
const lockKey = `lock:${cleanJid}`;

const lock = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["SET", lockKey, "1", "NX", "EX", 15])
}).then(r => r.json());

if (lock.result !== "OK") return res.status(200).send('OK');

// ─── MEMORIA ─────────────────────────
const memoriaKey = `chat:${cleanJid}`;
const stageKey = `stage:${cleanJid}`;

let historial = [];
let etapaActual = "BIENVENIDA";

const h = await redisGet(memoriaKey);
const e = await redisGet(stageKey);

if (h) historial = JSON.parse(h);
if (e) etapaActual = e;

// ─────────────────────────────────────
// 🔴 ANTI LOOP INTELIGENTE (CLAVE)
// ─────────────────────────────────────

// si usuario repite exactamente lo mismo 2 veces seguidas → no responder
const lastUser = [...historial].reverse().find(m => m.role === "user");
if (lastUser?.content?.trim() === clienteMsg) {
    await fetch(KV_REST_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
        body: JSON.stringify(["DEL", lockKey])
    });
    return res.status(200).send('OK');
}

// filtro basura tipo "hola" repetido
const trivial = ["hola", "hi", "buenas", "holaa", "holaaa"];
if (trivial.includes(clienteMsg) && lastUser?.content === clienteMsg) {
    await fetch(KV_REST_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
        body: JSON.stringify(["DEL", lockKey])
    });
    return res.status(200).send('OK');
}

// ─── HISTORIAL ───────────────────────
historial.push({ role: "user", content: clienteMsg });

// ─── PROMPT GEMINI (CONTROLADO) ──────
const prompt = `
Eres un asesor humano de ventas por WhatsApp.

Reglas estrictas:
- Respuestas naturales, humanas y cortas
- Máximo 6 líneas
- No repitas saludos infinitos
- No entres en bucles de cortesía
- Si el usuario dice hola, responde SOLO una vez de forma breve y pregunta qué necesita
- Una sola pregunta final
- Estilo cercano, no robótico

Usuario:
${clienteMsg}
`;

// ─── GEMINI ──────────────────────────
let respuestaRaw = "";

try {
    const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        }
    );

    respuestaRaw =
        (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text ||
        "Hola 😊 ¿en qué puedo ayudarte?";
} catch (e) {
    respuestaRaw = "Hola 😊 ¿en qué puedo ayudarte?";
}

// ─── LIMPIEZA ────────────────────────
let textoFinal = respuestaRaw
    .replace(/```/g, "")
    .trim();

// fallback duro
if (!textoFinal || textoFinal.length < 3) {
    textoFinal = "Hola 😊 ¿en qué puedo ayudarte?";
}

// ─── GUARDAR ─────────────────────────
historial.push({ role: "assistant", content: textoFinal });

await redisSetex(memoriaKey, 604800, JSON.stringify(historial));
await redisSetex(stageKey, 604800, etapaActual);

// ─── ENVÍO ───────────────────────────
await fetch(`${baseUrl}/message/sendText/${instName}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_TOKEN_WHATSAPI
    },
    body: JSON.stringify({
        number: remoteJid,
        text: textoFinal
    })
});

// ─── UNLOCK ──────────────────────────
await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["DEL", lockKey])
});

return res.status(200).send('OK');

};
