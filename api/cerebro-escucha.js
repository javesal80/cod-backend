const fs = require('fs');
const path = require('path');

const historialConversacion = {}; 

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const { 
        EVOLUTION_URL, 
        EVOLUTION_TOKEN, 
        INSTANCE_NAME, 
        GROK_API_KEY 
    } = process.env;

    if (!req.body?.data?.message || req.body.data.key?.fromMe) {
        return res.status(200).send('OK');
    }

    const data = req.body.data;
    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
    const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";

    if (!historialConversacion[remoteJid]) historialConversacion[remoteJid] = [];
    historialConversacion[remoteJid].push(`Cliente: ${clienteMsg}`);
    if (historialConversacion[remoteJid].length > 10) historialConversacion[remoteJid].shift();

    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const hoy = new Date();
    const mañana = dias[(hoy.getDay() + 1) % 7];
    const pasado = dias[(hoy.getDay() + 2) % 7];

    let baseConocimiento = "";
    try {
        const txtPath = path.join(process.cwd(), 'api', 'combo-regeneracion.txt');
        baseConocimiento = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "";
    } catch (e) { console.error("Error catálogo:", e); }

    const inputGrok = `
    IDENTIDAD: Eres Fiorella de JRJMarket. Trato de USTED siempre.
    ESTILO: Humana, cálida, puntos suspensivos (...).
    CATÁLOGO: ${baseConocimiento}
    HISTORIAL: ${historialConversacion[remoteJid].join("\n")}
    LOGÍSTICA: Entrega entre ${mañana} o ${pasado}.
    REGLA: Si el cliente dice NO, usa NEUROMARKETING y enfócate en su SALUD.
    IMPORTANTE: No incluyas nombres de personajes como "Fiorella:" en tu respuesta. Solo el texto.
    RESPUESTA DE FIORELLA:`;

    try {
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
        
        // --- LA RUTA CORRECTA SEGÚN TU LOG ---
        // Buscamos en: output[1].content[0].text
        let textoIA = "";
        try {
            // Buscamos el objeto tipo 'message' dentro del array de output
            const messageOutput = json.output.find(o => o.type === 'message');
            if (messageOutput && messageOutput.content) {
                textoIA = messageOutput.content.find(c => c.type === 'output_text').text;
            }
        } catch (err) {
            console.log("Ruta alternativa de extracción...");
            textoIA = json.message || json.output?.[0]?.text || "";
        }

        // Limpiar el prefijo "**Fiorella:**" que a veces mete este modelo
        textoIA = textoIA.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();

        if (textoIA && typeof textoIA === 'string') {
            historialConversacion[remoteJid].push(`Fiorella: ${textoIA}`);

            let cascada = textoIA
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .replace(/\.\.\.\s*/g, "...\n")
                .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

            const partes = cascada.split('\n');

            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                await new Promise(r => setTimeout(r, 1200)); 
            }
        } else {
            console.error("❌ Falló extracción. Estructura recibida:", JSON.stringify(json));
        }

    } catch (error) { 
        console.error("🔥 Error:", error.message); 
    }
    return res.status(200).send('OK');
};
