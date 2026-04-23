// /api/cerebro-confirmar.js - Motor Multi-IA (Igual a Fiorella)
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).end();

  const { data } = request.body;
  // Evitar bucles: no responder a mensajes propios
  if (!data.message || data.key.fromMe) return response.status(200).end();

  const customerPhone = data.key.remoteJid.replace(/\D/g, '');
  const customerMessage = (data.message.conversation || data.message.extendedTextMessage?.text || "").toLowerCase();

  // 1. CONFIGURACIÓN DE RUTAS GITHUB (Asegúrate de poner tus datos)
  const GITHUB_BASE = "https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main";

  try {
    // 2. CARGAR CATÁLOGO Y PROMPT MAESTRO
    const [catRes, promptRes] = await Promise.all([
      fetch(`${GITHUB_BASE}/api/productos.json`),
      fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
    ]);

    const catalogo = await catRes.json();
    const promptMaestroData = await promptRes.json();

    // 3. BUSCAR PRODUCTO EN EL CATÁLOGO PARA USAR EL TXT (Carpeta data/)
    let infoProducto = "Información general de salud y bienestar de JRJMarket.";
    for (const p of catalogo.PRODUCTOS) {
      if (p.keywords.some(k => customerMessage.includes(k.toLowerCase()))) {
        const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
        if (txtRes.ok) {
          infoProducto = await txtRes.text();
        }
        break;
      }
    }

    // 4. CONSTRUIR EL PROMPT FINAL PARA LA IA
    const fullPrompt = `
      ${JSON.stringify(promptMaestroData)}

      CONOCIMIENTO TÉCNICO DEL PRODUCTO (Usa esto para postventa):
      ${infoProducto}

      HISTORIAL/MENSAJE ACTUAL DEL CLIENTE:
      "${customerMessage}"

      Instrucción: Responde de forma humana, cálida y persuasiva. Si confirma datos, pide referencia de casa. Si hay queja de horario, ofrece Servientrega.
    `;

    // 5. SELECCIÓN DE IA SEGÚN VARIABLE DE ENTORNO (Lógica de Fiorella)
    let respuestaIA = "";
    const motorIA = process.env.IA_PREFERIDA || 'gemini'; // Por defecto gemini

    if (motorIA === 'gemini') {
      respuestaIA = await llamarGemini(fullPrompt);
    } 
    else if (motorIA === 'openai') {
      respuestaIA = await llamarChatGPT(fullPrompt);
    } 
    else if (motorIA === 'grok') {
      respuestaIA = await llamarGrok(fullPrompt);
    }

    // 6. ENVIAR RESPUESTA POR EVOLUTION API
    if (respuestaIA) {
      await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.INSTANCE_DESPACHO}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': process.env.TOKEN_DESPACHO || process.env.EVOLUTION_TOKEN 
        },
        body: JSON.stringify({ number: customerPhone, text: respuestaIA })
      });
    }

    return response.status(200).end();

  } catch (error) {
    console.error("Error en Cerebro Confirmar:", error);
    return response.status(500).end();
  }
}

// --- CONECTORES DE IA ---

async function llamarGemini(prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const json = await res.json();
  return json.candidates[0].content.parts[0].text;
}

async function llamarChatGPT(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      model: "gpt-4o-mini", 
      messages: [{ role: "system", content: prompt }] 
    })
  });
  const json = await res.json();
  return json.choices[0].message.content;
}

async function llamarGrok(prompt) {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${process.env.XAI_API_KEY}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      model: "grok-beta", 
      messages: [{ role: "system", content: prompt }] 
    })
  });
  const json = await res.json();
  return json.choices[0].message.content;
}
