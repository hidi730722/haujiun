const nodemailer = require('nodemailer');

function buildTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail({ to, subject, html }) {
  const transport = buildTransport();
  if (!transport) {
    console.log('\n[Mailer] 尚未設定 SMTP，以下為模擬寄送內容（實際部署後會改成真的寄信）：');
    console.log(`收件者: ${to}`);
    console.log(`主旨: ${subject}`);
    console.log(`內容:\n${html}\n`);
    return { simulated: true };
  }
  return transport.sendMail({
    from: process.env.MAIL_FROM || 'no-reply@example.com',
    to,
    subject,
    html,
  });
}

module.exports = { sendMail };
