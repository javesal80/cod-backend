const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {

if (req.method !== 'POST') return res.status(200).send('OK');
if (!req.body?.data?.message) return res.status(200).send('OK');

// ─────────────────────────────────────
// ENV
// ─────────────────────────────────────
const {
    EVOLUTION_URL,
    EVOLUTION_TOKEN_WHATSAPI,
    INSTANCE_WHATSAPI,
    KV_REST_API_URL,
    KV_REST_API_TOKEN,
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    GROK_API_KEY,
    IA_PROVIDER,
    masterPrompt
} = process.env;

// ─────────────────────────────────────
// DATA
// ─────────────────────────────────────
const data = req.body.data;

const remoteJid = data.key?.remoteJid;
const msgId = data.key?.id;

if (!remoteJid || !msgId) return res.status(200).send('OK');

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
if (!clienteMsg) return res.status(200).send('OK');

// ─────────────────────────────────────
// REDIS HELPERS
// ─────────────────────────────────────
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

// ─────────────────────────────────────
// ID EMPOTENCIA REAL (CLAVE)
// ─────────────────────────────────────
const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, '_');

const fingerprint = Buffer.from(
    `${msgId}:${clienteMsg}:${remoteJid}`
).toString('base64').slice(0, 40);

const msgKey = `msg:${cleanJid}:${msgId}`;
const fpKey = `fp:${cleanJid}:${fingerprint}`;

if (await redisGet(msgKey) || await redisGet(fpKey)) {
    return res.status(200).send('OK');
}

await Promise.all([
    redisSetex(msgKey, 120, "1"),
    redisSetex(fpKey, 120, "1")
]);

// ─────────────────────────────────────
// LOCK (EVITA CONCURRENCIA)
// ─────────────────────────────────────
const lockKey = `lock:${cleanJid}`;

const lock = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["SET", lockKey, "1", "NX", "EX", 15])
}).then(r => r.json());

if (lock.result !== "OK") return res.status(200).send('OK');

// ─────────────────────────────────────
// IA ROUTER
// ─────────────────────────────────────
const prompt = masterPrompt
    ? masterPrompt + "\n\nMENSAJE DEL CLIENTE:\n" + clienteMsg
    : clienteMsg;

let textoFinal = "";

try {

    if (IA_PROVIDER === "openai") {

        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.6
            })
        });

        const json = await r.json();
        textoFinal = json?.choices?.[0]?.message?.content || "";

    } else if (IA_PROVIDER === "grok") {

        const r = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROK_API_KEY}`
            },
            body: JSON.stringify({
                model: "grok-4-1-fast-non-reasoning",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
            })
        });

        const json = await r.json();
        textoFinal = json?.choices?.[0]?.message?.content || "";

    } else {

        // ─── GEMINI (TU VERSION ORIGINAL CORREGIDA) ───
        console.log("[IA ENGINE] GEMINI ACTIVATED");

        const r = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: prompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 1000
                    }
                })
            }
        );

        const json = await r.json();

        textoFinal =
            json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

} catch (e) {
    textoFinal = "Hola 😊 ¿en qué puedo ayudarte?";
}

// ─────────────────────────────────────
// CLEAN OUTPUT
// ─────────────────────────────────────
textoFinal = (textoFinal || "").replace(/```/g, "").trim();

if (!textoFinal || textoFinal.length < 3) {
    textoFinal = "Hola 😊 ¿en qué puedo ayudarte?";
}

// ─────────────────────────────────────
// SEND
// ─────────────────────────────────────
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

// ─────────────────────────────────────
// UNLOCK
// ─────────────────────────────────────
await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` },
    body: JSON.stringify(["DEL", lockKey])
});

return res.status(200).send('OK');

};
