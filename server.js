const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
const PORT = process.env.PORT || 3000;

// --- Simple JSON DB helpers ---
function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const init = { users: {}, vouchers: {}, otps: {}, sessions: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Utility helpers
function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function hashPin(pin) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(pin, salt);
}
function verifyPin(pin, pinHash) {
  if (!pinHash) return false;
  return bcrypt.compareSync(pin, pinHash);
}
function nowMs() {
  return Date.now();
}

function sendSmsMock(phone, message) {
  console.log(`[SMS to ${phone}]: ${message}`);
}

let db = readDB();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/ussd', (req, res) => {
  try {
    const { sessionId = '', serviceCode = '', phoneNumber = '', text = '' } = req.body;
    const phone = phoneNumber.trim();

    if (!db.sessions[sessionId]) {
      db.sessions[sessionId] = { phone, createdAt: nowMs() };
    }
    const session = db.sessions[sessionId];

    const input = text || '';
    const parts = input.split('*').filter(p => p !== '');

    function sendCON(message) {
      return res.send(`CON ${message}`);
    }
    function sendEND(message) {
      return res.send(`END ${message}`);
    }

    if (input === '') {
      return sendCON([
        'Welcome to Ubuntu Wallet',
        '1. Register',
        '2. Check Balance',
        '3. Send Money',
        '4. Cash-in (Voucher)',
        '5. Exit'
      ].join('\n'));
    }

    const choice = parts[0];
    if (choice === '1') {
      if (parts.length === 1) return sendCON('Enter your national ID number:');
      if (parts.length === 2) {
        session.idNumber = parts[1].trim();
        writeDB(db);
        return sendCON('Enter a 4-digit PIN:');
      }
      if (parts.length === 3) {
        const idNumber = session.idNumber || parts[1].trim();
        const pin = parts[2].trim();
        if (!/^\d{4}$/.test(pin)) return sendEND('PIN must be 4 digits.');
        if (!db.users[phone]) {
          db.users[phone] = {
            phone,
            idHash: crypto.createHash('sha256').update(idNumber).digest('hex'),
            pinHash: hashPin(pin),
            wallet: { balance: 0 },
            createdAt: nowMs()
          };
        } else {
          db.users[phone].pinHash = hashPin(pin);
        }
        delete db.sessions[sessionId];
        writeDB(db);
        return sendEND('Registration successful. You can now use the wallet.');
      }
    }

    if (choice === '2') {
      if (parts.length === 1) return sendCON('Enter your 4-digit PIN:');
      if (parts.length === 2) {
        const pin = parts[1].trim();
        const user = db.users[phone];
        if (!user) return sendEND('User not registered.');
        if (!verifyPin(pin, user.pinHash)) return sendEND('Invalid PIN.');
        return sendEND(`Your balance is R${user.wallet.balance}`);
      }
    }

    if (choice === '3') {
      if (parts.length === 1) return sendCON('Enter recipient phone number:');
      if (parts.length === 2) {
        session.toPhone = parts[1].trim();
        writeDB(db);
        return sendCON('Enter amount in Rands:');
      }
      if (parts.length === 3) {
        session.amount = Number(parts[2]);
        writeDB(db);
        return sendCON('Enter your PIN to confirm:');
      }
      if (parts.length === 4) {
        const pin = parts[3].trim();
        const user = db.users[phone];
        if (!user) return sendEND('User not registered.');
        if (!verifyPin(pin, user.pinHash)) return sendEND('Invalid PIN.');
        const amt = session.amount;
        if (user.wallet.balance < amt) return sendEND('Insufficient funds.');
        user.wallet.balance -= amt;
        if (!db.users[session.toPhone]) {
          db.users[session.toPhone] = { phone: session.toPhone, pinHash: null, wallet: { balance: 0 }, createdAt: nowMs() };
        }
        db.users[session.toPhone].wallet.balance += amt;
        delete db.sessions[sessionId];
        writeDB(db);
        return sendEND(`Sent R${amt} to ${session.toPhone}. New balance R${user.wallet.balance}`);
      }
    }

    if (choice === '4') {
      if (parts.length === 1) return sendCON('Enter voucher code:');
      if (parts.length === 2) {
        const code = parts[1].trim().toUpperCase();
        const v = db.vouchers[code];
        if (!v) return sendEND('Invalid voucher code.');
        if (v.redeemed) return sendEND('Voucher already redeemed.');
        const otp = genOtp();
        db.otps[phone] = { otp, code, expiresAt: nowMs() + 5 * 60 * 1000 };
        writeDB(db);
        sendSmsMock(phone, `Your OTP is ${otp}`);
        return sendCON('An OTP was sent to your phone. Enter OTP:');
      }
      if (parts.length === 3) {
        const entered = parts[2].trim();
        const rec = db.otps[phone];
        if (!rec) return sendEND('No OTP found. Start again.');
        if (nowMs() > rec.expiresAt) {
          delete db.otps[phone];
          writeDB(db);
          return sendEND('OTP expired. Please request a new voucher redemption.');
        }
        if (rec.otp !== entered) return sendEND('Invalid OTP.');
        const v = db.vouchers[rec.code];
        if (!v || v.redeemed) {
          delete db.otps[phone];
          writeDB(db);
          return sendEND('Voucher invalid or already redeemed.');
        }
        v.redeemed = true;
        v.redeemedAt = nowMs();
        if (!db.users[phone]) {
          db.users[phone] = { phone, pinHash: null, wallet: { balance: 0 }, createdAt: nowMs() };
        }
        db.users[phone].wallet.balance += v.amount;
        delete db.otps[phone];
        delete db.sessions[sessionId];
        writeDB(db);
        return sendEND(`Voucher redeemed: R${v.amount} credited. New balance R${db.users[phone].wallet.balance}`);
      }
    }

    return sendEND('Invalid choice.');
  } catch (err) {
    console.error(err);
    return res.status(500).send('END Server error');
  }
});

app.post('/admin/voucher', (req, res) => {
  const { code, amount } = req.body;
  if (!code || !amount) return res.status(400).json({ error: 'code and amount required' });
  const c = String(code).trim().toUpperCase();
  db.vouchers[c] = { code: c, amount: Number(amount), redeemed: false, createdAt: nowMs() };
  writeDB(db);
  return res.json({ ok: true, voucher: db.vouchers[c] });
});

app.get('/status', (req, res) => {
  return res.json({ users: Object.keys(db.users).length, vouchers: Object.keys(db.vouchers).length });
});

app.listen(PORT, () => console.log(`Ubuntu Wallet USSD server running on port ${PORT}`));
