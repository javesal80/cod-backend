const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    // 1. Logs mínimos para no saturar pero saber qué pasa
    console.log("--- 🏁 INICIO ---");
    
    if (req.method !== 'POST') return res.status(200).send('OK');

    const { EVOLUTION_URL, EVOLUTION_TOKEN_DESPACHO, INSTANCE_DESPACHO, GROK_API_KEY } = process.env;

    const data = req.body?.data;
    if (!data?.message || data.key?.fromMe) return res.status(200).send('OK');

    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const instName = INSTANCE_DESPACHO || "Despacho_JRJ";
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");

    console.log(`📩 De: ${remoteJid} | Msg: ${clienteMsg}`);

    try {
        // 2. Cargar catálogo con seguridad absoluta
        let catálogo = "Asesora de bienestar JRJMarket. Trato de USTED.";
        try {
            const txtPath = path.join(process.cwd(), 'api', 'combo-regeneracion.txt');
            if (fs.existsSync(txtPath)) catálogo = fs.readFileSync(txtPath, 'utf8');
        } catch (e) { console.log("⚠️ Sin catálogo físico, usando base."); }

        // 3. Llamada a Grok (Sin memoria compleja para evitar fallos de Vercel)
        console.log("🧠 Conectando a Grok...");
        const respIA = await fetch('https://api.x.ai/v1/responses', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                "model": "grok-4.20-reasoning",
                "input": `Eres Fiorella de JRJMarket. Trato de USTED. Persuasiva. Catálogo: ${catálogo.substring(0, 1000)}. Cliente dice: "${clienteMsg}". Responde de forma cálida y corta:`
            })
        });
        
        const jsonIA = await respIA.json();
        
        // 4. Extracción ultra-segura del texto (basado en tu log de éxito anterior)
        let textoFinal = "";
        try {
            // Buscamos el contenido de texto dentro de la estructura de Grok
            const msgObj = jsonIA.output?.find(o => o.type === 'message');
            textoFinal = msgObj?.content?.find(c => c.type === 'output_text')?.text || "";
        } catch (e) { textoFinal = ""; }

        if (!textoFinal) {
            console.log("❌ Grok no dio texto. Raw:", JSON.stringify(jsonIA).substring(0, 100));
            return res.status(200).send('IA Error');
        }

        // Limpiar prefijos de la IA
        textoFinal = textoFinal.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();

        // 5. Envío a WhatsApp (Sin cascada compleja para asegurar entrega)
        console.log("📤 Enviando respuesta...");
        const finalReq = await fetch(`${baseUrl}/message/sendText/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
            body: JSON.stringify({ number: remoteJid, text: textoFinal })
        });

        const status = await finalReq.text();
        console.log(`✅ Fin. Evolution dijo: ${status.substring(0, 20)}`);

    } catch (error) { 
        console.log("🔥 ERROR:", error.message);
    }

    return res.status(200).send('OK');
};
