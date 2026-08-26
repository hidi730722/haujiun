const express = require('express');
const crypto = require('crypto');
const userStore = require('./userStore');
const { sendMail } = require('./mailer');

const RESET_TOKEN_TTL_MS = 1000 * 60 * 30; // 30 分鐘

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userEmail) return next();
  const wantsJson =
    req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
  if (wantsJson) return res.status(401).json({ error: '請先登入' });
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = express.Router();

router.post('/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '請輸入正確的 Email 格式' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: '密碼至少需要 8 個字元' });
  }
  if (userStore.findByEmail(email)) {
    return res.status(400).json({ error: '此 Email 已註冊過' });
  }
  userStore.createUser(email, hashPassword(password));
  req.session.userEmail = email.trim().toLowerCase();
  res.json({ ok: true });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = userStore.findByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email 或密碼錯誤' });
  }
  req.session.userEmail = user.email;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  res.json({ email: req.session.userEmail || null });
});

router.get('/users', requireAuth, (req, res) => {
  res.json({ users: userStore.listAll() });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: '新密碼至少需要 8 個字元' });
  }
  const user = userStore.findByEmail(req.session.userEmail);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: '目前密碼不正確' });
  }
  userStore.updatePassword(user.email, hashPassword(newPassword));
  res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const user = userStore.findByEmail(email);
  // 不論帳號是否存在都回相同訊息，避免被拿來刺探已註冊 email
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    userStore.setResetToken(user.email, token, Date.now() + RESET_TOKEN_TTL_MS);
    const resetUrl = `${process.env.BASE_URL || 'http://localhost:3300'}/reset-password.html?token=${token}`;
    await sendMail({
      to: user.email,
      subject: '重設你的密碼',
      html: `<p>你收到這封信是因為有人（希望是你）要求重設密碼。</p>
             <p><a href="${resetUrl}">點此重設密碼</a>（30 分鐘內有效）</p>
             <p>若不是你本人操作，請忽略此信，密碼不會被更改。</p>`,
    });
  }
  res.json({ ok: true, message: '若該 Email 已註冊，重設信已寄出' });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: '密碼至少需要 8 個字元' });
  }
  const user = userStore.findByResetToken(token);
  if (!user || !user.resetTokenExpires || user.resetTokenExpires < Date.now()) {
    return res.status(400).json({ error: '重設連結無效或已過期，請重新申請' });
  }
  userStore.updatePassword(user.email, hashPassword(password));
  userStore.clearResetToken(user.email);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, hashPassword, verifyPassword };
