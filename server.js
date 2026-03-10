const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS + parsing
app.use(cors());
app.use(express.json());
// Serve only a public directory (safer than serving the whole repo)
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURAÇÃO SERVERLESS (Vercel) ---
// Usamos memória para segurar arquivos temporariamente antes de enviar o email.
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(null, false);
  }
});

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  debug: false,
  logger: false
});

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn('AVISO: Credenciais de email não configuradas no arquivo .env');
}

// --- CONTADOR (em memória) ---
// Nota: em ambientes serverless o valor não persiste entre cold starts/deploys.
let currentCount = 1;

app.get('/api/counter', (req, res) => {
  res.json({ value: currentCount });
});

app.post('/api/counter/increment', (req, res) => {
  currentCount++;
  res.json({ value: currentCount });
});

// Endpoint para receber o relatório e enviar email
app.post('/api/upload', upload.fields([
  { name: 'assinatura', maxCount: 1 },
  { name: 'fotos', maxCount: 10 },
  { name: 'relatorio', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('--- Novo Relatório Recebido ---');

    const cliente = req.body.nomeCliente || 'Cliente';
    const emailCliente = req.body.emailCliente;

    if (!emailCliente) {
      throw new Error('Email do cliente não fornecido.');
    }

    // Prepara anexos a partir da memória
    const attachments = [];

    if (req.files && req.files['relatorio'] && req.files['relatorio'][0]) {
      const f = req.files['relatorio'][0];
      attachments.push({
        filename: f.originalname || 'relatorio.pdf',
        content: f.buffer,
        contentType: f.mimetype || 'application/pdf'
      });
    }

    // IGNORAR ASSINATURA E FOTOS SEPARADAS (Tudo já está no PDF)
    /*
    if (req.files && req.files['assinatura'] && req.files['assinatura'][0]) {
       // ...
    }
    if (req.files && req.files['fotos']) {
       // ...
    }
    */

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: emailCliente,
      bcc: process.env.EMAIL_USER,
      subject: `Relatório de Manutenção - ${cliente}`,
      text: `Olá, segue em anexo o relatório de manutenção do equipamento para o cliente ${cliente}.`,
      attachments
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email enviado:', info.messageId);

    res.status(200).send('Relatório enviado com sucesso!');
  } catch (error) {
    console.error('Erro no processamento:', error);
    res.status(500).send('Erro: ' + error.message);
  }
});

// Start only when run directly (keeps compatibility with serverless platforms)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

module.exports = app;