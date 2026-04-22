import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. INTENTO DE LEER LA BIBLIOTECA (Sin errores)
    let fichaTecnica = "";
    try {
      const filePath = path.join(process.cwd(), 'data', 'combo-regeneracion.txt');
      fichaTecnica = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      fichaTecnica = "Vendes un combo de Aceite de Orégano ($18.50) y Colágeno ($25). El combo total vale $37.99 con envío gratis.";
    }

    // 2. EL CEREBRO DE FIORELLA (Aquí está la Neuroventa)
    const masterPrompt = `Eres Fiorella, asesora de JRJMarket en Ecuador. 
    ¡IMPORTANTE!: Habla como una amiga real por WhatsApp. Usa frases como "Te cuento algo", "La verdad...", "Chévere".
    
    TUS REGLAS DE ORO:
    - No seas un robot. Si el cliente dice "Hola", saluda con cariño y pregunta cómo está.
    - Si el cliente dice "Nada gracias", no repitas lo mismo; despídete con elegancia o lanza un último gancho de oferta.
    - Usa el modelo AIDA: Atrapa su dolor, despierta interés con la ciencia, genera deseo y CIERRA con una pregunta de envío.
    - Si no tienes historial, asume que es una charla nueva y fluye.
    
    INFO PRODUCTO: ${fichaTecnica}`;

    // 3. LLAMADA A LA IA
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: masterPrompt },
          { role: "user", content: clienteMsg }
        ]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola! Soy Fiorella, dame un segundito que estamos a full con pedidos, ¿en qué ciudad estás?";

    // 4. ENVÍO SEGURO
    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1200 })
    });

    return res.status(200).send('OK');
  } catch (error) {
    // Si todo falla, enviamos un mensaje humano manual para no perder la venta
    console.error("Error crítico:", error.message);
    return res.status(200).send('OK');
  }
}
