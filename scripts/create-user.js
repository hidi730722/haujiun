const userStore = require('../src/userStore');
const { hashPassword } = require('../src/auth');

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error('用法: npm run create-user -- <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('密碼至少需要 8 個字元');
  process.exit(1);
}

try {
  userStore.createUser(email, hashPassword(password));
  console.log(`已建立使用者: ${email}`);
} catch (e) {
  console.error(`建立失敗: ${e.message}`);
  process.exit(1);
}
