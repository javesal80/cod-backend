const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

if (req.method !== 'POST') return res.status(200).send('OK');

console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("[WEBHOOK] NUEVO MENSAJE RECIBIDO");

const {
    EVOLUTION_URL,
    EVOLUTION_TOKEN_WHATSAPI,
    INSTANCE_WHATSAPI,
    KV_REST_API_URL,
    KV_REST_API_TOKEN,
    GEMINI_API_KEY,
    IA_PROVIDER11
} = process.env;

if (!req.body?.data?.message) {
    console.log("[WEBHOOK] Sin mensaje válido");
    return res.status(200).send('OK');
}

const data = req.body.data;
const remoteJid = data.key?.remoteJid;
const msgId = data.key?.id;

console.log("[USER]", remoteJid);
console.log("[MSG ID]", msgId);

const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
const instName = req.body.instance || INSTANCE_WHATSAPI || "bot";

let clienteMsg =
    data.message?.conversation ||
    data.message?.extendedTextMessage?.text ||
    data.message?.imageMessage?.caption ||
    data.message?.videoMessage?.caption ||
    data.message?.buttonsResponseMessage?.selectedButtonId ||
    data.message?.interactiveResponseMessage?.body ||
    "";

clienteMsg = clienteMsg.toString().trim();

console.log("[CLIENTE MSG]", clienteMsg);

// ─── REDIS ─────────────────────
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

// ─── ANTI DUP MENSAJE ─────────────────────
if (await redisGet(`dd:${msgId}`)) {
    console.log("[DUPLICADO] msgId ya procesado");
    return res.status(200).send('OK');
}
await redisSetex(`dd:${msgId}`, 60, "1");

const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

// ─── LOCK ─────────────────────────────
const lockKey = `lock:${cleanJid}`;

const lock = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["SET", lockKey, "1", "NX", "EX", 20])
}).then(r => r.json());

if (lock.result !== "OK") {
    console.log("[LOCK] bloqueado");
    return res.status(200).send('OK');
}

// ─── MEMORIA ──────────────────────────
const memoriaKey = `chat:${cleanJid}`;
const stageKey = `stage:${cleanJid}`;

let historial = [];
let etapaActual = "BIENVENIDA";

const h = await redisGet(memoriaKey);
const e = await redisGet(stageKey);

if (h) historial = JSON.parse(h);
if (e) etapaActual = e;

historial.push({ role: "user", content: clienteMsg });

// ─── DETECTOR SIMPLE ANTI LOOP ─────────
const lastAssistant = historial
    .filter(m => m.role === "assistant")
    .slice(-1)[0]?.content || "";

if (lastAssistant && lastAssistant.includes(clienteMsg) && clienteMsg.length < 10) {
    console.log("[ANTI-LOOP] respuesta repetida evitada");
    return res.status(200).send('OK');
}

// ─── MASTER PROMPT ─────────────────────
const masterPrompt = `
Eres un asesor humano de ventas por WhatsApp.

Reglas:
- Habla natural y humano
- No repitas frases exactas
- Máximo 8 líneas
- 1 sola pregunta al final si aplica
- No seas robótico
- No digas siempre lo mismo

Cliente:
${clienteMsg}
`;

// ─── GEMINI (VERSIÓN QUE SÍ FUNCIONA COMO TU TENÍAS) ─────────
console.log("[IA ENGINE] GEMINI ACTIVATED");

let respuestaRaw = "";

try {
    const r = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: masterPrompt }]
                    }
                ],
                generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 800
                }
            })
        }
    );

    const json = await r.json();

    console.log("[GEMINI RAW]", JSON.stringify(json).substring(0, 300));

    respuestaRaw =
        json?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Hola 😊 ¿en qué puedo ayudarte?";
} catch (e) {
    console.log("[GEMINI ERROR]", e.message);
    respuestaRaw = "Hola 😊 ¿en qué puedo ayudarte?";
}

// ─── LIMPIEZA ──────────────────────────
let textoFinal = respuestaRaw
    .replace(/```/g, "")
    .trim();

// ─── GARANTÍA ──────────────────────────
if (!textoFinal || textoFinal.length < 2) {
    textoFinal = "Hola 😊 ¿en qué puedo ayudarte?";
}

// ─── DETECTOR SIMPLE DE REPETICIÓN ─────
if (lastAssistant && lastAssistant === textoFinal) {
    console.log("[ANTI-REPETICIÓN] mismo output evitado");
    textoFinal = "Entiendo 👍 dime un poco más para ayudarte mejor.";
}

// ─── GUARDAR ───────────────────────────
historial.push({ role: "assistant", content: textoFinal });

await redisSetex(memoriaKey, 604800, JSON.stringify(historial));
await redisSetex(stageKey, 604800, etapaActual);

// ─── LOG FINAL ─────────────────────────
console.log("[FINAL RESPONSE]", textoFinal);

// ─── ENVIAR ────────────────────────────
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

console.log("[SENT OK]");

await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["DEL", lockKey])
});

console.log("[UNLOCKED]");

return res.status(200).send('OK');

};
