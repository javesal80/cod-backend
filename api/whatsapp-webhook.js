import fs from 'fs';
import path from 'path';

// 🧠 INYECCIÓN DE MEMORIA GLOBAL (Sobrevive durante la conversación activa)
if (!global.memoriaChats) {
  global.memoriaChats = {};
}

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. CARGAR BIBLIOTECA DE PRODUCTO (Con seguro anti-errores)
    let fichaTecnica = "Combo Regeneración (Orégano + Colágeno) $37.99.";
    try {
      const filePath = path.join(process.cwd(), 'data', 'combo-regeneracion.txt');
      if (fs.existsSync(filePath)) {
        fichaTecnica = fs.readFileSync(filePath, 'utf8');
      }
    } catch (e) {
      console.log("Usando info de respaldo");
    }

    // 2. EL MASTER PROMPT
    const masterPrompt = `Eres Fiorella, asesora experta de JRJMarket. ¡Eres humana, fluida y persuasiva!
    
    REGLAS DE ORO:
    - NUNCA repitas un saludo si en el historial ya saludaste.
    - Sigue el hilo de la conversación. Si ya te dijo su ciudad, usa esa info.
    - Habla natural, usa expresiones como "Chuta", "Qué chévere", "De ley".
    - Usa Neuroventas: Valida el dolor y presenta el producto como la solución.
    - Termina siempre con una pregunta corta para cerrar la venta.
    
    INFO TÉCNICA:
    ${fichaTecnica}`;

    // 3. ACTUALIZAR HISTORIAL DEL CLIENTE
    if (!global.memoriaChats[remoteJid]) {
      global.memoriaChats[remoteJid] = [];
    }
    
    // Guardamos lo que dijo el cliente
    global.memoriaChats[remoteJid].push({ role: "user", content: clienteMsg });

    // Mantenemos solo los últimos 8 mensajes para no sobrecargar la IA
    if (global.memoriaChats[remoteJid].length > 8) {
      global.memoriaChats[remoteJid] = global.memoriaChats[remoteJid].slice(-8);
    }

    // 4. CONSTRUIR EL PAQUETE (Instrucciones + Historial)
    const mensajesParaIA = [
      { role: "system", content: masterPrompt },
      ...global.memoriaChats[remoteJid]
    ];

    // 5. LLAMADA A LA IA
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: mensajesParaIA
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content;

    // Guardamos lo que respondió la IA en la memoria
    if (textoIA) {
      global.memoriaChats[remoteJid].push({ role: "assistant", content: textoIA });

      // 6. ENVIAR A WHATSAPP
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1000 })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error:", error);
    return res.status(200).send('OK');
  }
}
