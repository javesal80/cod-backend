module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_DESPACHO } = process.env;
  const { nombre, telefono, producto, precio, direccion, referencia, provincia_ciudad } = req.body;

  if (!telefono) return res.status(400).send('Falta teléfono');

  const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
  const number = telefono.replace(/\D/g, "") + "@s.whatsapp.net";

  // Lógica de fechas
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const hoy = new Date();
  const mañana = dias[(hoy.getDay() + 1) % 7];
  const pasado = dias[(hoy.getDay() + 2) % 7];

  // --- MENSAJE 1: CONFIRMACIÓN DE DATOS ---
  const mensajeDatos = `Buenos dias. 😊

Nos comunicamos por el pedido de:
*${producto || 'Combo Regeneración'}* por *${precio || '$35'}*

Tenemos la siguiente dirección y datos:
*${nombre}*
*CELULAR:* ${telefono}
*DIRECCIÓN:* ${direccion}
*UBICACIÓN:* ${provincia_ciudad || 'Ecuador'}
*REFERENCIA:* ${referencia || 'N/A'}

*¿Es correcto?*`;

  // --- MENSAJE 2: LOGÍSTICA ---
  const mensajeLogistica = `Listo, procedemos al despacho del producto... 🚚

Por su seguridad, el pedido va por transportadoras conocidas (*Servientrega, Laar, Gintracon o Veloces*).

Le debe estar llegando entre **${mañana}**, o **${pasado}**...
El horario de entrega es de *9:00 AM a 5:00 PM*. 🕒

Por favor, esté atento a su número de contacto. ¡Excelente decisión y excelente día! ✨`;

  try {
    // Enviar por el SEGUNDO NÚMERO (Despacho)
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_DESPACHO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: number, text: mensajeDatos })
    });

    await new Promise(r => setTimeout(r, 2000));

    await fetch(`${baseUrl}/message/sendText/${INSTANCE_DESPACHO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: number, text: mensajeLogistica })
    });

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    return res.status(500).json({ status: 'error' });
  }
};
