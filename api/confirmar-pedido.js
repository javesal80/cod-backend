module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Esperando datos...');

  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME } = process.env;
  const { nombre, telefono, producto, precio, direccion, referencia } = req.body;

  if (!telefono) return res.status(400).send('Falta teléfono');

  const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
  const number = telefono.replace(/\D/g, "") + "@s.whatsapp.net";

  // --- LÓGICA DE VALIDACIÓN DE DIRECCIÓN ---
  // Revisamos si faltan calles (usualmente indicadas por "y" o "&") o si es muy corta
  const direccionIncompleta = !direccion.includes(" y ") && !direccion.includes("&") && !direccion.includes(" entre ");
  const faltaReferencia = !referencia || referencia.length < 5;

  if (direccionIncompleta || faltaReferencia) {
    const mensajeAyuda = `¡Hola *${nombre}*! 😊 
    
Le saluda Fiorella de *JRJMarket*. 🌿
Hemos recibido su pedido, pero para que el mensajero no tenga problemas al llegar, ¿podría ayudarme con el lugar de entrega exacto?

*Nos falta un dato:* ⚠️ ${direccionIncompleta ? "Necesitamos la calle que cruza a su calle principal." : "Necesitamos una referencia (color de casa, local cercano, etc)."}

*Ejemplo:* Calle Amazonas y Pereira, casa de 1 piso color blanco frente a los bomberos. 🏠

¡Quedo atenta para confirmar su despacho ahora mismo!`;

    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: number, text: mensajeAyuda })
    });
    
    return res.status(200).json({ status: 'pending', message: 'Validación enviada' });
  }

  // --- SI TODO ESTÁ CORRECTO, PROCEDE AL FLUJO DE CONFIRMACIÓN ANTERIOR ---
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const hoy = new Date();
  const mañana = dias[(hoy.getDay() + 1) % 7];
  const pasado = dias[(hoy.getDay() + 2) % 7];

  const mensajeDatos = `¡Buenos días! 😊 

Nos comunicamos por el pedido de:
*${producto}* por *${precio}*

Datos registrados:
*Nombre:* ${nombre}
*CELULAR:* ${telefono}
*DIRECCIÓN:* ${direccion}
*REFERENCIA:* ${referencia}

*¿Es correcto?*`;

  const mensajeCierre = `Listo, procedemos al despacho... 🚚

El pedido va por transportadoras conocidas (*Servientrega, Laar, Gintracon o Veloces*).
Llegará entre **${mañana}**, o **${pasado}**...
Horario: *9:00 AM a 5:00 PM*. 🕒

¡Excelente decisión! ✨`;

  try {
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: number, text: mensajeDatos })
    });
    await new Promise(r => setTimeout(r, 2000));
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: number, text: mensajeCierre })
    });
    return res.status(200).json({ status: 'success' });
  } catch (error) {
    return res.status(500).json({ status: 'error' });
  }
};
