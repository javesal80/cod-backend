const fs = require('fs');
const path = require('path');

// Memoria persistente mientras la instancia de Vercel esté activa
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

    // Filtro: No procesar si no hay mensaje o si es un mensaje enviado por nosotros mismos
    if (!req.body?.data?.message || req.body.data.key?.fromMe) {
        return res.status(200).send('OK');
    }

    const data = req.body.data;
    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
    const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";

    // --- GESTIÓN DE MEMORIA (Máximo 10 mensajes) ---
    if (!historialConversacion[remoteJid]) {
        historialConversacion[remoteJid] = [];
    }
    historialConversacion[remoteJid].push(`Cliente: ${clienteMsg}`);
    if (historialConversacion[remoteJid].length > 10) historialConversacion[remoteJid].shift();

    // Fechas dinámicas para la logística
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const hoy = new Date();
    const mañana = dias[(hoy.getDay() + 1) % 7];
    const pasado = dias[(hoy.getDay() + 2) % 7];

    // Cargar Catálogo (combo-regeneracion.txt)
    let baseConocimiento = "";
    try {
        const rootDir = process.cwd();
        const txtPath = path.join(rootDir, 'api', 'combo-regeneracion.txt');
        baseConocimiento = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "";
    } catch (e) { 
        console.error("Error cargando catálogo:", e); 
    }

    // --- CONSTRUCCIÓN DEL INPUT PARA GROK REASONING ---
    const contextoHistorial = historialConversacion[remoteJid].join("\n");
    
    const inputGrok = `
    IDENTIDAD: Eres Fiorella de JRJMarket, asesora experta en bienestar. Trato de USTED siempre.
    ESTILO: Humana, cálida, usa puntos suspensivos (...) y formato CASCADA.

    REGLAS DE ORO:
    - REVISA EL HISTORIAL. Si ya saludaste, NO repitas el saludo.
    - Si el cliente dice NO o cancela, usa NEUROMARKETING. No aceptes la cancelación fácil, enfócate en su SALUD.
    - Usa puntos suspensivos para sonar natural.

    LOGÍSTICA: Entrega entre ${mañana} o ${pasado}. Pago contra entrega. (Servientrega, Laar, Gintracon, Veloces).

    CATÁLOGO OFICIAL:
    ${baseConocimiento}

    HISTORIAL DE CONVERSACIÓN:
    ${contextoHistorial}

    RESPUESTA DE FIORELLA (en frases cortas para globos separados):`;

    try {
        // --- LLAMADA AL MOTOR GROK (MULTI-IA) ---
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
        
        // Blindaje para extraer el texto correctamente según el formato de la API
        let textoFinal = json.message || json.output || (json.choices && json.choices[0].text) || "";

        if (textoFinal && typeof textoFinal === 'string') {
            // Guardar respuesta en memoria
            historialConversacion[remoteJid].push(`Fiorella: ${textoFinal}`);

            // --- FORMATEO CASCADA (Separar mensajes) ---
            let cascada = textoFinal
                .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
                .replace(/\.\.\.\s*/g, "...\n")
                .split('\n')
                .map(l => l.trim())
                .filter(l => l !== "")
                .join('\n');

            const partes = cascada.split('\n');

            // --- ENVÍO POR GLOBOS A EVOLUTION API ---
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json', 
                        'apikey': EVOLUTION_TOKEN 
                    },
                    body: JSON.stringify({ 
                        number: remoteJid, 
                        text: parte 
                    })
                });
                // Pausa de 1.2 segundos entre mensajes para simular escritura humana
                await new Promise(r => setTimeout(r, 1200)); 
            }
        } else {
            console.error("❌ Error: Grok no devolvió un texto válido.", json);
        }

    } catch (error) { 
        console.error("🔥 Error en el proceso de Fiorella:", error.message); 
    }

    return res.status(200).send('OK');
};
