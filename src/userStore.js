const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}', 'utf-8');
}

function loadAll() {
  ensureFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveAll(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const users = loadAll();
  return users[key] ? { email: key, ...users[key] } : null;
}

function listAll() {
  const users = loadAll();
  return Object.entries(users)
    .map(([email, u]) => ({ email, createdAt: u.createdAt }))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function findByResetToken(token) {
  if (!token) return null;
  const users = loadAll();
  const entry = Object.entries(users).find(([, u]) => u.resetToken === token);
  return entry ? { email: entry[0], ...entry[1] } : null;
}

function createUser(email, passwordHash) {
  const key = normalizeEmail(email);
  const users = loadAll();
  if (users[key]) throw new Error('此 Email 已註冊');
  users[key] = { passwordHash, createdAt: new Date().toISOString() };
  saveAll(users);
}

function updatePassword(email, passwordHash) {
  const key = normalizeEmail(email);
  const users = loadAll();
  if (!users[key]) throw new Error('找不到使用者');
  users[key].passwordHash = passwordHash;
  saveAll(users);
}

function setResetToken(email, token, expiresAt) {
  const key = normalizeEmail(email);
  const users = loadAll();
  if (!users[key]) return;
  users[key].resetToken = token;
  users[key].resetTokenExpires = expiresAt;
  saveAll(users);
}

function clearResetToken(email) {
  const key = normalizeEmail(email);
  const users = loadAll();
  if (!users[key]) return;
  delete users[key].resetToken;
  delete users[key].resetTokenExpires;
  saveAll(users);
}

module.exports = {
  findByEmail,
  findByResetToken,
  listAll,
  createUser,
  updatePassword,
  setResetToken,
  clearResetToken,
};
