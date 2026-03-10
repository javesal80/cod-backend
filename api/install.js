// /api/install.js - Inicia el flujo OAuth
export default function handler(request, response) {
  const shop = request.query.shop || process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
  const scopes = 'read_customers,write_customers,write_draft_orders,read_draft_orders';
  const state = Math.random().toString(36).substring(2);

  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

  return response.redirect(authUrl);
}
