import fs from 'fs';
import path from 'path';
import catalogo from './productos.json';

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. BUSCAR EL PRODUCTO EN EL JSON
    const productoMatch = catalogo.PRODUCTOS.find(p => 
      p.keywords.some(k => clienteMsg.toLowerCase().includes(k))
    ) || catalogo.PRODUCTOS[0];

    // 2. LEER LA BIBLIOTECA (Ruta corregida para Vercel)
    let fichaTecnica = "";
    try {
      const filePath = path.resolve(process.cwd(), 'data', productoMatch.archivo);
      fichaTecnica = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      // Plan B por si el archivo no carga
      fichaTecnica = "Venta de Combo Regeneración (Orégano + Colágeno) $37.99.";
    }

    // 3. EL CEREBRO DE FIORELLA (Psicología y Neuroventas)
    const masterPrompt = `Eres Fiorella de JRJMarket. No eres un bot, eres una amiga cercana y experta.
    
    COMPORTAMIENTO:
    - Saluda cálido solo si es el inicio. Si el cliente ya dio un dato (como su ciudad), ¡No te presentes de nuevo! Sigue la charla.
    - Usa frases como "Chuta", "Qué chévere", "Te cuento algo".
    - Si el cliente no contesta o duda, usa la escasez: "Dame un momentito porfa, que estamos a full con el lanzamiento y me quedan poquitos combos".
    - MODELO AIDA: Enfócate en el dolor (gastritis, manchas, energía).
    - Siempre termina con una PREGUNTA de cierre.
    
    BIBLIOTECA TÉCNICA DEL PRODUCTO:
    ${fichaTecnica}`;

    // 4. LLAMADA A LA IA
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: masterPrompt }, { role: "user", content: clienteMsg }]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content;

    if (textoIA) {
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1500 })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error crítico:", error);
    return res.status(200).send('OK');
  }
}
