const fs = require('fs');
const path = require('path');

const historialConversacion = {}; 

module.exports = async (req, res) => {
    console.log("--- 🏁 INICIO DE PROCESO ---");

    if (req.method !== 'POST') return res.status(200).send('OK');

    const { 
        EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY 
    } = process.env;

    const data = req.body?.data;
    if (!data?.message || data.key?.fromMe) return res.status(200).send('OK');

    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");

    // --- MEMORIA ---
    if (!historialConversacion[remoteJid]) historialConversacion[remoteJid] = [];
    historialConversacion[remoteJid].push(`Cliente: ${clienteMsg}`);

    // --- CATÁLOGO ---
    let baseConocimiento = "";
    try {
        const txtPath = path.join(process.cwd(), 'api', 'combo-regeneracion.txt');
        baseConocimiento = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "Sin catálogo";
    } catch (e) { console.log("❌ Error catálogo:", e.message); }

    const inputGrok = `Eres Fiorella de JRJMarket. Trato de USTED. Persuasiva.
    Catálogo: ${baseConocimiento}
    Historial: ${historialConversacion[remoteJid].join("\n")}
    Responde directo como Fiorella:`;

    try {
        // --- AVISO DE CONEXIÓN EN WHATSAPP ---
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: remoteJid, text: "⚙️ _Conectando con Grok Reasoning..._" })
        });

        const resp = await fetch('https://api.x.ai/v1/responses', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                "model": "grok-4.20-reasoning",
                "input": inputGrok
            })
        });
        
        const json = await resp.json();

        // Extracción del texto
        let textoIA = "";
        try {
            const messageOutput = json.output?.find(o => o.type === 'message');
            if (messageOutput?.content) {
                textoIA = messageOutput.content.find(c => c.type === 'output_text')?.text || "";
            }
        } catch (err) { textoIA = ""; }

        if (!textoIA) {
            await fetch(`${baseUrl}/message/sendText/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                body: JSON.stringify({ number: remoteJid, text: "❌ _Grok no devolvió texto válido._" })
            });
            return res.status(200).send('Error Grok');
        }

        // --- AVISO DE RESPUESTA RECIBIDA EN WHATSAPP ---
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: remoteJid, text: `✅ _Grok respondió con éxito._` })
        });

        textoIA = textoIA.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();

        // --- ENVÍO CASCADA DE FIORELLA ---
        let partes = textoIA.split('\n').filter(p => p.trim() !== "");
        for (const parte of partes) {
            await fetch(`${baseUrl}/message/sendText/${instName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                body: JSON.stringify({ number: remoteJid, text: parte })
            });
            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (error) { 
        console.log("🔥 ERROR:", error.message);
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: remoteJid, text: `⚠️ _Error técnico: ${error.message}_` })
        });
    }

    return res.status(200).send('OK');
};
