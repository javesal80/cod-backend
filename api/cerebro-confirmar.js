// /api/cerebro-confirmar.js
export default async function handler(request, response) {
  const { data } = request.body;
  if (!data.message || data.key.fromMe) return response.status(200).end();

  const customerMessage = data.message.conversation || data.message.extendedTextMessage?.text;
  const customerPhone = data.key.remoteJid.replace(/\D/g, '');

  // 1. CARGA DE CATÁLOGO Y TXT (Igual que Fiorella)
  // Aquí el código detecta el producto del historial y jala la info del TXT de GitHub
  const infoProducto = await obtenerInfoDesdeCatalogo(customerMessage);

  // 2. PROMPT MAESTRO (Personalidad Fiorella + Lógica de Despacho)
  const promptMaestro = `
    Eres el experto de JRJMarket. Tono: Cálido y Persuasivo (como Fiorella).
    REGLAS:
    - Si confirma datos: Pide referencia o calle cruzada obligatoriamente.
    - Si el horario (9am-5pm) no le sirve: Ofrece Oficina Servientrega como beneficio.
    - Postventa: Si pregunta dosis o uso, usa la info del TXT: ${infoProducto.detalles}.
    - Si duda: Persuade con beneficios.
    - Cierre: "Perfecto, procedo a su despacho. ¡Excelente día!"
  `;

  // 3. CONSULTA IA Y ENVÍO
  const respuestaIA = await consultarIA(promptMaestro, customerMessage);

  await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.INSTANCE_DESPACHO}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': process.env.TOKEN_DESPACHO },
    body: JSON.stringify({ number: customerPhone, text: respuestaIA })
  });

  return response.status(200).end();
}
