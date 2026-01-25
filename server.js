require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do CORS para aceitar qualquer origem
app.use(cors());

// Configuração do Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Sanitiza o nome do arquivo para evitar caracteres problematicos
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, Date.now() + '-' + sanitizedName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB
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

// Endpoint para receber o relatório e enviar email
app.post('/upload', upload.fields([
    { name: 'assinatura', maxCount: 1 },
    { name: 'fotos', maxCount: 10 },
    { name: 'relatorio', maxCount: 1 }
]), async (req, res) => {
    try {
        console.log('--- Novo Relatório Recebido ---');
        console.log('Body:', req.body); // Debug para ver campos de texto

        const cliente = req.body.nomeCliente || 'Cliente';
        const emailCliente = req.body.emailCliente;
        console.log('Cliente:', cliente);
        console.log('Email Destino:', emailCliente);

        if (!emailCliente) {
            throw new Error('Email do cliente não fornecido.');
        }

        // Verifica arquivos
        const files = [];
        if (req.files['relatorio']) {
            files.push({
                path: req.files['relatorio'][0].path,
                filename: 'Relatorio.pdf',
                contentType: 'application/pdf'
            });
        }
        if (req.files['assinatura']) {
            files.push({
                path: req.files['assinatura'][0].path,
                filename: 'Assinatura.png',
                contentType: 'image/png'
            });
        }

        // Log de arquivos recebidos
        console.log('Arquivos processados para envio:', files.map(f => f.filename));

        // Envia Email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: emailCliente,
            cc: process.env.EMAIL_USER, // Cópia para o próprio técnico
            subject: `Relatório de Manutenção - ${cliente}`,
            text: `Olá, segue em anexo o relatório de manutenção do equipamento para o cliente ${cliente}.`,
            attachments: files
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email enviado com sucesso:', info.messageId);

        res.status(200).send('Relatório salvo e email enviado com sucesso!');
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).send('Erro ao processar: ' + error.message);
    }
});

// --- Rota do Contador ---
const COUNTER_FILE = './counter.json';

// Inicializa contador se não existir
if (!fs.existsSync(COUNTER_FILE)) {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ value: 1 }));
}

app.get('/counter', (req, res) => {
    try {
        const data = fs.readFileSync(COUNTER_FILE);
        const json = JSON.parse(data);
        res.json(json);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao ler contador' });
    }
});

app.post('/counter/increment', (req, res) => {
    try {
        const data = fs.readFileSync(COUNTER_FILE);
        let json = JSON.parse(data);
        json.value += 1;
        fs.writeFileSync(COUNTER_FILE, JSON.stringify(json));
        res.json(json);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao incrementar contador' });
    }
});

app.use(express.static('.'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nServidor rodando em http://localhost:${PORT}`);
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('AVISO: Credenciais de email não configuradas no arquivo .env');
    }
});
