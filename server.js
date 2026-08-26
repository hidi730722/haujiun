const express = require('express');
const session = require('express-session');
const path = require('path');

const { router: authRouter, requireAuth } = require('./src/auth');
const productSelectionRouter = require('./src/modules/productSelection');

const app = express();
const PORT = process.env.PORT || 3300;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// 公開頁面：登入 / 忘記密碼 / 重設密碼
app.use(express.static(path.join(__dirname, 'public')));
app.use('/auth', authRouter);

// 受保護區域：需登入後才能存取的功能模組
app.use('/app/api/product-selection', requireAuth, productSelectionRouter);
app.use('/app', requireAuth, express.static(path.join(__dirname, 'protected', 'app')));

app.get('/', (req, res) => {
  res.redirect(req.session.userEmail ? '/app/' : '/login.html');
});

app.listen(PORT, () => {
  console.log(`經營中心已啟動: http://localhost:${PORT}`);
});
