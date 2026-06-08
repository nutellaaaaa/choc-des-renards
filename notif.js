import { Resend } from "resend";
import "dotenv/config";

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: "onboarding@resend.dev",
  to: process.env.ADMIN_EMAIL,
  subject: "🔔 Nouvelle inscription",
  html: `
    <h2>Nouvelle inscription</h2>
    <p>Nom : ${lastName}</p>
    <p>Prénom : ${firstName}</p>
    <p>Téléphone : ${phone}</p>
    <p>Catégorie : ${category}</p>
	<p></p>
	<p>En attente de validation ...</p>
  `,
});