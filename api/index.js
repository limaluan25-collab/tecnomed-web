require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do CORS
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÃO SERVERLESS (Vercel) ---
// Na Vercel, não podemos salvar arquivos no disco ('./uploads').
// Usamos a Memória (RAM) para segurar o arquivo temporariamente antes de enviar o email.
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
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

// --- CONTADOR (Simples em Memória/Arquivo) ---
// Nota: Na Vercel, o 'arquivo' reseta a cada deploy ou reinicialização.
// Para um contador permanente real, seria necessário um Banco de Dados (ex: MongoDB, Firebase).
// Mantivemos a lógica original, mas sabendo dessa limitação em serverless.
let currentCount = 1;

app.get('/counter', (req, res) => {
    // Retorna o valor atual
    res.json({ value: currentCount });
});

app.post('/counter/increment', (req, res) => {
    currentCount++;
    res.json({ value: currentCount });
});


// Endpoint para receber o relatório e enviar email
app.post('/upload', upload.fields([
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

        // Prepara anexos (lendo da memória)
        const attachments = [];

        if (req.files['relatorio']) {
            const f = req.files['relatorio'][0];
            attachments.push({
                filename: 'Relatorio.pdf',
                content: f.buffer, // Buffer da memória
                contentType: 'application/pdf'
            });
        }

        // Se houver fotos
        if (req.files['fotos']) {
            req.files['fotos'].forEach((f, index) => {
                attachments.push({
                    filename: `foto_${index}.jpg`,
                    content: f.buffer,
                    contentType: f.mimetype
                });
            });
        }

        // Envia Email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: emailCliente,
            cc: process.env.EMAIL_USER,
            subject: `Relatório de Manutenção - ${cliente}`,
            text: `Olá, segue em anexo o relatório de manutenção do equipamento para o cliente ${cliente}.`,
            attachments: attachments
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email enviado:', info.messageId);

        res.status(200).send('Relatório enviado com sucesso!');
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).send('Erro: ' + error.message);
    }
});

// A Vercel precisa que o app seja exportado, mas o listen funciona para local
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

module.exports = app;

