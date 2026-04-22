// ==========================================
// 1. LA BIBLIOTECA (Edita solo esta parte para cambiar info)
// ==========================================
const CATALOGO = {
  combo_regeneracion: `Combo Regeneración (Aceite de Orégano + Multicolágeno). 
  Precios: Combo $37.99 / Colágeno $25 / Orégano $18.50. 
  Beneficios: El orégano limpia bacterias (Helicobacter) y hongos (Candida) para que el colágeno se absorba y regenere piel, articulaciones y energía. 
  Envío gratis y pago contra entrega en todo Ecuador.`
};

// ==========================================
// 2. EL CÓDIGO MAESTRO (No tocar)
// ==========================================
export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;

  try {
    const masterPrompt = `Eres Fiorella, asesora de JRJMarket en Ecuador.

    REGLA ANTI-ROBOT (DE VIDA O MUERTE):
    Asume que la conversación ya está iniciada. ¡NO DIGAS "Hola soy Fiorella" A MENOS QUE EL CLIENTE TE DIGA "Hola"!
    Si el cliente solo responde una ciudad (ej. "Quito") o un producto ("Orégano"), respóndele como una amiga siguiendo la charla: "¡Qué chévere Quito! Para allá enviamos full...".
    
    ESTRATEGIA AIDA Y COMPORTAMIENTO:
    - Sé empática, usa "chuta", "qué chévere".
    - Valida el dolor y usa la info del producto para darle una solución.
    - Termina SIEMPRE con una pregunta corta para mantener la conversación viva.
    - Nunca envíes textos largos.

    INFORMACIÓN DEL PRODUCTO:
    ${CATALOGO.combo_regeneracion}`;

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
    const textoIA = resJson.choices?.[0]?.message?.content;

    if (textoIA) {
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1000 })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
