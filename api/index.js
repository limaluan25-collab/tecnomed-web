require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.post('/api/upload', upload.fields([
    { name: 'relatorio', maxCount: 1 }
]), async (req, res) => {
    try {
        console.log('--- Novo Relatório Recebido ---');

        const cliente = req.body.nomeCliente || 'Cliente';
        const emailCliente = req.body.emailCliente;

        if (!emailCliente) {
            throw new Error('Email do cliente não fornecido.');
        }

        const attachments = [];
        if (req.files['relatorio']) {
            const f = req.files['relatorio'][0];
            attachments.push({
                filename: f.originalname || 'Relatorio_Tecnomed.pdf',
                content: f.buffer,
                contentType: 'application/pdf'
            });
        }

        const mailOptions = {
            from: `"Tecnomed Assistência Técnica" <${process.env.EMAIL_USER}>`,
            to: [process.env.EMAIL_USER, emailCliente].filter(Boolean),
            subject: `Relatório de Manutenção - ${cliente}`,
            text: `Olá, segue em anexo o relatório de manutenção do equipamento para o cliente ${cliente}.\n\nTecnomed Assistência Técnica.`,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send('Relatório enviado com sucesso!');
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).send('Erro: ' + error.message);
    }
});

// Start for local testing
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando localmente na porta ${PORT}`);
    });
}

module.exports = app;
