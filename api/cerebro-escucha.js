const fs = require('fs');
const path = require('path');

// Memoria persistente en la instancia de Vercel
const historialConversacion = {}; 

module.exports = async (req, res) => {
    // Solo aceptamos POST de Evolution API
    if (req.method !== 'POST') return res.status(200).send('OK');

    const { 
        EVOLUTION_URL, 
        EVOLUTION_TOKEN, 
        INSTANCE_NAME, 
        GROK_API_KEY 
    } = process.env;

    // Filtro: No procesar si no hay mensaje o si es enviado por nosotros
    if (!req.body?.data?.message || req.body.data.key?.fromMe) {
        return res.status(200).send('OK');
    }

    const data = req.body.data;
    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
    const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";

    // --- MEMORIA DE CONVERSACIÓN ---
    if (!historialConversacion[remoteJid]) historialConversacion[remoteJid] = [];
    historialConversacion[remoteJid].push(`Cliente: ${clienteMsg}`);
    if (historialConversacion[remoteJid].length > 10) historialConversacion[remoteJid].shift();

    // Fechas dinámicas
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const hoy = new Date();
    const mañana = dias[(hoy.getDay() + 1) % 7];
    const pasado = dias[(hoy.getDay() + 2) % 7];

    // Cargar Catálogo (combo-regeneracion.txt)
    let baseConocimiento = "";
    try {
        const txtPath = path.join(process.cwd(), 'api', 'combo-regeneracion.txt');
        baseConocimiento = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "";
    } catch (e) { console.error("Error catálogo:", e); }

    // --- PROMPT MAESTRO (Persuasión de Fiorella) ---
    const inputGrok = `
    IDENTIDAD: Eres Fiorella de JRJMarket, asesora experta. Trato de USTED siempre.
    ESTILO: Humana, cálida, puntos suspensivos (...) y formato CASCADA.
    CATÁLOGO: ${baseConocimiento}
    LOGÍSTICA: Entrega entre ${mañana} o ${pasado}. Pago contra entrega.
    HISTORIAL: ${historialConversacion[remoteJid].join("\n")}
    
    REGLA: Si el cliente dice NO o cancela, usa NEUROMARKETING. Enfócate en su SALUD. No aceptes la cancelación fácil.
    
    RESPUESTA DE FIORELLA (en frases cortas para globos):`;

    try {
        // --- LLAMADA AL MOTOR GROK (Formato Responses) ---
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
        
        // --- BLINDAJE ANTI-CRASH ---
        // Buscamos el texto en message, output o text. Si no hay nada, usamos string vacío.
        let textoFinal = json.message || json.output || (json.choices && json.choices[0].text) || "";

        // Verificamos que sea un texto real antes de usar .trim() o procesar
        if (textoFinal && typeof textoFinal === 'string') {
            const textoLimpio = textoFinal.trim();
            historialConversacion[remoteJid].push(`Fiorella: ${textoLimpio}`);

            // Formateo Cascada
            let cascada = textoLimpio
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .replace(/\.\.\.\s*/g, "...\n")
                .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

            const partes = cascada.split('\n');

            // Envío por globos
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                await new Promise(r => setTimeout(r, 1200)); 
            }
        } else {
            console.error("❌ Grok no devolvió texto. Respuesta raw:", JSON.stringify(json));
        }

    } catch (error) { 
        console.error("🔥 Error en el flujo:", error.message); 
    }

    return res.status(200).send('OK');
};
